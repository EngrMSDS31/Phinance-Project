/**
 * PSE-only EODHD price adapter.
 *
 * Rules:
 * - EODHD is used ONLY for Philippine Stock Exchange (PSE) symbols.
 * - US / LSE pricing is NOT touched here.
 * - DB-backed cache: one EODHD fetch per symbol per PHT calendar day.
 *
 * Timing (Asia/Manila, UTC+8):
 *   PSE market close:     15:30 PHT
 *   EODHD publish window: ~18:00 PHT (2.5 h buffer after close)
 *   Before 18:00 PHT  → use cache, do NOT call EODHD
 *   After  18:00 PHT  → one controlled fetch per symbol per calendar day (PHT)
 */

import { db, psePriceCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const EODHD_KEY = process.env.EODHD_API_KEY ?? "";
const EODHD_EXCHANGE = "PSE"; // EODHD exchange code for Philippine stocks
const EODHD_BASE = "https://eodhd.com/api/real-time";

// PSE EODHD publish window: 18:00 PHT (= 10:00 UTC)
const POST_CLOSE_HOUR_PHT = 18;

function phtDateNow(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // "YYYY-MM-DD"
}

function phtHourNow(): number {
  const s = new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hour12: false });
  return parseInt(s.slice(0, 2), 10);
}

// ─── Public helpers ────────────────────────────────────────────────────────────

export function isPseSymbol(market: string): boolean {
  return market === "PSE";
}

/** EODHD ticker format for PSE: "SCC.PSE" */
export function toPseEodhdTicker(symbol: string): string {
  return `${symbol.toUpperCase()}.${EODHD_EXCHANGE}`;
}

// ─── Cache (persistent, DB-backed) ────────────────────────────────────────────

export interface PsePriceCache {
  symbol: string;
  lastClose: number;
  lastTradingDate: string; // "YYYY-MM-DD" from EODHD timestamp
  fetchedAt: Date;
  source: string;
  change: number | null;
  changePct: number | null;
}

export async function getCachedPsePrice(symbol: string): Promise<PsePriceCache | null> {
  try {
    const rows = await db.select().from(psePriceCacheTable)
      .where(eq(psePriceCacheTable.symbol, symbol.toUpperCase()))
      .limit(1);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      symbol: r.symbol,
      lastClose: parseFloat(r.lastClose),
      lastTradingDate: r.lastTradingDate,
      fetchedAt: r.fetchedAt,
      source: r.source,
      change: r.change != null ? parseFloat(r.change) : null,
      changePct: r.changePct != null ? parseFloat(r.changePct) : null,
    };
  } catch (err) {
    logger.warn({ err, symbol }, "getCachedPsePrice: DB read failed");
    return null;
  }
}

export async function deletePsePriceCache(symbol: string): Promise<void> {
  try {
    await db.delete(psePriceCacheTable).where(eq(psePriceCacheTable.symbol, symbol.toUpperCase()));
    logger.info({ symbol }, "PSE price cache deleted (forced refresh)");
  } catch (err) {
    logger.warn({ err, symbol }, "deletePsePriceCache: DB delete failed");
  }
}

export async function savePsePriceCache(symbol: string, data: Omit<PsePriceCache, "symbol">): Promise<void> {
  try {
    const sym = symbol.toUpperCase();
    const existing = await db.select({ id: psePriceCacheTable.id })
      .from(psePriceCacheTable)
      .where(eq(psePriceCacheTable.symbol, sym))
      .limit(1);

    const values = {
      symbol: sym,
      lastClose: String(data.lastClose),
      lastTradingDate: data.lastTradingDate,
      fetchedAt: data.fetchedAt,
      source: data.source,
      change: data.change != null ? String(data.change) : null,
      changePct: data.changePct != null ? String(data.changePct) : null,
    };

    if (existing.length) {
      await db.update(psePriceCacheTable).set(values).where(eq(psePriceCacheTable.id, existing[0].id));
    } else {
      await db.insert(psePriceCacheTable).values(values);
    }
    logger.info({ symbol: sym, lastClose: data.lastClose, lastTradingDate: data.lastTradingDate }, "PSE price cached");
  } catch (err) {
    logger.warn({ err, symbol }, "savePsePriceCache: DB write failed");
  }
}

// ─── Timing logic ─────────────────────────────────────────────────────────────

/**
 * Decides whether a fresh EODHD call is warranted for this symbol right now.
 *
 * Returns true only when ALL of:
 *  1. Current PHT hour >= POST_CLOSE_HOUR_PHT (18:00)
 *  2. We have NOT already fetched this symbol today (PHT)
 */
export function shouldFetchNewPseEod(cache: PsePriceCache | null): boolean {
  const hourPHT = phtHourNow();
  if (hourPHT < POST_CLOSE_HOUR_PHT) return false; // before publish window

  if (!cache) return true; // never fetched

  const todayPHT = phtDateNow();
  const fetchedOnPHT = cache.fetchedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return fetchedOnPHT !== todayPHT; // fetch at most once per PHT calendar day
}

// ─── EODHD fetch ──────────────────────────────────────────────────────────────

export interface PseEodhdResult {
  lastClose: number;
  lastTradingDate: string;
  change: number | null;
  changePct: number | null;
}

export async function fetchPsePriceFromEodhd(symbol: string): Promise<PseEodhdResult | null> {
  if (!EODHD_KEY) {
    logger.warn("EODHD_API_KEY not set — cannot fetch PSE price");
    return null;
  }

  const ticker = toPseEodhdTicker(symbol);
  const url = `${EODHD_BASE}/${encodeURIComponent(ticker)}?api_token=${EODHD_KEY}&fmt=json`;

  try {
    logger.info({ ticker }, "Fetching PSE price from EODHD");
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) {
      logger.warn({ ticker, status: res.status }, "EODHD PSE fetch: non-OK response");
      return null;
    }

    const raw = await res.json() as any;
    // Log raw response during testing so we can verify fields
    logger.info({ ticker, close: raw.close, previousClose: raw.previousClose, timestamp: raw.timestamp, change: raw.change, change_p: raw.change_p }, "EODHD PSE raw response");

    // close > 0 is the EOD price; fall back to previousClose
    // EODHD returns "NA" (string) when the market hasn't posted a new close yet
    const rawClose = raw.close;
    const rawPrevClose = raw.previousClose;
    const closePrice: number | null =
      (typeof rawClose === "number" && rawClose > 0) ? rawClose :
      (typeof rawPrevClose === "number" && rawPrevClose > 0) ? rawPrevClose :
      null;

    if (closePrice == null) {
      logger.warn({ ticker }, "EODHD PSE: no valid close price in response");
      return null;
    }

    // Derive trading date from EODHD timestamp (Unix seconds).
    // timestamp may be "NA" string when market hasn't closed yet — fall back to today PHT.
    let lastTradingDate = phtDateNow();
    const rawTs = raw.timestamp;
    if (typeof rawTs === "number" && rawTs > 0) {
      lastTradingDate = new Date(rawTs * 1000)
        .toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    }

    // change and change_p may also be "NA"
    const rawChange = raw.change;
    const rawChangePct = raw.change_p;

    return {
      lastClose: closePrice,
      lastTradingDate,
      change: typeof rawChange === "number" ? rawChange : null,
      changePct: typeof rawChangePct === "number" ? rawChangePct : null,
    };
  } catch (err) {
    logger.warn({ err, ticker }, "EODHD PSE fetch threw an error");
    return null;
  }
}

// ─── Top-level: get PSE price for one symbol ──────────────────────────────────

export interface PsePriceResult {
  price: number;
  change: number | null;
  changePct: number | null;
  source: string;
  priceLabel: string;
  lastTradingDate: string;
  fromCache: boolean;
}

/**
 * Primary entry point for a single PSE symbol.
 *
 * Strategy:
 *  1. Read cache.
 *  2. If shouldFetchNewPseEod → call EODHD once, update cache.
 *  3. Return cached price (fresh or prior) as long as it's > 0.
 *  4. If nothing at all → return null (caller shows "Price unavailable").
 */
export async function getPsePrice(symbol: string): Promise<PsePriceResult | null> {
  const sym = symbol.toUpperCase();
  let cache = await getCachedPsePrice(sym);

  if (shouldFetchNewPseEod(cache)) {
    const fetched = await fetchPsePriceFromEodhd(sym);
    if (fetched) {
      const newCache: PsePriceCache = {
        symbol: sym,
        lastClose: fetched.lastClose,
        lastTradingDate: fetched.lastTradingDate,
        fetchedAt: new Date(),
        source: "EODHD",
        change: fetched.change,
        changePct: fetched.changePct,
      };
      await savePsePriceCache(sym, newCache);
      cache = newCache;
    } else if (cache) {
      // Fetch failed — update fetchedAt so we don't spam EODHD again today
      await savePsePriceCache(sym, { ...cache, fetchedAt: new Date() });
      cache = { ...cache, fetchedAt: new Date() };
    }
  }

  if (cache && cache.lastClose > 0) {
    return {
      price: cache.lastClose,
      change: cache.change,
      changePct: cache.changePct,
      source: cache.source,
      priceLabel: "Last Close",
      lastTradingDate: cache.lastTradingDate,
      fromCache: true,
    };
  }

  return null;
}

/**
 * Batch version: fetches PSE prices for multiple symbols respecting budget.
 * Only symbols that pass shouldFetchNewPseEod() are fetched from EODHD.
 * All others are served from cache.
 */
export async function getPsePrices(symbols: string[]): Promise<Map<string, PsePriceResult | null>> {
  const results = new Map<string, PsePriceResult | null>();
  await Promise.all(symbols.map(async (sym) => {
    results.set(sym.toUpperCase(), await getPsePrice(sym));
  }));
  return results;
}

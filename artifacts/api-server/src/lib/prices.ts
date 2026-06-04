import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
import { db, priceCacheTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { searchPseStocks, PSE_STOCKS } from "./pse-stocks";
import { getPsePrice, getCachedPsePrice, savePsePriceCache, isPseSymbol, deletePsePriceCache } from "./pse-eodhd";

// Daily cache: prices are fetched once per calendar day (UTC) and reused for the rest of the day.
// This prevents redundant EODHD/Yahoo/CoinGecko calls on every page load while still
// showing the freshest price on each new trading day.
const DAILY_CACHE = true; // flag for readability

const EODHD_KEY = process.env.EODHD_API_KEY ?? "";

const MARKET_SUFFIXES: Record<string, string> = {
  LSE: ".L",
  PSE: ".PS",
};

const CRYPTO_VS_CURRENCY = "usd";

export interface PriceResult {
  symbol: string;
  market: string;
  price: number;
  currency: string;
  priceChange: number | null;
  priceChangePct: number | null;
  lastUpdated: string;
  source: string | null;
  isStale: boolean;
  priceLabel: string;
}

export interface DividendInfoResult {
  symbol: string;
  name: string | null;
  currency: string;
  dividendRate: number | null;
  dividendYield: number | null;
  exDividendDate: string | null;
  lastDividendValue: number | null;
  lastDividendDate: string | null;
  history: Array<{ date: string; amount: number }>;
}

// ─── CoinGecko ─────────────────────────────────────────────────────────────────

async function fetchFromCoinGecko(coinId: string): Promise<{ price: number; change: number | null; changePct: number | null } | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=${CRYPTO_VS_CURRENCY}&include_24hr_change=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, Record<string, number>>;
    const coin = data[coinId.toLowerCase()];
    if (!coin) return null;
    return {
      price: coin[CRYPTO_VS_CURRENCY] ?? 0,
      change: coin[`${CRYPTO_VS_CURRENCY}_24h_change`] ?? null,
      changePct: coin[`${CRYPTO_VS_CURRENCY}_24h_change`] ?? null,
    };
  } catch {
    return null;
  }
}

// ─── EODHD ──────────────────────────────────────────────────────────────────────

interface EodhdFetchResult {
  price: number;
  change: number | null;
  changePct: number | null;
}

async function fetchEodhdPrice(eodhdTicker: string): Promise<EodhdFetchResult | null> {
  if (!EODHD_KEY) return null;
  try {
    const url = `https://eodhd.com/api/real-time/${encodeURIComponent(eodhdTicker)}?api_token=${EODHD_KEY}&fmt=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    // Use close price; fall back to previousClose
    const price =
      (typeof data.close === "number" && data.close > 0) ? data.close :
      (typeof data.previousClose === "number" && data.previousClose > 0) ? data.previousClose :
      null;
    if (price == null) return null;
    return {
      price,
      change: typeof data.change === "number" ? data.change : null,
      changePct: typeof data.change_p === "number" ? data.change_p : null,
    };
  } catch {
    return null;
  }
}

// ─── Yahoo Finance ─────────────────────────────────────────────────────────────

interface YahooFetchResult {
  price: number;
  currency: string;
  change: number | null;
  changePct: number | null;
  priceLabel: string;
}

async function fetchYahooPrice(ticker: string): Promise<YahooFetchResult | null> {
  try {
    // Use validateResult: false so yahoo-finance2 doesn't reject PSE/international quotes
    const quote = await (yahooFinance.quote as any)(ticker, {}, { validateResult: false }) as any;
    if (!quote) return null;

    const marketState: string = (quote.marketState as string) ?? "CLOSED";
    let currency = ((quote.currency as string) ?? "USD");
    const change = (quote.regularMarketChange as number) ?? null;
    const changePct = (quote.regularMarketChangePercent as number) ?? null;

    // Try multiple price fields in priority order
    let livePrice: number | null =
      (quote.regularMarketPrice as number | null) ??
      (quote.currentPrice as number | null) ??
      null;

    // Normalize LSE pence (GBp / GBX) → GBP
    if (currency === "GBp" || currency === "GBX") {
      currency = "GBP";
      if (livePrice != null) livePrice = livePrice / 100;
    }

    const normCurrency = currency.toUpperCase();

    if (livePrice != null && livePrice > 0) {
      return {
        price: livePrice, currency: normCurrency, change, changePct,
        priceLabel: marketState === "REGULAR" ? "Live" : "Last Price",
      };
    }

    // Try bid/ask average as fallback
    const bid = (quote.bid as number | null) ?? null;
    const ask = (quote.ask as number | null) ?? null;
    if (bid && ask && bid > 0 && ask > 0) {
      const midPrice = (bid + ask) / 2;
      return { price: (currency === "GBp" || currency === "GBX") ? midPrice / 100 : midPrice, currency: normCurrency, change: null, changePct: null, priceLabel: "Last Price" };
    }

    // Previous close fallback
    let prevClose: number | null =
      (quote.regularMarketPreviousClose as number | null) ??
      (quote.previousClose as number | null) ??
      null;

    if (prevClose != null && prevClose > 0) {
      return { price: prevClose, currency: normCurrency, change: null, changePct: null, priceLabel: "Last Close" };
    }

    return null;
  } catch {
    return null;
  }
}

// quoteSummary-based fallback — more robust for PSE/international stocks
async function fetchYahooQuoteSummary(ticker: string): Promise<YahooFetchResult | null> {
  try {
    const summary = await (yahooFinance.quoteSummary as any)(
      ticker,
      { modules: ["price", "summaryDetail"] },
      { validateResult: false }
    ) as any;

    const p = summary?.price;
    if (!p) return null;

    const rawCurrency: string = (p.currency as string) ?? "USD";
    let currency = rawCurrency.toUpperCase();
    if (currency === "GBP" || currency === "GBX") currency = "GBP";

    let livePrice: number | null =
      (typeof p.regularMarketPrice === "object" ? p.regularMarketPrice?.raw : p.regularMarketPrice) ??
      null;

    // Normalize LSE pence
    if ((rawCurrency === "GBp" || rawCurrency === "GBX") && livePrice != null) {
      livePrice = livePrice / 100;
    }

    if (livePrice && livePrice > 0) {
      return { price: livePrice, currency, change: null, changePct: null, priceLabel: "Last Price" };
    }

    let prevClose: number | null =
      (typeof p.regularMarketPreviousClose === "object"
        ? p.regularMarketPreviousClose?.raw
        : p.regularMarketPreviousClose) ?? null;

    if ((rawCurrency === "GBp" || rawCurrency === "GBX") && prevClose != null) {
      prevClose = prevClose / 100;
    }

    if (prevClose && prevClose > 0) {
      return { price: prevClose, currency, change: null, changePct: null, priceLabel: "Last Close" };
    }

    // Also try summaryDetail
    const sd = summary?.summaryDetail;
    let sdClose =
      (typeof sd?.previousClose === "object" ? sd.previousClose?.raw : sd?.previousClose) ?? null;
    if ((rawCurrency === "GBp" || rawCurrency === "GBX") && sdClose != null) {
      sdClose = sdClose / 100;
    }
    if (sdClose && sdClose > 0) {
      return { price: sdClose, currency, change: null, changePct: null, priceLabel: "Last Close" };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Cache ─────────────────────────────────────────────────────────────────────

async function getCachedPrice(symbol: string, market: string): Promise<PriceResult | null> {
  try {
    const rows = await db.select().from(priceCacheTable)
      .where(and(eq(priceCacheTable.symbol, symbol), eq(priceCacheTable.market, market)))
      .limit(1);
    if (!rows.length) return null;
    const row = rows[0];
    // Daily cache: a cached price is fresh if it was fetched today (UTC date match).
    // This ensures one EODHD/Yahoo call per ticker per day regardless of how often
    // the user opens or refreshes the app.
    const cachedDate = row.lastUpdated.toISOString().split("T")[0];
    const todayDate = new Date().toISOString().split("T")[0];
    const isStale = DAILY_CACHE ? cachedDate !== todayDate : false;
    return {
      symbol, market,
      price: parseFloat(row.price),
      currency: row.currency,
      priceChange: row.priceChange != null ? parseFloat(row.priceChange) : null,
      priceChangePct: row.priceChangePct != null ? parseFloat(row.priceChangePct) : null,
      lastUpdated: row.lastUpdated.toISOString(),
      source: row.source,
      isStale,
      priceLabel: isStale ? "Last Price" : "Last Close",
    };
  } catch {
    return null;
  }
}

async function setCachedPrice(symbol: string, market: string, result: Omit<PriceResult, "symbol" | "market" | "isStale" | "priceLabel">) {
  try {
    const existing = await db.select({ id: priceCacheTable.id }).from(priceCacheTable)
      .where(and(eq(priceCacheTable.symbol, symbol), eq(priceCacheTable.market, market)))
      .limit(1);
    const values = {
      symbol, market,
      price: String(result.price),
      currency: result.currency,
      priceChange: result.priceChange != null ? String(result.priceChange) : null,
      priceChangePct: result.priceChangePct != null ? String(result.priceChangePct) : null,
      lastUpdated: new Date(),
      source: result.source,
    };
    if (existing.length) {
      await db.update(priceCacheTable).set(values).where(eq(priceCacheTable.id, existing[0].id));
    } else {
      await db.insert(priceCacheTable).values(values);
    }
  } catch (err) {
    logger.warn({ err }, "Failed to cache price");
  }
}

// ─── Market-specific fetchers ──────────────────────────────────────────────────

const CRYPTO_COINGECKO_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin", SOL: "solana",
  ADA: "cardano", XRP: "ripple", DOGE: "dogecoin", DOT: "polkadot",
  MATIC: "matic-network", AVAX: "avalanche-2", LINK: "chainlink",
  UNI: "uniswap", LTC: "litecoin", ATOM: "cosmos", NEAR: "near",
  FTM: "fantom", ALGO: "algorand", VET: "vechain", TRX: "tron",
  SHIB: "shiba-inu", USDT: "tether", USDC: "usd-coin", BUSD: "binance-usd",
};

// Historical price fallback — most reliable for PSE stocks with sparse live data
async function fetchYahooHistoricalFallback(ticker: string): Promise<YahooFetchResult | null> {
  try {
    const period1 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // last 10 trading days
    const history = await (yahooFinance.historical as any)(
      ticker,
      { period1 },
      { validateResult: false }
    ) as Array<{ date: Date; close: number; open: number; high: number; low: number }>;

    if (!Array.isArray(history) || history.length === 0) return null;
    const valid = history.filter(h => h.close && h.close > 0);
    if (!valid.length) return null;
    const last = valid[valid.length - 1];
    return { price: last.close, currency: "PHP", change: null, changePct: null, priceLabel: "Last Close" };
  } catch {
    return null;
  }
}

// Direct Yahoo Finance V8 chart API — equivalent to Python yfinance stock.history(period="5d")
async function fetchYahooChartDirect(ticker: string): Promise<YahooFetchResult | null> {
  try {
    const encodedTicker = encodeURIComponent(ticker);
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodedTicker}?interval=1d&range=10d&includePrePost=false`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    // Try regularMarketPrice from meta first (most reliable)
    const metaPrice: number | null = result.meta?.regularMarketPrice ?? result.meta?.chartPreviousClose ?? null;
    if (metaPrice && metaPrice > 0) {
      return { price: metaPrice, currency: "PHP", change: null, changePct: null, priceLabel: "Last Trading Day Price" };
    }

    // Fall back to last valid close from OHLC series
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((c): c is number => c != null && c > 0);
    if (!validCloses.length) return null;
    return { price: validCloses[validCloses.length - 1], currency: "PHP", change: null, changePct: null, priceLabel: "Latest Available Price" };
  } catch {
    return null;
  }
}

// Phisix API — primary PHP stock data source (free, real-time PSE data)
async function fetchPhisixPrice(symbol: string): Promise<YahooFetchResult | null> {
  try {
    const url = `https://phisix-api4.appspot.com/stocks/${encodeURIComponent(symbol)}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const stock = data?.stock?.[0];
    if (!stock) return null;
    const price = parseFloat(String(stock.price?.amount ?? "0"));
    if (!price || price <= 0) return null;
    const pctChange = parseFloat(String(stock.percent_change ?? "0")) || null;
    return { price, currency: "PHP", change: null, changePct: pctChange, priceLabel: "PSE Live" };
  } catch {
    return null;
  }
}

async function fetchPSEPrice(symbol: string): Promise<YahooFetchResult | null> {
  // Step 1: Phisix API — primary PHP stock data, free and real-time from PSE
  const phisix = await fetchPhisixPrice(symbol);
  if (phisix && phisix.price > 0) return phisix;
  // Step 2: Yahoo quote() — tries regularMarketPrice, currentPrice, bid/ask, previousClose
  for (const suffix of [".PS", ".PSE"]) {
    const r = await fetchYahooPrice(`${symbol}${suffix}`);
    if (r && r.price > 0) return { ...r, currency: "PHP" };
  }
  // Step 3: Yahoo quoteSummary — more robust for delayed / international data
  for (const suffix of [".PS", ".PSE"]) {
    const r = await fetchYahooQuoteSummary(`${symbol}${suffix}`);
    if (r && r.price > 0) return { ...r, currency: "PHP" };
  }
  // Step 4: Yahoo historical() — pull recent price history and take the last close
  for (const suffix of [".PS", ".PSE"]) {
    const r = await fetchYahooHistoricalFallback(`${symbol}${suffix}`);
    if (r && r.price > 0) return { ...r, currency: "PHP" };
  }
  // Step 5: Direct Yahoo V8 chart API — same as Python yfinance stock.history(period="5d")
  for (const suffix of [".PS", ".PSE"]) {
    const r = await fetchYahooChartDirect(`${symbol}${suffix}`);
    if (r && r.price > 0) return { ...r, currency: "PHP" };
  }
  return null;
}

async function fetchUSPrice(symbol: string): Promise<YahooFetchResult | null> {
  // Primary: Yahoo Finance
  const yf = await fetchYahooPrice(symbol);
  if (yf && yf.price > 0) return yf;
  // Optional fallback: EODHD (if key is configured)
  if (EODHD_KEY) {
    const eodhd = await fetchEodhdPrice(`${symbol}.US`);
    if (eodhd && eodhd.price > 0) {
      return { price: eodhd.price, currency: "USD", change: eodhd.change, changePct: eodhd.changePct, priceLabel: "Last Close" };
    }
  }
  return null;
}

async function fetchLSEPrice(symbol: string): Promise<YahooFetchResult | null> {
  // Primary: Yahoo Finance (uses .L suffix; pence normalization is handled inside fetchYahooPrice)
  const yf = await fetchYahooPrice(`${symbol}.L`);
  if (yf && yf.price > 0) return yf;
  // Optional fallback: EODHD (if key is configured)
  if (EODHD_KEY) {
    const eodhd = await fetchEodhdPrice(`${symbol}.LSE`);
    if (eodhd && eodhd.price > 0) {
      return { price: eodhd.price, currency: "GBP", change: eodhd.change, changePct: eodhd.changePct, priceLabel: "Last Close" };
    }
  }
  return null;
}

// ─── PSE dedicated fetcher (bypasses generic price_cache) ─────────────────────

async function fetchPsePrice(symbol: string): Promise<PriceResult> {
  const market = "PSE";
  const sym = symbol.toUpperCase();

  // Step 1: EODHD PSE adapter — budget-aware, Asia/Manila timing, DB-cached
  const pseResult = await getPsePrice(sym);
  if (pseResult && pseResult.price > 0) {
    return {
      symbol: sym, market,
      price: pseResult.price,
      currency: "PHP",
      priceChange: pseResult.change,
      priceChangePct: pseResult.changePct,
      lastUpdated: new Date().toISOString(),
      source: pseResult.source,
      isStale: false,
      priceLabel: pseResult.priceLabel,
    };
  }

  // Step 2: Phisix + Yahoo waterfall (when EODHD is outside its fetch window or key missing)
  const fallback = await fetchPSEPrice(sym);
  if (fallback && fallback.price > 0) {
    // Persist into pse_price_cache so Add Transaction and next load reuse it
    await savePsePriceCache(sym, {
      lastClose: fallback.price,
      lastTradingDate: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }),
      fetchedAt: new Date(),
      source: "phisix",
      change: fallback.change,
      changePct: fallback.changePct,
    });
    return {
      symbol: sym, market,
      price: fallback.price,
      currency: "PHP",
      priceChange: fallback.change,
      priceChangePct: fallback.changePct,
      lastUpdated: new Date().toISOString(),
      source: "phisix",
      isStale: false,
      priceLabel: fallback.priceLabel,
    };
  }

  // Step 3: check pse_price_cache for any prior price (stale is fine, beats ₱0)
  const staleCache = await getCachedPsePrice(sym);
  if (staleCache && staleCache.lastClose > 0) {
    return {
      symbol: sym, market,
      price: staleCache.lastClose,
      currency: "PHP",
      priceChange: staleCache.change,
      priceChangePct: staleCache.changePct,
      lastUpdated: staleCache.fetchedAt.toISOString(),
      source: staleCache.source,
      isStale: true,
      priceLabel: "Last Price",
    };
  }

  // Nothing worked — return null price, never ₱0.00
  return {
    symbol: sym, market,
    price: 0,
    currency: "PHP",
    priceChange: null, priceChangePct: null,
    lastUpdated: new Date().toISOString(),
    source: null, isStale: true, priceLabel: "Unavailable",
  };
}

export async function fetchPrice(symbol: string, market: string): Promise<PriceResult> {
  // PSE uses its own dedicated cache (pse_price_cache) with Asia/Manila timing.
  // Bypass the generic price_cache entirely for PSE symbols.
  if (isPseSymbol(market)) {
    return fetchPsePrice(symbol);
  }

  const cached = await getCachedPrice(symbol, market);
  if (cached && !cached.isStale) return cached;

  let result: PriceResult | null = null;

  if (market === "CRYPTO") {
    const coinId = CRYPTO_COINGECKO_MAP[symbol.toUpperCase()] ?? symbol.toLowerCase();
    const cgResult = await fetchFromCoinGecko(coinId);
    if (cgResult) {
      result = { symbol, market, price: cgResult.price, currency: "USD", priceChange: cgResult.change, priceChangePct: cgResult.changePct, lastUpdated: new Date().toISOString(), source: "coingecko", isStale: false, priceLabel: "Live" };
    } else {
      const yahooResult = await fetchYahooPrice(`${symbol}-USD`);
      if (yahooResult) result = { symbol, market, price: yahooResult.price, currency: "USD", priceChange: yahooResult.change, priceChangePct: yahooResult.changePct, lastUpdated: new Date().toISOString(), source: "yahoo", isStale: false, priceLabel: yahooResult.priceLabel };
    }
  } else if (market === "CUSTOM") {
    result = cached ?? { symbol, market, price: 0, currency: "USD", priceChange: null, priceChangePct: null, lastUpdated: new Date().toISOString(), source: null, isStale: false, priceLabel: "Manual" };
  } else if (market === "LSE") {
    const lseResult = await fetchLSEPrice(symbol);
    if (lseResult) result = { symbol, market, price: lseResult.price, currency: lseResult.currency, priceChange: lseResult.change, priceChangePct: lseResult.changePct, lastUpdated: new Date().toISOString(), source: "yahoo", isStale: false, priceLabel: lseResult.priceLabel };
  } else if (market === "US") {
    const usResult = await fetchUSPrice(symbol);
    if (usResult) result = { symbol, market, price: usResult.price, currency: usResult.currency, priceChange: usResult.change, priceChangePct: usResult.changePct, lastUpdated: new Date().toISOString(), source: "yahoo", isStale: false, priceLabel: usResult.priceLabel };
  } else {
    const suffix = MARKET_SUFFIXES[market] ?? "";
    const yahooResult = await fetchYahooPrice(`${symbol}${suffix}`);
    if (yahooResult) result = { symbol, market, price: yahooResult.price, currency: yahooResult.currency, priceChange: yahooResult.change, priceChangePct: yahooResult.changePct, lastUpdated: new Date().toISOString(), source: "yahoo", isStale: false, priceLabel: yahooResult.priceLabel };
  }

  if (result) {
    await setCachedPrice(symbol, market, result);
    return result;
  }

  if (cached) return { ...cached, isStale: true, priceLabel: "Last Price" };

  return {
    symbol, market, price: 0,
    currency: market === "PSE" ? "PHP" : market === "LSE" ? "GBP" : "USD",
    priceChange: null, priceChangePct: null,
    lastUpdated: new Date().toISOString(), source: null, isStale: true, priceLabel: "Unavailable",
  };
}

// ─── Cache bust ────────────────────────────────────────────────────────────────

// Purge any cached entries where price = 0 so they get re-fetched fresh.
// Call once at server startup to clear stale zero-prices from previous failed fetches.
export async function clearStalePriceCache(): Promise<void> {
  try {
    const { sql } = await import("drizzle-orm");
    await db.delete(priceCacheTable).where(sql`CAST(${priceCacheTable.price} AS NUMERIC) = 0`);
    logger.info("Cleared stale zero-price cache entries");
  } catch (err) {
    logger.warn({ err }, "Failed to clear stale price cache");
  }
}

// Delete cached prices for specific symbols so they get re-fetched fresh on next call.
// PSE symbols are cleared from pse_price_cache; all others from price_cache.
export async function clearPriceCacheForSymbols(symbolMarkets: Array<{ symbol: string; market: string }>): Promise<void> {
  try {
    await Promise.all(
      symbolMarkets.map(({ symbol, market }) => {
        if (isPseSymbol(market)) {
          return deletePsePriceCache(symbol);
        }
        return db.delete(priceCacheTable).where(
          and(eq(priceCacheTable.symbol, symbol), eq(priceCacheTable.market, market))
        );
      })
    );
  } catch (err) {
    logger.warn({ err }, "Failed to clear price cache for symbols");
  }
}

export async function fetchPrices(symbolMarkets: Array<{ symbol: string; market: string }>): Promise<PriceResult[]> {
  const results = await Promise.allSettled(
    symbolMarkets.map(({ symbol, market }) => fetchPrice(symbol, market))
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const { symbol, market } = symbolMarkets[i];
    return {
      symbol, market, price: 0,
      currency: market === "PSE" ? "PHP" : market === "LSE" ? "GBP" : "USD",
      priceChange: null, priceChangePct: null,
      lastUpdated: new Date().toISOString(), source: null, isStale: true, priceLabel: "Unavailable",
    };
  });
}

// ─── Symbol Search ──────────────────────────────────────────────────────────────

type SymbolSearchResult = { symbol: string; name: string; market: string; currency: string; exchange: string | null };

function detectMarket(q: any): string {
  const sym: string = q.symbol ?? "";
  if (sym.endsWith(".PS") || sym.endsWith(".PSE") || q.exchange === "PHS") return "PSE";
  if (sym.endsWith(".L") || q.exchange === "LSE") return "LSE";
  if (q.quoteType === "CRYPTOCURRENCY") return "CRYPTO";
  return "US";
}

// Search EODHD for a query, returning raw results
async function searchEodhd(query: string): Promise<Array<{ Code: string; Name: string; Exchange: string; Type: string; ISIN: string; Currency: string }>> {
  if (!EODHD_KEY) return [];
  try {
    const url = `https://eodhd.com/api/search/${encodeURIComponent(query)}?api_token=${EODHD_KEY}&limit=20&fmt=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as any[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function searchSymbols(query: string, market?: string): Promise<SymbolSearchResult[]> {
  try {
    // PSE — use curated static list for instant, accurate results
    if (market === "PSE") {
      return searchPseStocks(query).map(s => ({
        symbol: s.symbol, name: s.name, market: "PSE", currency: "PHP", exchange: "PSE",
      }));
    }

    if (market === "CRYPTO") {
      const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json() as { coins?: Array<{ id: string; symbol: string; name: string }> };
        return (data.coins ?? []).slice(0, 10).map(c => ({
          symbol: c.symbol.toUpperCase(), name: c.name, market: "CRYPTO", currency: "USD", exchange: null,
        }));
      }
      return [];
    }

    // Yahoo Finance for US, LSE, and any other market (EODHD available as optional fallback if key is set)
    const primaryQuery = market === "LSE" ? `${query}.L` : query;
    const primary = await (yahooFinance.search as any)(primaryQuery, {}, { validateResult: false }) as any;
    let quotes: any[] = ((primary.quotes ?? []) as any[]).filter((q: any) => q.quoteType !== "OPTION");

    if (market === "LSE" && quotes.length < 3) {
      const fallback = await (yahooFinance.search as any)(query, {}, { validateResult: false }) as any;
      const fbQuotes = ((fallback.quotes ?? []) as any[]).filter((q: any) => q.quoteType !== "OPTION");
      const seen = new Set(quotes.map((q: any) => q.symbol));
      for (const q of fbQuotes) {
        if (!seen.has(q.symbol)) { quotes.push(q); seen.add(q.symbol); }
      }
    }

    const results: SymbolSearchResult[] = [];
    for (const q of quotes) {
      const qMarket = detectMarket(q);
      if (market === "LSE" && qMarket !== "LSE") continue;
      if (market === "US" && (qMarket === "PSE" || qMarket === "LSE" || qMarket === "CRYPTO")) continue;
      const sym: string = q.symbol ?? "";
      results.push({
        symbol: sym.replace(/\.(L|PS|PSE)$/, "") || sym,
        name: q.longname ?? q.shortname ?? sym,
        market: market ?? qMarket,
        currency: q.currency ?? (qMarket === "LSE" ? "GBP" : "USD"),
        exchange: q.exchange ?? null,
      });
      if (results.length >= 12) break;
    }

    return results;
  } catch (err) {
    logger.warn({ err }, "Symbol search failed");
    return [];
  }
}

// ─── Dividend Info ──────────────────────────────────────────────────────────────

export async function fetchDividendInfo(symbol: string, market: string): Promise<DividendInfoResult> {
  // PSE uses .PS suffix on Yahoo Finance; other markets use their own suffix
  const suffix = market === "PSE" ? ".PS" : (MARKET_SUFFIXES[market] ?? "");
  const ticker = `${symbol}${suffix}`;
  const currency = market === "PSE" ? "PHP" : market === "LSE" ? "GBP" : "USD";

  const pseName = market === "PSE"
    ? (PSE_STOCKS.find(s => s.symbol === symbol.toUpperCase())?.name ?? null)
    : null;

  const base: DividendInfoResult = {
    symbol, name: pseName, currency,
    dividendRate: null, dividendYield: null,
    exDividendDate: null, lastDividendValue: null, lastDividendDate: null,
    history: [],
  };

  try {
    const quote = await (yahooFinance.quote as any)(ticker, {}, { validateResult: false }) as any;
    if (!quote) return base;

    base.name = base.name ?? quote.longName ?? quote.shortName ?? null;

    const rate = quote.dividendRate ?? quote.trailingAnnualDividendRate ?? null;
    if (rate && rate > 0) base.dividendRate = rate;

    // Yahoo Finance returns dividendYield as a decimal (e.g. 0.035 = 3.5%) — convert to percent
    const rawYield = quote.dividendYield ?? quote.trailingAnnualDividendYield ?? null;
    if (rawYield && rawYield > 0) {
      base.dividendYield = rawYield < 1 ? rawYield * 100 : rawYield;
    }

    const rawExDate = quote.dividendDate ?? quote.exDividendDate ?? null;
    if (rawExDate) {
      const dt = typeof rawExDate === "number"
        ? new Date(rawExDate * 1000)
        : new Date(rawExDate);
      if (!isNaN(dt.getTime())) base.exDividendDate = dt.toISOString().split("T")[0];
    }

    try {
      const period1 = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);
      const rawHistory = await (yahooFinance.historical as any)(
        ticker,
        { period1, events: "dividends" },
        { validateResult: false }
      ) as Array<{ date: Date; dividends: number }>;

      if (Array.isArray(rawHistory) && rawHistory.length > 0) {
        base.history = rawHistory
          .filter(h => h.dividends > 0)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 10)
          .map(h => ({
            date: new Date(h.date).toISOString().split("T")[0],
            amount: h.dividends,
          }));

        if (base.history.length > 0) {
          base.lastDividendValue = base.history[0].amount;
          base.lastDividendDate = base.history[0].date;
          if (!base.exDividendDate) base.exDividendDate = base.history[0].date;
        }
      }
    } catch {
      // history unavailable
    }

    return base;
  } catch (err) {
    logger.warn({ err, symbol, market }, "fetchDividendInfo failed");
    return base;
  }
}

// ─── Chart Data ──────────────────────────────────────────────────────────────

export async function fetchChartData(
  symbol: string,
  market: string,
  period1: string,
  interval: string
): Promise<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>> {
  const suffix = market === "PSE" ? ".PS" : market === "CRYPTO" ? "-USD" : (MARKET_SUFFIXES[market] ?? "");
  const ticker = `${symbol}${suffix}`;

  try {
    const data = await (yahooFinance.historical as any)(
      ticker,
      { period1: new Date(period1), interval: interval as any },
      { validateResult: false }
    ) as Array<{ date: Date; open?: number; high?: number; low?: number; close?: number; volume?: number }>;

    return (data ?? [])
      .filter((d: any) => d.close != null && d.close > 0)
      .map((d: any) => ({
        date: new Date(d.date).toISOString().split("T")[0],
        open: d.open ?? 0,
        high: d.high ?? 0,
        low: d.low ?? 0,
        close: d.close as number,
        volume: d.volume ?? 0,
      }));
  } catch (err) {
    logger.warn({ err, symbol, market }, "fetchChartData failed");
    return [];
  }
}

// ─── Quote Detail ────────────────────────────────────────────────────────────

export async function fetchQuoteDetail(symbol: string, market: string): Promise<any> {
  const suffix = market === "PSE" ? ".PS" : market === "CRYPTO" ? "-USD" : (MARKET_SUFFIXES[market] ?? "");
  const ticker = `${symbol}${suffix}`;

  try {
    const [quoteRes, summaryRes] = await Promise.allSettled([
      (yahooFinance.quote as any)(ticker, {}, { validateResult: false }),
      (yahooFinance.quoteSummary as any)(
        ticker,
        { modules: ["assetProfile", "defaultKeyStatistics", "summaryDetail"] },
        { validateResult: false }
      ),
    ]);

    const q = quoteRes.status === "fulfilled" ? quoteRes.value as any : null;
    const s = summaryRes.status === "fulfilled" ? summaryRes.value as any : null;

    const profile  = s?.assetProfile;
    const keyStats = s?.defaultKeyStatistics;
    const sumDetail = s?.summaryDetail;

    const rawYield = q?.dividendYield ?? q?.trailingAnnualDividendYield ?? sumDetail?.dividendYield?.raw ?? null;
    const dividendYield = rawYield != null ? (rawYield < 1 ? rawYield * 100 : rawYield) : null;

    let exDivDate: string | null = null;
    const rawExDate = q?.dividendDate ?? q?.exDividendDate ?? null;
    if (rawExDate) {
      const dt = typeof rawExDate === "number" ? new Date(rawExDate * 1000) : new Date(rawExDate);
      if (!isNaN(dt.getTime())) exDivDate = dt.toISOString().split("T")[0];
    }

    return {
      symbol,
      name:       q?.longName ?? q?.shortName ?? null,
      currency:   q?.currency ?? null,
      beta:       keyStats?.beta?.raw ?? sumDetail?.beta?.raw ?? null,
      sector:     profile?.sector ?? null,
      industry:   profile?.industry ?? null,
      country:    profile?.country ?? null,
      dividendYield,
      dividendRate:           q?.dividendRate ?? q?.trailingAnnualDividendRate ?? sumDetail?.dividendRate?.raw ?? null,
      exDividendDate:         exDivDate,
      payoutRatio:            sumDetail?.payoutRatio?.raw ?? q?.payoutRatio ?? null,
      fiveYearAvgDividendYield: sumDetail?.fiveYearAvgDividendYield?.raw ?? null,
      trailingEps:            keyStats?.trailingEps?.raw ?? null,
      forwardPe:              q?.forwardPE ?? keyStats?.forwardPE?.raw ?? null,
      marketCap:              q?.marketCap ?? keyStats?.marketCap?.raw ?? null,
    };
  } catch (err) {
    logger.warn({ err, symbol, market }, "fetchQuoteDetail failed");
    return { symbol };
  }
}

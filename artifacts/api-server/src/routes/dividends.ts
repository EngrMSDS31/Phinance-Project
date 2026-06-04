import { Router } from "express";
import { db, portfoliosTable, holdingsTable, dividendEventsTable, transactionsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();

const SUPPORTED_MARKETS = new Set(["US", "LSE", "PSE"]);

const MARKET_YAHOO_SUFFIX: Record<string, string> = {
  US: "",
  LSE: ".L",
  PSE: ".PS",
};

const MARKET_CURRENCY: Record<string, string> = {
  US: "USD",
  LSE: "GBP",
  PSE: "PHP",
};

async function fetchYahooDividends(symbol: string, market: string): Promise<Array<{ date: string; amount: number; currency: string }>> {
  if (!SUPPORTED_MARKETS.has(market)) return [];
  const suffix = MARKET_YAHOO_SUFFIX[market] ?? "";
  const ticker = `${symbol}${suffix}`;
  const currency = MARKET_CURRENCY[market] ?? "USD";
  try {
    const period1 = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000); // last 2 years
    const history = await (yahooFinance.historical as any)(
      ticker,
      { period1, events: "dividends" },
      { validateResult: false }
    ) as Array<{ date: Date; dividends: number }>;

    if (!Array.isArray(history)) return [];
    return history
      .filter(h => h.dividends > 0)
      .map(h => ({
        date: new Date(h.date).toISOString().split("T")[0],
        amount: h.dividends,
        currency,
      }));
  } catch {
    return [];
  }
}

const router = Router();
router.use(requireAuth);

function formatEvent(e: any, isPaid = false) {
  return {
    id: e.id,
    portfolioId: e.portfolioId,
    holdingId: e.holdingId,
    symbol: e.symbol,
    name: e.name,
    dividendType: e.dividendType,
    exDate: e.exDate,
    recordDate: e.recordDate ?? null,
    paymentDate: e.paymentDate ?? null,
    dividendPerShare: e.dividendPerShare != null ? parseFloat(e.dividendPerShare) : null,
    totalAmount: parseFloat(e.totalAmount),
    currency: e.currency,
    notes: e.notes ?? null,
    createdAt: e.createdAt.toISOString(),
    isPaid,
  };
}

async function getUserPortfolioIds(userId: string): Promise<number[]> {
  const portfolios = await db.select({ id: portfoliosTable.id }).from(portfoliosTable)
    .where(eq(portfoliosTable.userId, userId));
  return portfolios.map(p => p.id);
}

// GET /api/dividend-calendar
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioIds = await getUserPortfolioIds(userId);
    if (portfolioIds.length === 0) { res.json([]); return; }

    const portfolioId = req.query.portfolioId ? parseInt(req.query.portfolioId as string) : null;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const targetIds = portfolioId ? [portfolioId] : portfolioIds;

    // Fetch real dividend events from DB
    const events = await db.select().from(dividendEventsTable)
      .where(inArray(dividendEventsTable.portfolioId, targetIds));

    // Fetch DIVIDEND transactions — these are the source of truth for paid dividends
    const divTxs = await db.select().from(transactionsTable)
      .where(and(
        inArray(transactionsTable.portfolioId, targetIds),
        eq(transactionsTable.type, "DIVIDEND")
      ));

    // Build tx key set: portfolioId:holdingId:date — used to detect which events are already paid
    const txKeys = new Set(
      divTxs.map(t => `${t.portfolioId}:${t.holdingId ?? ""}:${t.date ?? ""}`)
    );

    // Build real event key set: used to skip synthesizing duplicates from txs
    const eventKeys = new Set(
      events.map(e => `${e.portfolioId}:${e.holdingId ?? ""}:${e.exDate ?? ""}`)
    );

    // Fetch holding info for synthesizing events from orphan transactions
    const holdingIds = [...new Set(divTxs.filter(t => t.holdingId).map(t => t.holdingId!))];
    const txHoldings = holdingIds.length
      ? await db.select().from(holdingsTable).where(inArray(holdingsTable.id, holdingIds))
      : [];
    const holdingMap = new Map(txHoldings.map(h => [h.id, h]));

    // Annotate real events with isPaid when a matching DIVIDEND transaction exists
    const formattedEvents = events.map(e => {
      const key = `${e.portfolioId}:${e.holdingId ?? ""}:${e.exDate ?? ""}`;
      const isPaid = txKeys.has(key);
      return formatEvent(e, isPaid);
    });

    // Synthesize paid events from DIVIDEND transactions that have NO matching real event
    const syntheticEvents: any[] = [];
    for (const tx of divTxs) {
      const txDate = tx.date ?? "";
      const key = `${tx.portfolioId}:${tx.holdingId ?? ""}:${txDate}`;
      if (eventKeys.has(key)) continue; // real event exists and is already annotated above

      const holding = tx.holdingId ? holdingMap.get(tx.holdingId) : undefined;
      const grossAmt = parseFloat(tx.amount ?? "0");
      const fee = tx.feeAmount ? parseFloat(tx.feeAmount) : 0;
      const tax = tx.taxAmount ? parseFloat(tx.taxAmount) : 0;
      const netAmt = Math.max(0, grossAmt - fee - tax);
      const txQty = tx.quantity ? parseFloat(tx.quantity) : null;
      const txPricePerShare = tx.price ? parseFloat(tx.price) : null;

      syntheticEvents.push({
        id: -(tx.id), // negative ID = synthesised from transaction = already paid
        portfolioId: tx.portfolioId,
        holdingId: tx.holdingId ?? null,
        symbol: holding?.symbol ?? tx.notes?.match(/from (\S+)/)?.[1] ?? "DIVIDEND",
        name: holding?.name ?? null,
        dividendType: "ORDINARY",
        exDate: txDate,
        recordDate: null,
        paymentDate: txDate,
        dividendPerShare: txPricePerShare,
        quantity: txQty,
        grossAmount: grossAmt,
        taxAmount: tax,
        totalAmount: netAmt,
        currency: tx.currency ?? "USD",
        notes: tx.notes ?? null,
        createdAt: tx.createdAt.toISOString(),
        isPaid: true,
      });
      // Track to prevent double-synthetic if multiple txs share same key
      eventKeys.add(key);
    }

    const allEvents = [...formattedEvents, ...syntheticEvents];

    const filtered = allEvents.filter(e => {
      if (from && (e.exDate ?? "") < from) return false;
      if (to && (e.exDate ?? "") > to) return false;
      return true;
    });

    filtered.sort((a, b) => (a.exDate ?? "").localeCompare(b.exDate ?? ""));
    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "listDividendEvents failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/dividend-calendar
router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId, holdingId, dividendType = "ORDINARY", exDate, recordDate, paymentDate, dividendPerShare, totalAmount, currency = "USD", notes } = req.body;

    if (!portfolioId || !holdingId || !exDate || totalAmount == null) {
      res.status(400).json({ error: "portfolioId, holdingId, exDate, totalAmount required" });
      return;
    }

    const portfolioIds = await getUserPortfolioIds(userId);
    if (!portfolioIds.includes(portfolioId)) { res.status(403).json({ error: "Forbidden" }); return; }

    const [holding] = await db.select().from(holdingsTable).where(eq(holdingsTable.id, holdingId));
    if (!holding) { res.status(404).json({ error: "Holding not found" }); return; }

    const [event] = await db.insert(dividendEventsTable).values({
      portfolioId, holdingId, symbol: holding.symbol, name: holding.name,
      dividendType, exDate,
      recordDate: recordDate ?? null,
      paymentDate: paymentDate ?? null,
      dividendPerShare: dividendPerShare != null ? String(dividendPerShare) : null,
      totalAmount: String(totalAmount),
      currency, notes,
    }).returning();

    res.status(201).json(formatEvent(event));
  } catch (err) {
    req.log.error({ err }, "createDividendEvent failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/dividend-calendar/:eventId
router.patch("/:eventId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const eventId = parseInt(req.params.eventId);
    const portfolioIds = await getUserPortfolioIds(userId);

    const [existing] = await db.select().from(dividendEventsTable)
      .where(eq(dividendEventsTable.id, eventId));
    if (!existing || !portfolioIds.includes(existing.portfolioId)) {
      res.status(404).json({ error: "Not found" }); return;
    }

    const updates: any = {};
    const fields = ["dividendType", "exDate", "recordDate", "paymentDate", "notes"];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body.dividendPerShare !== undefined) updates.dividendPerShare = req.body.dividendPerShare != null ? String(req.body.dividendPerShare) : null;
    if (req.body.totalAmount !== undefined) updates.totalAmount = String(req.body.totalAmount);

    const [updated] = await db.update(dividendEventsTable).set(updates)
      .where(eq(dividendEventsTable.id, eventId)).returning();
    res.json(formatEvent(updated));
  } catch (err) {
    req.log.error({ err }, "updateDividendEvent failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/dividend-calendar/sync/:portfolioId
// Syncs historical dividend schedule from Yahoo Finance for all holdings.
// Only inserts events that:
//   (a) don't already exist as a dividendEventsTable row, AND
//   (b) don't already have a matching DIVIDEND transaction (which means they're already paid)
// Never touches existing transactions — only adds calendar placeholders for past/upcoming dividends.
router.post("/sync/:portfolioId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt(req.params.portfolioId);
    const portfolioIds = await getUserPortfolioIds(userId);
    if (!portfolioIds.includes(portfolioId)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const holdings = await db.select().from(holdingsTable)
      .where(eq(holdingsTable.portfolioId, portfolioId));

    const marketHoldings = holdings.filter(h => SUPPORTED_MARKETS.has(h.market));

    // Load existing DIVIDEND transactions for this portfolio (dedup guard)
    const existingTxs = await db.select({
      holdingId: transactionsTable.holdingId,
      date: transactionsTable.date,
    }).from(transactionsTable)
      .where(and(
        eq(transactionsTable.portfolioId, portfolioId),
        eq(transactionsTable.type, "DIVIDEND")
      ));

    // txDedupKeys: holdingId:date — if a DIVIDEND tx exists for this pair, skip insert
    const txDedupKeys = new Set(
      existingTxs
        .filter(t => t.holdingId && t.date)
        .map(t => `${t.holdingId}:${t.date}`)
    );

    let synced = 0;
    let errors = 0;

    for (const holding of marketHoldings) {
      const dividends = await fetchYahooDividends(holding.symbol, holding.market);
      if (!dividends.length) continue;

      for (const div of dividends) {
        try {
          // Skip if a DIVIDEND transaction already exists for this holding + date
          // (the user already recorded it — the GET will synthesize a paid event in-memory)
          if (txDedupKeys.has(`${holding.id}:${div.date}`)) continue;

          // Skip if a dividend event row already exists in the DB
          const existing = await db.select({ id: dividendEventsTable.id })
            .from(dividendEventsTable)
            .where(and(
              eq(dividendEventsTable.portfolioId, portfolioId),
              eq(dividendEventsTable.holdingId, holding.id),
              eq(dividendEventsTable.exDate, div.date),
            ));

          if (existing.length === 0) {
            const qty = parseFloat(holding.quantity);
            const totalAmount = div.amount * (qty > 0 ? qty : 1);
            await db.insert(dividendEventsTable).values({
              portfolioId,
              holdingId: holding.id,
              symbol: holding.symbol,
              name: holding.name,
              dividendType: "ORDINARY",
              exDate: div.date,
              recordDate: null,
              paymentDate: div.date,
              dividendPerShare: String(div.amount),
              totalAmount: String(totalAmount),
              currency: div.currency,
              notes: "Synced from Yahoo Finance",
            });
            synced++;
          }
        } catch {
          errors++;
        }
      }
    }

    res.json({ synced, errors, holdingsProcessed: marketHoldings.length });
  } catch (err) {
    req.log.error({ err }, "syncDividends failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/dividend-calendar/:eventId
router.delete("/:eventId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const eventId = parseInt(req.params.eventId);
    const portfolioIds = await getUserPortfolioIds(userId);

    const [existing] = await db.select().from(dividendEventsTable)
      .where(eq(dividendEventsTable.id, eventId));
    if (!existing || !portfolioIds.includes(existing.portfolioId)) {
      res.status(404).json({ error: "Not found" }); return;
    }

    await db.delete(dividendEventsTable).where(eq(dividendEventsTable.id, eventId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteDividendEvent failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

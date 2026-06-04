import { Router } from "express";
import { db, portfoliosTable, holdingsTable, transactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrices } from "../lib/prices";

const router = Router();
router.use(requireAuth);

// POST /api/sizer/calculate
// Body: { cash, method, portfolioId, positions: [{symbol, market, stopLossPct?, allocationPct?}], riskPct? }
router.post("/calculate", async (req, res) => {
  try {
    const {
      cash,
      method,          // "EQUAL" | "CUSTOM" | "RISK"
      portfolioId,
      positions,       // [{symbol, market, stopLossPct?, allocationPct?, name?}]
      riskPct,         // used by RISK method: % of portfolio to risk per trade
      portfolioValue,  // used by RISK method
    } = req.body;

    if (!cash || !positions?.length || !method) {
      res.status(400).json({ error: "cash, positions, and method are required" });
      return;
    }

    const cashNum = parseFloat(cash);
    if (isNaN(cashNum) || cashNum <= 0) {
      res.status(400).json({ error: "cash must be a positive number" });
      return;
    }

    // Fetch live prices
    const priceInputs = positions.map((p: any) => ({ symbol: p.symbol.toUpperCase(), market: p.market ?? "US" }));
    let priceResults: Array<{ symbol: string; market: string; price: number; currency: string }> = [];
    try {
      priceResults = await fetchPrices(priceInputs);
    } catch {
      res.status(502).json({ error: "Failed to fetch prices" });
      return;
    }
    const priceMap = new Map(priceResults.map(p => [`${p.symbol}:${p.market}`, p]));

    const n = positions.length;
    const riskFraction = (parseFloat(riskPct ?? "1") || 1) / 100;
    const pv = parseFloat(portfolioValue ?? "0") || cashNum;

    const results = positions.map((pos: any, i: number) => {
      const symbol = pos.symbol.toUpperCase();
      const market = pos.market ?? "US";
      const key = `${symbol}:${market}`;
      const priceData = priceMap.get(key);
      const price = priceData?.price ?? null;
      const currency = priceData?.currency ?? "USD";

      let dollarAmount: number;

      if (method === "EQUAL") {
        dollarAmount = cashNum / n;
      } else if (method === "CUSTOM") {
        const pct = parseFloat(pos.allocationPct ?? "0") || 0;
        dollarAmount = (pct / 100) * cashNum;
      } else if (method === "RISK") {
        // positionSize = (portfolio × riskFraction) / stopLossPct
        const stopFrac = (parseFloat(pos.stopLossPct ?? "5") || 5) / 100;
        dollarAmount = stopFrac > 0 ? (pv * riskFraction) / stopFrac : 0;
        // cap to available share of cash
        dollarAmount = Math.min(dollarAmount, cashNum);
      } else {
        dollarAmount = cashNum / n;
      }

      const shares = price && price > 0 ? dollarAmount / price : null;
      const actualCost = shares != null && price != null ? shares * price : null;

      return {
        symbol,
        name: pos.name ?? symbol,
        market,
        currency,
        price,
        allocationPct: method === "EQUAL" ? (100 / n) : (parseFloat(pos.allocationPct ?? "0") || 0),
        stopLossPct: method === "RISK" ? (parseFloat(pos.stopLossPct ?? "5") || 5) : null,
        dollarAmount,
        shares,
        actualCost,
        priceFound: price != null,
      };
    });

    const totalCost = results.reduce((s: number, r: any) => s + (r.actualCost ?? 0), 0);
    const remainingCash = cashNum - totalCost;

    res.json({ results, totalCost, remainingCash, cash: cashNum, method });
  } catch (err) {
    req.log.error({ err }, "sizer.calculate failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/sizer/execute
// Creates BUY transactions for all calculated positions
router.post("/execute", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId, trades } = req.body;
    // trades: [{symbol, name, market, price, shares, dollarAmount, currency, holdingId?}]

    if (!portfolioId || !trades?.length) {
      res.status(400).json({ error: "portfolioId and trades required" });
      return;
    }

    const pid = parseInt(portfolioId);
    const [portfolio] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, pid), eq(portfoliosTable.userId, userId)));
    if (!portfolio) { res.status(404).json({ error: "Portfolio not found" }); return; }

    const today = new Date().toISOString().slice(0, 10);
    const created: number[] = [];

    for (const trade of trades) {
      if (!trade.shares || trade.shares <= 0 || !trade.price || trade.price <= 0) continue;

      // Find or create holding
      let [holding] = await db.select().from(holdingsTable)
        .where(and(eq(holdingsTable.portfolioId, pid), eq(holdingsTable.symbol, trade.symbol.toUpperCase())));

      if (!holding) {
        [holding] = await db.insert(holdingsTable).values({
          portfolioId: pid,
          symbol: trade.symbol.toUpperCase(),
          name: trade.name ?? trade.symbol,
          market: trade.market ?? "US",
          currency: trade.currency ?? "USD",
          quantity: "0",
          avgCostBasis: "0",
          currentPrice: String(trade.price),
        }).returning();
      }

      const amount = trade.shares * trade.price;

      // Create BUY transaction
      await db.insert(transactionsTable).values({
        portfolioId: pid,
        holdingId: holding.id,
        type: "BUY",
        date: today,
        quantity: String(trade.shares),
        price: String(trade.price),
        amount: String(amount),
        currency: trade.currency ?? "USD",
        notes: "Position sizer trade",
      });

      // Recalc holding
      const txs = await db.select().from(transactionsTable)
        .where(eq(transactionsTable.holdingId, holding.id));
      let qty = 0, totalCost = 0;
      for (const tx of txs) {
        const q = parseFloat(tx.quantity ?? "0");
        const p = parseFloat(tx.price ?? "0");
        if (tx.type === "BUY") { qty += q; totalCost += q * p; }
        else if (tx.type === "SELL") { qty -= q; }
      }
      const avg = qty > 0 ? totalCost / qty : 0;
      await db.update(holdingsTable)
        .set({ quantity: String(Math.max(0, qty)), avgCostBasis: String(avg), currentPrice: String(trade.price), lastPriceUpdate: new Date() })
        .where(eq(holdingsTable.id, holding.id));

      // Deduct from cash balance
      await db.update(portfoliosTable)
        .set({ cashBalance: sql`cash_balance - ${String(amount)}` })
        .where(eq(portfoliosTable.id, pid));

      created.push(holding.id);
    }

    res.json({ created: created.length, message: `${created.length} trade(s) executed` });
  } catch (err) {
    req.log.error({ err }, "sizer.execute failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

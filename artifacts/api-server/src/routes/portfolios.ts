import { Router } from "express";
import { db, portfoliosTable, holdingsTable, transactionsTable, dividendEventsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrices } from "../lib/prices";

const router = Router();

router.use(requireAuth);

// GET /api/portfolios
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolios = await db.select().from(portfoliosTable).where(eq(portfoliosTable.userId, userId));
    res.json(portfolios.map(p => ({
      ...p,
      cashBalance: parseFloat(p.cashBalance),
      defaultFeeRate: parseFloat(p.defaultFeeRate),
      sellFeeRate: parseFloat(p.sellFeeRate),
      defaultTaxRate: parseFloat(p.defaultTaxRate),
      createdAt: p.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "listPortfolios failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/portfolios
router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { name, baseCurrency, type, defaultFeeRate = 0, sellFeeRate = 0, defaultTaxRate = 0, notes, color } = req.body;
    if (!name || !baseCurrency || !type) {
      res.status(400).json({ error: "name, baseCurrency, type are required" });
      return;
    }
    const [portfolio] = await db.insert(portfoliosTable).values({
      userId, name, baseCurrency, type,
      defaultFeeRate: String(defaultFeeRate),
      sellFeeRate: String(sellFeeRate),
      defaultTaxRate: String(defaultTaxRate),
      notes,
      color: color ?? null,
    }).returning();
    res.status(201).json({
      ...portfolio,
      cashBalance: parseFloat(portfolio.cashBalance),
      defaultFeeRate: parseFloat(portfolio.defaultFeeRate),
      sellFeeRate: parseFloat(portfolio.sellFeeRate),
      defaultTaxRate: parseFloat(portfolio.defaultTaxRate),
      createdAt: portfolio.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "createPortfolio failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/portfolios/:portfolioId
router.get("/:portfolioId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt(req.params.portfolioId);
    const [portfolio] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
    if (!portfolio) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      ...portfolio,
      cashBalance: parseFloat(portfolio.cashBalance),
      defaultFeeRate: parseFloat(portfolio.defaultFeeRate),
      sellFeeRate: parseFloat(portfolio.sellFeeRate),
      defaultTaxRate: parseFloat(portfolio.defaultTaxRate),
      createdAt: portfolio.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "getPortfolio failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/portfolios/:portfolioId
router.patch("/:portfolioId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt(req.params.portfolioId);
    const [existing] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updates: Partial<typeof portfoliosTable.$inferInsert> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.baseCurrency !== undefined) updates.baseCurrency = req.body.baseCurrency;
    if (req.body.type !== undefined) updates.type = req.body.type;
    if (req.body.defaultFeeRate !== undefined) updates.defaultFeeRate = String(req.body.defaultFeeRate);
    if (req.body.sellFeeRate !== undefined) updates.sellFeeRate = String(req.body.sellFeeRate);
    if (req.body.defaultTaxRate !== undefined) updates.defaultTaxRate = String(req.body.defaultTaxRate);
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.color !== undefined) updates.color = req.body.color;

    const [updated] = await db.update(portfoliosTable).set(updates)
      .where(eq(portfoliosTable.id, portfolioId)).returning();
    res.json({
      ...updated,
      cashBalance: parseFloat(updated.cashBalance),
      defaultFeeRate: parseFloat(updated.defaultFeeRate),
      sellFeeRate: parseFloat(updated.sellFeeRate),
      defaultTaxRate: parseFloat(updated.defaultTaxRate),
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "updatePortfolio failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/portfolios/:portfolioId
router.delete("/:portfolioId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt(req.params.portfolioId);
    const [existing] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(portfoliosTable).where(eq(portfoliosTable.id, portfolioId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deletePortfolio failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/portfolios/:portfolioId/summary
router.get("/:portfolioId/summary", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt(req.params.portfolioId);
    const [portfolio] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
    if (!portfolio) { res.status(404).json({ error: "Not found" }); return; }

    const holdings = await db.select().from(holdingsTable).where(eq(holdingsTable.portfolioId, portfolioId));
    const activeHoldings = holdings.filter(h => parseFloat(h.quantity) > 0);

    // Fetch current prices
    const priceResults = await fetchPrices(activeHoldings.map(h => ({ symbol: h.symbol, market: h.market })));
    const priceMap = new Map(priceResults.map(p => [`${p.symbol}:${p.market}`, p.price]));

    let totalValue = 0;
    let costBasis = 0;

    for (const h of activeHoldings) {
      const qty = parseFloat(h.quantity);
      const avgCost = parseFloat(h.avgCostBasis);
      const price = priceMap.get(`${h.symbol}:${h.market}`) ?? parseFloat(h.currentPrice);
      totalValue += qty * price;
      costBasis += qty * avgCost;
    }

    const unrealizedGain = totalValue - costBasis;
    const unrealizedGainPct = costBasis > 0 ? (unrealizedGain / costBasis) * 100 : 0;
    const cashBalance = parseFloat(portfolio.cashBalance);

    // Compute per-portfolio transaction-based metrics
    const allTxs = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.portfolioId, portfolioId));

    let netDeposited = 0;
    let dividendIncome = 0;
    let cashGains = 0;
    let realizedGain = 0;
    let totalDividends = 0;

    for (const tx of allTxs) {
      const amt = parseFloat((tx as any).amount || "0");
      if (tx.type === "DEPOSIT") {
        netDeposited += amt;
      } else if (tx.type === "WITHDRAWAL") {
        netDeposited -= amt;
      } else if (tx.type === "DIVIDEND") {
        // Net dividend = gross minus fee and tax on the dividend
        const fee = tx.feeAmount ? parseFloat(tx.feeAmount) : 0;
        const tax = tx.taxAmount ? parseFloat(tx.taxAmount) : 0;
        const netDiv = Math.max(0, amt - fee - tax);
        dividendIncome += netDiv;
        totalDividends += amt; // keep gross for display
      } else if (tx.type === "CASH_GAIN") {
        cashGains += amt;
      } else if (tx.type === "SELL" && tx.holdingId && tx.quantity && tx.price) {
        const holding = holdings.find(h => h.id === tx.holdingId);
        if (holding) {
          const qty = parseFloat(tx.quantity);
          const sellPrice = parseFloat(tx.price);
          const fee = tx.feeAmount ? parseFloat(tx.feeAmount) : 0;
          const avgCostBasis = parseFloat(holding.avgCostBasis);
          realizedGain += (qty * sellPrice - fee) - (qty * avgCostBasis);
        }
      }
    }

    const capitalGains = unrealizedGain + realizedGain;
    // Total Gains = (Equity Value + Cash) − Net Deposited — matches dashboard formula exactly
    const totalGains = (totalValue + cashBalance) - netDeposited;
    const totalGainsPct = netDeposited > 0 ? (totalGains / netDeposited) * 100 : 0;

    // This month dividends from dividend_events
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    const monthDivEvents = await db.select().from(dividendEventsTable)
      .where(and(
        eq(dividendEventsTable.portfolioId, portfolioId),
        sql`${dividendEventsTable.paymentDate} >= ${monthStart}`,
        sql`${dividendEventsTable.paymentDate} <= ${monthEnd}`,
      ));
    const monthlyDividends = monthDivEvents.reduce((s, e) => s + parseFloat(e.totalAmount), 0);

    res.json({
      portfolioId,
      totalValue,
      costBasis,
      unrealizedGain,
      unrealizedGainPct,
      cashBalance,
      totalDividends,
      holdingCount: activeHoldings.length,
      monthlyDividends,
      netDeposited,
      realizedGain,
      capitalGains,
      dividendIncome,
      cashGains,
      totalGains,
      totalGainsPct,
    });
  } catch (err) {
    req.log.error({ err }, "getPortfolioSummary failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/portfolios/:portfolioId/performance
router.get("/:portfolioId/performance", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt(req.params.portfolioId);
    const [portfolio] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
    if (!portfolio) { res.status(404).json({ error: "Not found" }); return; }

    const period = (req.query.period as string) || "1Y";

    // Fetch ALL transactions ever (not period-filtered) so we can build a ledger from day 1
    const allTxs = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.portfolioId, portfolioId))
      .orderBy(transactionsTable.date);

    if (allTxs.length === 0) { res.json([]); return; }

    // Fetch all holdings and their current prices (used as proxy for historical equity value)
    const holdings = await db.select().from(holdingsTable)
      .where(eq(holdingsTable.portfolioId, portfolioId));
    const priceResults = await fetchPrices(holdings.map(h => ({ symbol: h.symbol, market: h.market })));
    const priceMap = new Map(priceResults.map(p => [`${p.symbol}:${p.market}`, p.price]));
    const holdingCurrentPrice = new Map<number, number>();
    const holdingMarketMap = new Map<number, string>();
    for (const h of holdings) {
      holdingCurrentPrice.set(h.id, priceMap.get(`${h.symbol}:${h.market}`) ?? parseFloat(h.currentPrice ?? "0"));
      holdingMarketMap.set(h.id, h.market);
    }

    const FUNDS_BONDS = new Set(["FUNDS", "BONDS"]);

    // Group transactions by date (YYYY-MM-DD) in ascending order
    const dateGroups = new Map<string, typeof allTxs>();
    for (const tx of allTxs) {
      const d = tx.date ?? new Date().toISOString().split("T")[0];
      if (!dateGroups.has(d)) dateGroups.set(d, []);
      dateGroups.get(d)!.push(tx);
    }

    // Run the ledger: track cash, share quantities, and FUNDS/BONDS accumulated values
    const holdingQtyMap = new Map<number, number>();
    const holdingValueMap = new Map<number, number>(); // accumulated value for FUNDS/BONDS holdings
    let cash = 0;
    const points: Array<{ date: string; value: number }> = [];

    for (const [date, txsForDate] of [...dateGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const tx of txsForDate) {
        const amt = parseFloat((tx as any).amount ?? "0");
        const qty = tx.quantity ? parseFloat(tx.quantity) : 0;
        const price = tx.price ? parseFloat(tx.price) : 0;
        const fee = tx.feeAmount ? parseFloat(tx.feeAmount) : 0;
        const tax = tx.taxAmount ? parseFloat(tx.taxAmount) : 0;
        const isFundsBonds = tx.holdingId != null && FUNDS_BONDS.has(holdingMarketMap.get(tx.holdingId) ?? "");

        if (tx.type === "DEPOSIT") {
          cash += amt;
        } else if (tx.type === "WITHDRAWAL") {
          cash -= amt;
        } else if (tx.type === "DIVIDEND" || tx.type === "COUPON_INTEREST" || tx.type === "STAKING_REWARD" || tx.type === "DISTRIBUTION") {
          const netDiv = Math.max(0, amt - fee - tax);
          if (isFundsBonds && tx.holdingId) {
            // For FUNDS/BONDS: dividends accumulate in the holding value, not cash
            holdingValueMap.set(tx.holdingId, (holdingValueMap.get(tx.holdingId) ?? 0) + netDiv);
          } else {
            cash += netDiv;
          }
        } else if (tx.type === "CASH_GAIN") {
          cash += amt;
        } else if (tx.type === "BUY" && tx.holdingId) {
          const cost = qty * price + fee + tax;
          cash -= cost;
          holdingQtyMap.set(tx.holdingId, (holdingQtyMap.get(tx.holdingId) ?? 0) + qty);
        } else if (tx.type === "SELL" && tx.holdingId) {
          const proceeds = qty * price - fee - tax;
          cash += proceeds;
          holdingQtyMap.set(tx.holdingId, Math.max(0, (holdingQtyMap.get(tx.holdingId) ?? 0) - qty));
        } else if (tx.type === "FUND_TRANSFER_IN" && tx.holdingId) {
          cash -= amt;
          holdingValueMap.set(tx.holdingId, (holdingValueMap.get(tx.holdingId) ?? 0) + amt);
        } else if (tx.type === "FUND_TRANSFER_OUT" && tx.holdingId) {
          cash += amt;
          holdingValueMap.set(tx.holdingId, Math.max(0, (holdingValueMap.get(tx.holdingId) ?? 0) - amt));
        }
      }

      // Portfolio value = cash + equity (shares × current price) + FUNDS/BONDS accumulated value
      let equity = 0;
      for (const [hId, hQty] of holdingQtyMap.entries()) {
        equity += hQty * (holdingCurrentPrice.get(hId) ?? 0);
      }
      for (const [, hVal] of holdingValueMap.entries()) {
        equity += hVal;
      }
      points.push({ date, value: Math.max(0, cash + equity) });
    }

    // Ensure the last point reflects the portfolio's actual current cash balance
    const today = new Date().toISOString().split("T")[0];
    const actualCash = parseFloat(portfolio.cashBalance);
    let currentEquity = 0;
    for (const [hId, hQty] of holdingQtyMap.entries()) {
      currentEquity += hQty * (holdingCurrentPrice.get(hId) ?? 0);
    }
    for (const [, hVal] of holdingValueMap.entries()) {
      currentEquity += hVal;
    }
    if (points.length > 0 && points[points.length - 1].date !== today) {
      points.push({ date: today, value: Math.max(0, actualCash + currentEquity) });
    } else if (points.length > 0) {
      points[points.length - 1].value = Math.max(0, actualCash + currentEquity);
    }

    // Apply period filter to the output points
    const periodDays: Record<string, number> = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "ALL": 99999 };
    const cutoffDays = periodDays[period] ?? 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cutoffDays);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const filtered = period === "ALL" ? points : points.filter(p => p.date >= cutoffStr);

    res.json(filtered);
  } catch (err) {
    req.log.error({ err }, "getPortfolioPerformance failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

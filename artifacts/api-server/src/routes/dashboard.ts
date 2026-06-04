import { Router } from "express";
import { db, portfoliosTable, holdingsTable, notificationsTable, priceAlertsTable, dividendEventsTable, transactionsTable } from "@workspace/db";
import { eq, and, sql, inArray, gte, lte, or } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrices } from "../lib/prices";
import { getFxRates, convertCurrency } from "../lib/fx";

const router = Router();
router.use(requireAuth);

// GET /api/dashboard/summary
router.get("/summary", async (req, res) => {
  try {
    const userId = getUserId(req);
    const targetCurrency = (req.query.targetCurrency as string) || "USD";
    const portfolios = await db.select().from(portfoliosTable).where(eq(portfoliosTable.userId, userId));

    const { ratesInUsd } = await getFxRates();

    let totalValue = 0;
    let totalCostBasis = 0;
    let totalCash = 0;
    let totalRealizedGain = 0;
    let holdingCount = 0;

    // Pre-fetch all holdings for all portfolios
    const portfolioIds = portfolios.map(p => p.id);
    const allHoldings = portfolioIds.length > 0
      ? await db.select().from(holdingsTable).where(inArray(holdingsTable.portfolioId, portfolioIds))
      : [];

    const holdingMap = new Map(allHoldings.map(h => [h.id, h]));

    for (const p of portfolios) {
      const portfolioCurrency = p.baseCurrency || "USD";
      totalCash += convertCurrency(parseFloat(p.cashBalance), portfolioCurrency, targetCurrency, ratesInUsd);

      const holdings = allHoldings.filter(h => h.portfolioId === p.id);
      const activeHoldings = holdings.filter(h => parseFloat(h.quantity) > 0);
      holdingCount += activeHoldings.length;

      if (activeHoldings.length > 0) {
        const prices = await fetchPrices(activeHoldings.map(h => ({ symbol: h.symbol, market: h.market })));
        const priceMap = new Map(prices.map(p => [`${p.symbol}:${p.market}`, p.price]));

        for (const h of activeHoldings) {
          const qty = parseFloat(h.quantity);
          const avgCost = parseFloat(h.avgCostBasis);
          const price = priceMap.get(`${h.symbol}:${h.market}`) ?? parseFloat(h.currentPrice);
          const holdingCurrency = h.currency || portfolioCurrency;

          totalValue += convertCurrency(qty * price, holdingCurrency, targetCurrency, ratesInUsd);
          totalCostBasis += convertCurrency(qty * avgCost, holdingCurrency, targetCurrency, ratesInUsd);
        }
      }
    }

    // Compute realized gain from SELL transactions
    if (portfolioIds.length > 0) {
      const sellTxs = await db.select().from(transactionsTable).where(
        and(
          inArray(transactionsTable.portfolioId, portfolioIds),
          eq(transactionsTable.type, "SELL")
        )
      );

      for (const tx of sellTxs) {
        if (!tx.holdingId || !tx.quantity || !tx.price) continue;
        const holding = holdingMap.get(tx.holdingId);
        if (!holding) continue;

        const qty = parseFloat(tx.quantity);
        const sellPrice = parseFloat(tx.price);
        const fee = tx.feeAmount ? parseFloat(tx.feeAmount) : 0;
        const costBasis = parseFloat(holding.avgCostBasis);
        const p = portfolios.find(pp => pp.id === tx.portfolioId);
        const holdingCurrency = holding.currency || p?.baseCurrency || "USD";

        // Realized gain = (sell proceeds - fee) - cost basis used
        const gain = (qty * sellPrice - fee) - (qty * costBasis);
        totalRealizedGain += convertCurrency(gain, holdingCurrency, targetCurrency, ratesInUsd);
      }
    }

    // Compute net deposited (DEPOSIT - WITHDRAWAL), dividend income (DIVIDEND txs), and cash gains (CASH_GAIN txs)
    let totalCashGains = 0;
    let totalDeposited = 0;
    let totalDividends = 0;
    if (portfolioIds.length > 0) {
      const incomeTxs = await db.select().from(transactionsTable).where(
        and(
          inArray(transactionsTable.portfolioId, portfolioIds),
          or(
            eq(transactionsTable.type, "CASH_GAIN"),
            eq(transactionsTable.type, "DEPOSIT"),
            eq(transactionsTable.type, "WITHDRAWAL"),
            eq(transactionsTable.type, "DIVIDEND")
          )
        )
      );
      for (const tx of incomeTxs) {
        const tp = portfolios.find(pp => pp.id === tx.portfolioId);
        const txCurrency = (tx as any).currency || tp?.baseCurrency || "USD";
        const amt = parseFloat((tx as any).amount || "0");
        if (tx.type === "CASH_GAIN") {
          totalCashGains += convertCurrency(amt, txCurrency, targetCurrency, ratesInUsd);
        } else if (tx.type === "DEPOSIT") {
          totalDeposited += convertCurrency(amt, txCurrency, targetCurrency, ratesInUsd);
        } else if (tx.type === "WITHDRAWAL") {
          totalDeposited -= convertCurrency(amt, txCurrency, targetCurrency, ratesInUsd);
        } else if (tx.type === "DIVIDEND") {
          // Net dividend = gross amount minus fee and tax paid on the dividend
          const fee = parseFloat((tx as any).feeAmount || "0");
          const tax = parseFloat((tx as any).taxAmount || "0");
          const netDiv = Math.max(0, amt - fee - tax);
          totalDividends += convertCurrency(netDiv, txCurrency, targetCurrency, ratesInUsd);
        }
      }
    }

    const unrealizedGain = totalValue - totalCostBasis;
    const unrealizedGainPct = totalCostBasis > 0 ? (unrealizedGain / totalCostBasis) * 100 : 0;
    const capitalGains = unrealizedGain + totalRealizedGain;
    // Total Gain = Total Portfolio Value − Net Deposited (clean P&L vs invested capital)
    const totalPortfolioValue = totalValue + totalCash;
    const totalGain = totalPortfolioValue - totalDeposited;
    const totalGainPct = totalDeposited > 0 ? (totalGain / totalDeposited) * 100 : 0;

    const [{ unread }] = await db.select({ unread: sql<number>`count(*)` })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));

    const [{ alerts }] = await db.select({ alerts: sql<number>`count(*)` })
      .from(priceAlertsTable)
      .where(and(eq(priceAlertsTable.userId, userId), eq(priceAlertsTable.status, "PENDING")));

    // Monthly dividends
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    let monthlyDividends = 0;

    if (portfolioIds.length > 0) {
      const monthDivEvents = await db.select().from(dividendEventsTable)
        .where(and(
          inArray(dividendEventsTable.portfolioId, portfolioIds),
          gte(dividendEventsTable.paymentDate, monthStart),
          lte(dividendEventsTable.paymentDate, monthEnd),
        ));
      for (const e of monthDivEvents) {
        const divCurrency = e.currency || "USD";
        monthlyDividends += convertCurrency(parseFloat(e.totalAmount), divCurrency, targetCurrency, ratesInUsd);
      }
    }

    res.json({
      totalValue,
      totalCostBasis,
      totalUnrealizedGain: unrealizedGain,
      totalUnrealizedGainPct: unrealizedGainPct,
      totalRealizedGain,
      totalCashGains,
      totalDeposited,
      capitalGains,
      totalGain,
      totalGainPct,
      totalCash,
      totalDividends,
      portfolioCount: portfolios.length,
      holdingCount,
      unreadNotifications: Number(unread),
      activeAlerts: Number(alerts),
      monthlyDividends,
      currency: targetCurrency,
    });
  } catch (err) {
    req.log.error({ err }, "getDashboardSummary failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dashboard/allocation
router.get("/allocation", async (req, res) => {
  try {
    const userId = getUserId(req);
    const targetCurrency = (req.query.targetCurrency as string) || "USD";
    const portfolios = await db.select().from(portfoliosTable).where(eq(portfoliosTable.userId, userId));

    const { ratesInUsd } = await getFxRates();
    const slices: Array<{ label: string; value: number; pct: number; type: string; portfolioId: number | null; color: string | null }> = [];
    let grandTotal = 0;

    for (const p of portfolios) {
      const portfolioCurrency = p.baseCurrency || "USD";
      const holdings = await db.select().from(holdingsTable).where(eq(holdingsTable.portfolioId, p.id));
      const activeHoldings = holdings.filter(h => parseFloat(h.quantity) > 0);

      let portfolioValue = convertCurrency(parseFloat(p.cashBalance), portfolioCurrency, targetCurrency, ratesInUsd);

      if (activeHoldings.length > 0) {
        const prices = await fetchPrices(activeHoldings.map(h => ({ symbol: h.symbol, market: h.market })));
        const priceMap = new Map(prices.map(p => [`${p.symbol}:${p.market}`, p.price]));

        for (const h of activeHoldings) {
          const holdingCurrency = h.currency || portfolioCurrency;
          const price = priceMap.get(`${h.symbol}:${h.market}`) ?? parseFloat(h.currentPrice);
          portfolioValue += convertCurrency(parseFloat(h.quantity) * price, holdingCurrency, targetCurrency, ratesInUsd);
        }
      }

      grandTotal += portfolioValue;
      slices.push({ label: p.name, value: portfolioValue, pct: 0, type: p.type, portfolioId: p.id, color: p.color ?? null });
    }

    for (const slice of slices) {
      slice.pct = grandTotal > 0 ? (slice.value / grandTotal) * 100 : 0;
    }

    res.json(slices);
  } catch (err) {
    req.log.error({ err }, "getDashboardAllocation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dashboard/upcoming-dividends
router.get("/upcoming-dividends", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolios = await db.select({ id: portfoliosTable.id }).from(portfoliosTable)
      .where(eq(portfoliosTable.userId, userId));

    if (portfolios.length === 0) { res.json([]); return; }

    const portfolioIds = portfolios.map(p => p.id);
    const today = new Date().toISOString().split("T")[0];
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const events = await db.select().from(dividendEventsTable)
      .where(and(
        inArray(dividendEventsTable.portfolioId, portfolioIds),
        or(gte(dividendEventsTable.exDate, today), gte(dividendEventsTable.paymentDate, today)),
        or(lte(dividendEventsTable.exDate, in30Days), lte(dividendEventsTable.paymentDate, in30Days)),
      ));

    events.sort((a, b) => (a.exDate ?? "").localeCompare(b.exDate ?? ""));
    res.json(events.map(e => ({
      id: e.id, portfolioId: e.portfolioId, holdingId: e.holdingId,
      symbol: e.symbol, name: e.name, dividendType: e.dividendType,
      exDate: e.exDate, recordDate: e.recordDate ?? null, paymentDate: e.paymentDate ?? null,
      dividendPerShare: e.dividendPerShare != null ? parseFloat(e.dividendPerShare) : null,
      totalAmount: parseFloat(e.totalAmount),
      currency: e.currency, notes: e.notes ?? null,
      createdAt: e.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "getUpcomingDividends failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

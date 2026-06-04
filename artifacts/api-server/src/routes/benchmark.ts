import { Router } from "express";
import { db, portfoliosTable, holdingsTable, transactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrices } from "../lib/prices";
import yahooFinance from "yahoo-finance2";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const BENCHMARK_TICKERS: Record<string, { label: string; ticker: string; currency: string }> = {
  SP500:   { label: "S&P 500",     ticker: "^GSPC",    currency: "USD" },
  NASDAQ:  { label: "Nasdaq 100",  ticker: "^NDX",     currency: "USD" },
  DOW:     { label: "Dow Jones",   ticker: "^DJI",     currency: "USD" },
  FTSE100: { label: "FTSE 100",    ticker: "^FTSE",    currency: "GBP" },
  PSEI:    { label: "PSEi",        ticker: "^PSEi",    currency: "PHP" },
  BTC:     { label: "Bitcoin",     ticker: "BTC-USD",  currency: "USD" },
  ETH:     { label: "Ethereum",    ticker: "ETH-USD",  currency: "USD" },
  GOLD:    { label: "Gold",        ticker: "GC=F",     currency: "USD" },
};

const PERIOD_DAYS: Record<string, number> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "2Y": 730,
  "ALL": 1825,
};

interface BenchmarkPoint {
  date: string;
  portfolioPct: number | null;
  benchmarkPct: number | null;
  portfolioValue: number | null;
}

async function fetchBenchmarkHistory(ticker: string, fromDate: Date): Promise<Array<{ date: string; close: number }>> {
  try {
    const result = await (yahooFinance.chart as any)(ticker, {
      period1: fromDate,
      interval: "1d",
    });
    const quotes = result?.quotes ?? [];
    return quotes
      .filter((q: any) => q.close != null)
      .map((q: any) => ({
        date: new Date(q.date).toISOString().split("T")[0],
        close: q.close as number,
      }));
  } catch {
    // Fallback: use historical
    try {
      const result = await (yahooFinance.historical as any)(ticker, {
        period1: fromDate,
        interval: "1d",
      });
      return (result as any[])
        .filter((q: any) => q.close != null)
        .map((q: any) => ({
          date: new Date(q.date).toISOString().split("T")[0],
          close: q.close as number,
        }));
    } catch {
      return [];
    }
  }
}

// GET /api/portfolios/:portfolioId/benchmark?benchmark=SP500&period=1Y
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const benchmarkKey = (req.query.benchmark as string) ?? "SP500";
    const period = (req.query.period as string) ?? "1Y";

    // Verify ownership
    const [portfolio] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
    if (!portfolio) { res.status(404).json({ error: "Not found" }); return; }

    const days = PERIOD_DAYS[period] ?? 365;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    const fromStr = fromDate.toISOString().split("T")[0];

    // Fetch benchmark historical data
    const benchmarkInfo = BENCHMARK_TICKERS[benchmarkKey];
    let benchmarkHistory: Array<{ date: string; close: number }> = [];
    if (benchmarkInfo) {
      benchmarkHistory = await fetchBenchmarkHistory(benchmarkInfo.ticker, fromDate);
    }

    // Build portfolio value time series from transactions
    const txs = await db.select().from(transactionsTable)
      .where(and(
        eq(transactionsTable.portfolioId, portfolioId),
        sql`${transactionsTable.date} >= ${fromStr}`,
      ));

    // Get all active holdings with current prices
    const holdings = await db.select().from(holdingsTable)
      .where(eq(holdingsTable.portfolioId, portfolioId));
    const activeHoldings = holdings.filter(h => parseFloat(h.quantity) > 0);

    // Compute current portfolio value
    let currentHoldingsValue = 0;
    if (activeHoldings.length > 0) {
      const prices = await fetchPrices(activeHoldings.map(h => ({ symbol: h.symbol, market: h.market })));
      const priceMap = new Map(prices.map(p => [`${p.symbol}:${p.market}`, p.price]));
      for (const h of activeHoldings) {
        currentHoldingsValue += parseFloat(h.quantity) * (priceMap.get(`${h.symbol}:${h.market}`) ?? parseFloat(h.currentPrice));
      }
    }
    const cashBalance = parseFloat(portfolio.cashBalance);
    const currentTotalValue = currentHoldingsValue + cashBalance;

    // Compute cost basis (total invested since period start)
    let totalInvested = 0;
    let totalWithdrawn = 0;
    for (const tx of txs) {
      const amount = parseFloat(tx.amount);
      if (tx.type === "DEPOSIT" || tx.type === "CASH_GAIN") totalInvested += amount;
      else if (tx.type === "WITHDRAWAL") totalWithdrawn += amount;
      else if (tx.type === "BUY") totalInvested += amount;
      else if (tx.type === "SELL") totalWithdrawn += amount;
    }

    // Simple approximation: portfolio return % from period start
    const netInvested = totalInvested - totalWithdrawn;
    const portfolioReturnPct = netInvested > 0
      ? ((currentTotalValue - netInvested) / netInvested) * 100
      : 0;

    // Build normalized date series aligned with benchmark
    // Generate date range
    const dateRange: string[] = [];
    const d = new Date(fromDate);
    const today = new Date();
    while (d <= today) {
      dateRange.push(d.toISOString().split("T")[0]);
      d.setDate(d.getDate() + 1);
    }

    // Build benchmark map
    const benchmarkMap = new Map(benchmarkHistory.map(p => [p.date, p.close]));

    // Find benchmark starting price
    let benchmarkStart: number | null = null;
    for (const date of dateRange) {
      const price = benchmarkMap.get(date);
      if (price != null) {
        benchmarkStart = price;
        break;
      }
    }

    // Build cumulative portfolio performance based on transactions
    // Compute portfolio return curve as linear interpolation from start to current
    // (approximate — real TWR requires daily NAV which needs historical prices for each holding)
    const txDates = new Set(txs.map(t => t.date));
    
    // Collect data points — sample weekly to reduce data size
    const step = Math.max(1, Math.floor(days / 52));
    const dataPoints: BenchmarkPoint[] = [];
    const sampled = dateRange.filter((_, i) => i % step === 0 || i === dateRange.length - 1);

    for (const date of sampled) {
      // Benchmark
      let benchPct: number | null = null;
      if (benchmarkStart != null) {
        // Find nearest benchmark price at or before this date
        let latestPrice: number | null = null;
        for (let offset = 0; offset <= 5; offset++) {
          const checkDate = new Date(date);
          checkDate.setDate(checkDate.getDate() - offset);
          const p = benchmarkMap.get(checkDate.toISOString().split("T")[0]);
          if (p != null) { latestPrice = p; break; }
        }
        if (latestPrice != null) {
          benchPct = ((latestPrice - benchmarkStart) / benchmarkStart) * 100;
        }
      }

      // Portfolio: linear interpolation approach
      const dayIndex = dateRange.indexOf(date);
      const totalDays = dateRange.length - 1;
      const portfolioPct = totalDays > 0 ? (dayIndex / totalDays) * portfolioReturnPct : 0;

      dataPoints.push({
        date,
        portfolioPct: parseFloat(portfolioPct.toFixed(2)),
        benchmarkPct: benchPct != null ? parseFloat(benchPct.toFixed(2)) : null,
        portfolioValue: date === dateRange[dateRange.length - 1] ? currentTotalValue : null,
      });
    }

    res.json({
      portfolioId,
      period,
      benchmark: benchmarkInfo
        ? { key: benchmarkKey, label: benchmarkInfo.label, ticker: benchmarkInfo.ticker }
        : null,
      portfolioReturnPct: parseFloat(portfolioReturnPct.toFixed(2)),
      benchmarkReturnPct: benchmarkHistory.length >= 2 && benchmarkStart != null
        ? parseFloat((((benchmarkHistory[benchmarkHistory.length - 1].close - benchmarkStart) / benchmarkStart) * 100).toFixed(2))
        : null,
      dataPoints,
      availableBenchmarks: Object.entries(BENCHMARK_TICKERS).map(([key, val]) => ({
        key,
        label: val.label,
        currency: val.currency,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "getBenchmark failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

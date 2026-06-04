import { Router } from "express";
import { db, portfoliosTable, holdingsTable, transactionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrices } from "../lib/prices";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/portfolios/:portfolioId/attribution
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);

    const [portfolio] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
    if (!portfolio) { res.status(404).json({ error: "Not found" }); return; }

    const holdings = await db.select().from(holdingsTable)
      .where(eq(holdingsTable.portfolioId, portfolioId));

    const active = holdings.filter(h => parseFloat(h.quantity) > 0);
    if (active.length === 0) {
      res.json({ items: [], totalPortfolioReturn: 0, totalMarketValue: 0, cashBalance: parseFloat(portfolio.cashBalance) });
      return;
    }

    // Fetch fresh prices
    const priceResults = await fetchPrices(active.map(h => ({ symbol: h.symbol, market: h.market })));
    const priceMap = new Map(priceResults.map(p => [`${p.symbol}:${p.market}`, p.price]));

    // Compute market values
    const enriched = active.map(h => {
      const qty = parseFloat(h.quantity);
      const avgCost = parseFloat(h.avgCostBasis);
      const price = priceMap.get(`${h.symbol}:${h.market}`) ?? parseFloat(h.currentPrice);
      const marketValue = qty * price;
      const costBasis = qty * avgCost;
      const unrealizedPL = marketValue - costBasis;
      const holdingReturn = avgCost > 0 ? (price - avgCost) / avgCost : 0;
      return { h, qty, avgCost, price, marketValue, costBasis, unrealizedPL, holdingReturn };
    });

    const totalHoldingsValue = enriched.reduce((s, e) => s + e.marketValue, 0);
    const cashBalance = parseFloat(portfolio.cashBalance);
    const totalPortfolioValue = totalHoldingsValue + cashBalance;

    // Compute dividends per holding from transactions
    const allTxs = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.portfolioId, portfolioId));
    const dividendMap = new Map<number, number>();
    for (const tx of allTxs) {
      if (tx.type === "DIVIDEND" && tx.holdingId) {
        const prev = dividendMap.get(tx.holdingId) ?? 0;
        dividendMap.set(tx.holdingId, prev + parseFloat(tx.amount));
      }
    }

    const items = enriched
      .sort((a, b) => Math.abs(b.unrealizedPL) - Math.abs(a.unrealizedPL))
      .map(({ h, qty, price, marketValue, costBasis, unrealizedPL, holdingReturn }) => {
        const weight = totalPortfolioValue > 0 ? marketValue / totalPortfolioValue : 0;
        const contribution = weight * holdingReturn;       // in decimal (0.05 = 5pp)
        const dividendIncome = dividendMap.get(h.id) ?? 0;
        const totalReturn = unrealizedPL + dividendIncome;
        const totalReturnPct = costBasis > 0 ? totalReturn / costBasis : 0;
        return {
          id: h.id,
          symbol: h.symbol,
          name: h.name,
          market: h.market,
          currency: h.currency,
          quantity: qty,
          avgCost: parseFloat(h.avgCostBasis),
          currentPrice: price,
          marketValue,
          costBasis,
          unrealizedPL,
          holdingReturn,              // decimal
          holdingReturnPct: holdingReturn * 100,
          weight,                     // decimal (0.30 = 30%)
          weightPct: weight * 100,
          contribution,               // decimal (pp of portfolio return)
          contributionPpt: contribution * 100,   // percentage points
          dividendIncome,
          totalReturn,
          totalReturnPct,
          totalReturnPctFormatted: totalReturnPct * 100,
        };
      });

    // Portfolio-level aggregate
    const totalCostBasis = items.reduce((s, i) => s + i.costBasis, 0);
    const totalUnrealizedPL = items.reduce((s, i) => s + i.unrealizedPL, 0);
    const totalDividends = items.reduce((s, i) => s + i.dividendIncome, 0);
    const totalReturn = totalUnrealizedPL + totalDividends;
    const totalPortfolioReturn = totalCostBasis > 0 ? (totalReturn / totalCostBasis) * 100 : 0;

    res.json({
      items,
      totalMarketValue: totalPortfolioValue,
      totalHoldingsValue,
      cashBalance,
      totalCostBasis,
      totalUnrealizedPL,
      totalDividends,
      totalReturn,
      totalPortfolioReturn,
    });
  } catch (err) {
    req.log.error({ err }, "getAttribution failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router } from "express";
import { db, portfoliosTable, holdingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrices } from "../lib/prices";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/portfolios/:portfolioId/rebalance
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

    // Fetch live prices
    let priceMap = new Map<string, number>();
    if (active.length > 0) {
      const prices = await fetchPrices(active.map(h => ({ symbol: h.symbol, market: h.market })));
      priceMap = new Map(prices.map(p => [`${p.symbol}:${p.market}`, p.price]));
    }

    const cashBalance = parseFloat(portfolio.cashBalance);

    // Compute current values
    const holdingRows = active.map(h => {
      const qty = parseFloat(h.quantity);
      const price = priceMap.get(`${h.symbol}:${h.market}`) ?? parseFloat(h.currentPrice);
      const value = qty * price;
      return {
        id: h.id,
        symbol: h.symbol,
        name: h.name,
        market: h.market,
        assetType: h.assetType,
        currency: h.currency ?? portfolio.baseCurrency,
        quantity: qty,
        currentPrice: price,
        currentValue: value,
        targetWeight: h.targetWeight != null ? parseFloat(h.targetWeight) : null,
      };
    });

    const holdingsValue = holdingRows.reduce((sum, h) => sum + h.currentValue, 0);
    const totalValue = holdingsValue + cashBalance;

    // Build rebalance plan
    const plan = holdingRows.map(h => {
      const currentWeight = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0;
      const targetWeight = h.targetWeight; // 0–100 percent

      let targetValue: number | null = null;
      let diffValue: number | null = null;
      let sharesToTrade: number | null = null;
      let action: "BUY" | "SELL" | "HOLD" | null = null;

      if (targetWeight != null) {
        targetValue = (targetWeight / 100) * totalValue;
        diffValue = targetValue - h.currentValue;

        if (Math.abs(diffValue) < 0.01) {
          action = "HOLD";
          sharesToTrade = 0;
        } else if (diffValue > 0) {
          action = "BUY";
          sharesToTrade = h.currentPrice > 0 ? diffValue / h.currentPrice : 0;
        } else {
          action = "SELL";
          sharesToTrade = h.currentPrice > 0 ? Math.abs(diffValue) / h.currentPrice : 0;
        }
      }

      return {
        holdingId: h.id,
        symbol: h.symbol,
        name: h.name,
        market: h.market,
        assetType: h.assetType,
        currency: h.currency,
        quantity: h.quantity,
        currentPrice: h.currentPrice,
        currentValue: h.currentValue,
        currentWeight: parseFloat(currentWeight.toFixed(4)),
        targetWeight: targetWeight,
        targetValue,
        diffValue,
        sharesToTrade: sharesToTrade != null ? parseFloat(sharesToTrade.toFixed(6)) : null,
        action,
      };
    });

    const sumTargetWeights = plan.reduce((sum, r) => sum + (r.targetWeight ?? 0), 0);
    const cashTargetWeight = Math.max(0, 100 - sumTargetWeights);
    const currentCashWeight = totalValue > 0 ? (cashBalance / totalValue) * 100 : 0;

    res.json({
      portfolioId,
      totalValue,
      cashBalance,
      holdingsValue,
      currentCashWeight: parseFloat(currentCashWeight.toFixed(4)),
      cashTargetWeight: parseFloat(cashTargetWeight.toFixed(4)),
      sumTargetWeights: parseFloat(sumTargetWeights.toFixed(4)),
      holdings: plan,
      baseCurrency: portfolio.baseCurrency,
    });
  } catch (err) {
    req.log.error({ err }, "getRebalance failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/portfolios/:portfolioId/rebalance/weights
// Body: { weights: Array<{ holdingId: number; targetWeight: number | null }> }
router.patch("/weights", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);

    const [portfolio] = await db.select().from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
    if (!portfolio) { res.status(404).json({ error: "Not found" }); return; }

    const { weights } = req.body as { weights: Array<{ holdingId: number; targetWeight: number | null }> };
    if (!Array.isArray(weights)) { res.status(400).json({ error: "weights must be an array" }); return; }

    // Verify all holdings belong to this portfolio before updating
    for (const w of weights) {
      const [holding] = await db.select({ id: holdingsTable.id }).from(holdingsTable)
        .where(and(eq(holdingsTable.id, w.holdingId), eq(holdingsTable.portfolioId, portfolioId)));
      if (!holding) { res.status(403).json({ error: `Holding ${w.holdingId} not found in this portfolio` }); return; }

      await db.update(holdingsTable)
        .set({ targetWeight: w.targetWeight != null ? String(w.targetWeight) : null })
        .where(eq(holdingsTable.id, w.holdingId));
    }

    res.json({ ok: true, updated: weights.length });
  } catch (err) {
    req.log.error({ err }, "patchRebalanceWeights failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router } from "express";
import { db, portfoliosTable, holdingsTable, transactionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrice } from "../lib/prices";

const router = Router({ mergeParams: true });

router.use(requireAuth);

async function ownsPortfolio(userId: string, portfolioId: number): Promise<boolean> {
  const [p] = await db.select({ id: portfoliosTable.id }).from(portfoliosTable)
    .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
  return !!p;
}

// GET /api/portfolios/:portfolioId/holdings
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const holdings = await db.select().from(holdingsTable).where(eq(holdingsTable.portfolioId, portfolioId));

    // Fetch live prices for all holdings
    const withPrices = await Promise.all(holdings.map(async (h) => {
      const qty = parseFloat(h.quantity);
      const avgCost = parseFloat(h.avgCostBasis);
      const priceData = await fetchPrice(h.symbol, h.market);
      const currentPrice = priceData.price || parseFloat(h.currentPrice);
      const currentValue = qty * currentPrice;
      const costValue = qty * avgCost;
      const unrealizedGain = currentValue - costValue;
      const unrealizedGainPct = costValue > 0 ? (unrealizedGain / costValue) * 100 : 0;

      return {
        id: h.id,
        portfolioId: h.portfolioId,
        symbol: h.symbol,
        name: h.name,
        market: h.market,
        assetType: h.assetType,
        quantity: qty,
        avgCostBasis: avgCost,
        currentPrice,
        currentValue,
        unrealizedGain,
        unrealizedGainPct,
        totalDividends: parseFloat(h.totalDividends),
        targetWeight: h.targetWeight != null ? parseFloat(h.targetWeight) : null,
        currency: priceData.currency || h.currency,
        notes: h.notes,
        isCustom: h.isCustom,
        lastPriceUpdate: priceData.lastUpdated,
        createdAt: h.createdAt.toISOString(),
      };
    }));

    res.json(withPrices);
  } catch (err) {
    req.log.error({ err }, "listHoldings failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/portfolios/:portfolioId/holdings
router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const { symbol, name, market: marketInput, assetType = "STOCK", currency = "USD", targetWeight, notes, isCustom = false } = req.body;
    if (!symbol || !name) { res.status(400).json({ error: "symbol, name are required" }); return; }

    // Auto-infer market from symbol suffix / asset type when not provided
    function inferMarket(sym: string, at: string): string {
      const u = sym.toUpperCase();
      if (u.endsWith(".PS") || u.endsWith(".PSE")) return "PSE";
      if (u.endsWith(".L")) return "LSE";
      if (at === "CRYPTO") return "CRYPTO";
      if (["SAVINGS", "CASH_ASSET", "BOND", "CUSTOM"].includes(at)) return "CUSTOM";
      return "US";
    }
    const market = marketInput || inferMarket(symbol, assetType);

    const [holding] = await db.insert(holdingsTable).values({
      portfolioId, symbol: symbol.toUpperCase(), name, market, assetType, currency,
      targetWeight: targetWeight != null ? String(targetWeight) : null,
      notes,
      isCustom,
    }).returning();

    res.status(201).json({
      ...holding,
      quantity: parseFloat(holding.quantity),
      avgCostBasis: parseFloat(holding.avgCostBasis),
      currentPrice: parseFloat(holding.currentPrice),
      currentValue: 0,
      unrealizedGain: 0,
      unrealizedGainPct: 0,
      totalDividends: parseFloat(holding.totalDividends),
      targetWeight: holding.targetWeight != null ? parseFloat(holding.targetWeight) : null,
      lastPriceUpdate: holding.lastPriceUpdate?.toISOString() ?? null,
      createdAt: holding.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "createHolding failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/portfolios/:portfolioId/holdings/:holdingId
router.get("/:holdingId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const holdingId = parseInt(req.params.holdingId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const [h] = await db.select().from(holdingsTable)
      .where(and(eq(holdingsTable.id, holdingId), eq(holdingsTable.portfolioId, portfolioId)));
    if (!h) { res.status(404).json({ error: "Not found" }); return; }

    const qty = parseFloat(h.quantity);
    const avgCost = parseFloat(h.avgCostBasis);
    const priceData = await fetchPrice(h.symbol, h.market);
    const currentPrice = priceData.price || parseFloat(h.currentPrice);
    const currentValue = qty * currentPrice;
    const costValue = qty * avgCost;
    const unrealizedGain = currentValue - costValue;
    const unrealizedGainPct = costValue > 0 ? (unrealizedGain / costValue) * 100 : 0;

    res.json({
      id: h.id, portfolioId: h.portfolioId, symbol: h.symbol, name: h.name,
      market: h.market, assetType: h.assetType,
      quantity: qty, avgCostBasis: avgCost, currentPrice, currentValue,
      unrealizedGain, unrealizedGainPct,
      totalDividends: parseFloat(h.totalDividends),
      targetWeight: h.targetWeight != null ? parseFloat(h.targetWeight) : null,
      currency: priceData.currency || h.currency,
      notes: h.notes, isCustom: h.isCustom,
      lastPriceUpdate: priceData.lastUpdated,
      createdAt: h.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "getHolding failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/portfolios/:portfolioId/holdings/:holdingId
router.patch("/:holdingId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const holdingId = parseInt(req.params.holdingId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const [existing] = await db.select().from(holdingsTable)
      .where(and(eq(holdingsTable.id, holdingId), eq(holdingsTable.portfolioId, portfolioId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updates: Partial<typeof holdingsTable.$inferInsert> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.targetWeight !== undefined) updates.targetWeight = req.body.targetWeight != null ? String(req.body.targetWeight) : null;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.currentPrice !== undefined) {
      updates.currentPrice = String(req.body.currentPrice);
      updates.lastPriceUpdate = new Date();
    }

    const [updated] = await db.update(holdingsTable).set(updates)
      .where(eq(holdingsTable.id, holdingId)).returning();

    res.json({
      ...updated,
      quantity: parseFloat(updated.quantity),
      avgCostBasis: parseFloat(updated.avgCostBasis),
      currentPrice: parseFloat(updated.currentPrice),
      currentValue: parseFloat(updated.quantity) * parseFloat(updated.currentPrice),
      unrealizedGain: 0,
      unrealizedGainPct: 0,
      totalDividends: parseFloat(updated.totalDividends),
      targetWeight: updated.targetWeight != null ? parseFloat(updated.targetWeight) : null,
      lastPriceUpdate: updated.lastPriceUpdate?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "updateHolding failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/portfolios/:portfolioId/holdings/:holdingId
router.delete("/:holdingId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const holdingId = parseInt(req.params.holdingId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    await db.delete(holdingsTable).where(and(eq(holdingsTable.id, holdingId), eq(holdingsTable.portfolioId, portfolioId)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteHolding failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

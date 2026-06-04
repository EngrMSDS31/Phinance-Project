import { Router } from "express";
import { db, recurringPlansTable, portfoliosTable, holdingsTable, transactionsTable, notificationsTable } from "@workspace/db";
import { eq, and, lte, desc, sql } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrice } from "../lib/prices";

const router = Router();
router.use(requireAuth);

const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"] as const;

function calcNextDate(frequency: string, from: Date): string {
  const d = new Date(from);
  switch (frequency) {
    case "WEEKLY":    d.setDate(d.getDate() + 7); break;
    case "BIWEEKLY":  d.setDate(d.getDate() + 14); break;
    case "MONTHLY":   d.setMonth(d.getMonth() + 1); break;
    case "QUARTERLY": d.setMonth(d.getMonth() + 3); break;
    default:          d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function planStatus(nextRunDate: string, isActive: boolean): string {
  if (!isActive) return "PAUSED";
  const today = new Date().toISOString().slice(0, 10);
  if (nextRunDate < today) return "OVERDUE";
  if (nextRunDate === today) return "DUE_TODAY";
  return "UPCOMING";
}

async function ownsPortfolio(userId: string, portfolioId: number): Promise<boolean> {
  const [p] = await db.select({ id: portfoliosTable.id })
    .from(portfoliosTable)
    .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
  return !!p;
}

async function recalcHolding(holdingId: number) {
  const txs = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.holdingId, holdingId));
  let qty = 0, totalCost = 0;
  for (const tx of txs) {
    const q = parseFloat(tx.quantity ?? "0");
    const p = parseFloat(tx.price ?? "0");
    if (tx.type === "BUY") { qty += q; totalCost += q * p; }
    else if (tx.type === "SELL") { qty -= q; }
  }
  const avg = qty > 0 ? totalCost / qty : 0;
  await db.update(holdingsTable)
    .set({ quantity: String(Math.max(0, qty)), avgCostBasis: String(avg) })
    .where(eq(holdingsTable.id, holdingId));
}

// GET /api/recurring
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const rows = await db
      .select({
        plan: recurringPlansTable,
        portfolioName: portfoliosTable.name,
        portfolioBaseCurrency: portfoliosTable.baseCurrency,
      })
      .from(recurringPlansTable)
      .leftJoin(portfoliosTable, eq(recurringPlansTable.portfolioId, portfoliosTable.id))
      .where(eq(recurringPlansTable.userId, userId))
      .orderBy(desc(recurringPlansTable.createdAt));

    const result = rows.map(({ plan, portfolioName, portfolioBaseCurrency }) => ({
      ...plan,
      portfolioName: portfolioName ?? "Unknown",
      portfolioBaseCurrency: portfolioBaseCurrency ?? "USD",
      status: planStatus(plan.nextRunDate, plan.isActive),
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "listRecurring failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/recurring
router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId, symbol, name, market, frequency, investAmount, currency, nextRunDate, notes } = req.body;

    if (!portfolioId || !symbol || !name || !frequency || !investAmount || !nextRunDate) {
      res.status(400).json({ error: "portfolioId, symbol, name, frequency, investAmount, nextRunDate required" });
      return;
    }
    if (!FREQUENCIES.includes(frequency)) {
      res.status(400).json({ error: "Invalid frequency" });
      return;
    }
    if (!await ownsPortfolio(userId, parseInt(portfolioId))) {
      res.status(404).json({ error: "Portfolio not found" });
      return;
    }

    const [plan] = await db.insert(recurringPlansTable).values({
      userId,
      portfolioId: parseInt(portfolioId),
      symbol: symbol.toUpperCase(),
      name,
      market: market ?? "US",
      frequency,
      investAmount: String(investAmount),
      currency: currency ?? "USD",
      nextRunDate,
      isActive: true,
      notes: notes ?? null,
    }).returning();

    res.status(201).json({
      ...plan,
      status: planStatus(plan.nextRunDate, plan.isActive),
    });
  } catch (err) {
    req.log.error({ err }, "createRecurring failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/recurring/:id
router.patch("/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const planId = parseInt(req.params.id);
    const [existing] = await db.select().from(recurringPlansTable)
      .where(and(eq(recurringPlansTable.id, planId), eq(recurringPlansTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const allowed = ["investAmount", "frequency", "nextRunDate", "isActive", "notes", "currency"] as const;
    const updates: Record<string, unknown> = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (updates.investAmount) updates.investAmount = String(updates.investAmount);
    if (updates.frequency && !FREQUENCIES.includes(updates.frequency as any)) {
      res.status(400).json({ error: "Invalid frequency" }); return;
    }

    const [updated] = await db.update(recurringPlansTable)
      .set(updates as any)
      .where(eq(recurringPlansTable.id, planId))
      .returning();

    res.json({ ...updated, status: planStatus(updated.nextRunDate, updated.isActive) });
  } catch (err) {
    req.log.error({ err }, "updateRecurring failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/recurring/:id
router.delete("/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const planId = parseInt(req.params.id);
    const [existing] = await db.select().from(recurringPlansTable)
      .where(and(eq(recurringPlansTable.id, planId), eq(recurringPlansTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(recurringPlansTable).where(eq(recurringPlansTable.id, planId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteRecurring failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/recurring/:id/execute
router.post("/:id/execute", async (req, res) => {
  try {
    const userId = getUserId(req);
    const planId = parseInt(req.params.id);
    const [plan] = await db.select().from(recurringPlansTable)
      .where(and(eq(recurringPlansTable.id, planId), eq(recurringPlansTable.userId, userId)));
    if (!plan) { res.status(404).json({ error: "Not found" }); return; }
    if (!plan.isActive) { res.status(400).json({ error: "Plan is paused" }); return; }

    // Fetch current price
    let currentPrice: number;
    try {
      const priceData = await fetchPrice(plan.symbol, plan.market);
      currentPrice = priceData.price;
    } catch {
      res.status(502).json({ error: `Could not fetch price for ${plan.symbol}` });
      return;
    }

    if (currentPrice <= 0) {
      res.status(502).json({ error: `Invalid price for ${plan.symbol}` });
      return;
    }

    const investAmount = parseFloat(plan.investAmount);
    const quantity = investAmount / currentPrice;
    const today = new Date().toISOString().slice(0, 10);

    // Find or create holding in portfolio
    let holdingId = plan.holdingId;
    if (!holdingId) {
      const [existingHolding] = await db.select().from(holdingsTable)
        .where(and(eq(holdingsTable.portfolioId, plan.portfolioId), eq(holdingsTable.symbol, plan.symbol)));
      if (existingHolding) {
        holdingId = existingHolding.id;
      } else {
        const [newHolding] = await db.insert(holdingsTable).values({
          portfolioId: plan.portfolioId,
          symbol: plan.symbol,
          name: plan.name,
          market: plan.market,
          currency: plan.currency,
          quantity: "0",
          avgCostBasis: "0",
          currentPrice: String(currentPrice),
        }).returning();
        holdingId = newHolding.id;
        // update plan with new holdingId
        await db.update(recurringPlansTable).set({ holdingId }).where(eq(recurringPlansTable.id, planId));
      }
    }

    // Create BUY transaction
    const [tx] = await db.insert(transactionsTable).values({
      portfolioId: plan.portfolioId,
      holdingId,
      type: "BUY",
      date: today,
      quantity: String(quantity),
      price: String(currentPrice),
      amount: String(investAmount),
      currency: plan.currency,
      notes: `Auto-plan: ${plan.frequency} investment`,
    }).returning();

    // Recalc holding & update holding price
    await recalcHolding(holdingId);
    await db.update(holdingsTable)
      .set({ currentPrice: String(currentPrice), lastPriceUpdate: new Date() })
      .where(eq(holdingsTable.id, holdingId));

    // Update cash balance
    await db.update(portfoliosTable)
      .set({ cashBalance: sql`cash_balance - ${String(investAmount)}` })
      .where(eq(portfoliosTable.id, plan.portfolioId));

    // Update plan dates
    const nextRunDate = calcNextDate(plan.frequency, new Date(today));
    const [updatedPlan] = await db.update(recurringPlansTable)
      .set({ lastRunDate: today, nextRunDate })
      .where(eq(recurringPlansTable.id, planId))
      .returning();

    // Create notification
    await db.insert(notificationsTable).values({
      userId,
      type: "SYSTEM",
      title: "Investment Executed",
      message: `Bought ${quantity.toFixed(6)} ${plan.symbol} for ${plan.currency} ${investAmount.toFixed(2)} at ${currentPrice.toFixed(4)} — ${plan.frequency} plan.`,
      isRead: false,
    }).catch(() => {});

    res.json({
      transaction: tx,
      plan: { ...updatedPlan, status: planStatus(updatedPlan.nextRunDate, updatedPlan.isActive) },
    });
  } catch (err) {
    req.log.error({ err }, "executeRecurring failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

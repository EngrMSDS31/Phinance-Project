import { Router } from "express";
import { db, priceAlertsTable, notificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrice } from "../lib/prices";

const router = Router();
router.use(requireAuth);

function formatAlert(a: any) {
  return {
    id: a.id,
    userId: a.userId,
    symbol: a.symbol,
    market: a.market,
    name: a.name,
    condition: a.condition,
    targetPrice: parseFloat(a.targetPrice),
    currentPrice: a.currentPrice != null ? parseFloat(a.currentPrice) : null,
    status: a.status,
    currency: a.currency,
    firedAt: a.firedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

async function checkAndFireAlert(alertRow: any) {
  if (alertRow.status !== "PENDING") return;
  const price = await fetchPrice(alertRow.symbol, alertRow.market);
  if (!price.price) return;

  const target = parseFloat(alertRow.targetPrice);
  const current = price.price;
  let fired = false;

  switch (alertRow.condition) {
    case "GTE": fired = current >= target; break;
    case "LTE": fired = current <= target; break;
    case "EQ": fired = Math.abs(current - target) < 0.0001; break;
    case "CROSS_UP": fired = current >= target; break;
    case "CROSS_DOWN": fired = current <= target; break;
  }

  await db.update(priceAlertsTable).set({
    currentPrice: String(current),
    status: fired ? "FIRED" : "PENDING",
    firedAt: fired ? new Date() : null,
  }).where(eq(priceAlertsTable.id, alertRow.id));

  if (fired) {
    await db.insert(notificationsTable).values({
      userId: alertRow.userId,
      type: "PRICE_ALERT",
      title: `Price Alert: ${alertRow.symbol}`,
      message: `${alertRow.name} (${alertRow.symbol}) hit your alert: ${alertRow.condition} ${target}. Current price: ${current.toFixed(2)}`,
      referenceId: alertRow.id,
    });
  }
}

// GET /api/alerts
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const alerts = await db.select().from(priceAlertsTable).where(eq(priceAlertsTable.userId, userId));

    // Check PENDING alerts in background
    for (const a of alerts.filter(a => a.status === "PENDING")) {
      checkAndFireAlert(a).catch(() => {});
    }

    const refreshed = await db.select().from(priceAlertsTable).where(eq(priceAlertsTable.userId, userId));
    res.json(refreshed.map(formatAlert));
  } catch (err) {
    req.log.error({ err }, "listAlerts failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/alerts
router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { symbol, market, name, condition, targetPrice, currency = "USD" } = req.body;
    if (!symbol || !market || !name || !condition || targetPrice == null) {
      res.status(400).json({ error: "symbol, market, name, condition, targetPrice required" });
      return;
    }
    const [alert] = await db.insert(priceAlertsTable).values({
      userId, symbol: symbol.toUpperCase(), market, name, condition,
      targetPrice: String(targetPrice), currency,
    }).returning();

    checkAndFireAlert(alert).catch(() => {});
    const [refreshed] = await db.select().from(priceAlertsTable).where(eq(priceAlertsTable.id, alert.id));
    res.status(201).json(formatAlert(refreshed));
  } catch (err) {
    req.log.error({ err }, "createAlert failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/alerts/:alertId
router.patch("/:alertId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const alertId = parseInt(req.params.alertId);
    const [existing] = await db.select().from(priceAlertsTable)
      .where(and(eq(priceAlertsTable.id, alertId), eq(priceAlertsTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updates: any = {};
    if (req.body.condition !== undefined) updates.condition = req.body.condition;
    if (req.body.targetPrice !== undefined) updates.targetPrice = String(req.body.targetPrice);
    if (req.body.status !== undefined) updates.status = req.body.status;

    const [updated] = await db.update(priceAlertsTable).set(updates)
      .where(eq(priceAlertsTable.id, alertId)).returning();
    res.json(formatAlert(updated));
  } catch (err) {
    req.log.error({ err }, "updateAlert failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/alerts/:alertId
router.delete("/:alertId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const alertId = parseInt(req.params.alertId);
    const [existing] = await db.select().from(priceAlertsTable)
      .where(and(eq(priceAlertsTable.id, alertId), eq(priceAlertsTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(priceAlertsTable).where(eq(priceAlertsTable.id, alertId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteAlert failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

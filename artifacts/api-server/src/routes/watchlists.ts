import { Router } from "express";
import { db, watchlistsTable, watchlistItemsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { fetchPrice } from "../lib/prices";

const router = Router();
router.use(requireAuth);

// GET /api/watchlists
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const watchlists = await db.select().from(watchlistsTable).where(eq(watchlistsTable.userId, userId));
    const withCounts = await Promise.all(watchlists.map(async wl => {
      const [{ count }] = await db.select({ count: sql<number>`count(*)` })
        .from(watchlistItemsTable).where(eq(watchlistItemsTable.watchlistId, wl.id));
      return { ...wl, itemCount: Number(count), createdAt: wl.createdAt.toISOString() };
    }));
    res.json(withCounts);
  } catch (err) {
    req.log.error({ err }, "listWatchlists failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/watchlists
router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { name, market = "MIXED" } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [wl] = await db.insert(watchlistsTable).values({ userId, name, market }).returning();
    res.status(201).json({ ...wl, itemCount: 0, createdAt: wl.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "createWatchlist failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/watchlists/:watchlistId
router.patch("/:watchlistId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const watchlistId = parseInt(req.params.watchlistId);
    const [existing] = await db.select().from(watchlistsTable)
      .where(and(eq(watchlistsTable.id, watchlistId), eq(watchlistsTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updates: any = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.market !== undefined) updates.market = req.body.market;

    const [updated] = await db.update(watchlistsTable).set(updates)
      .where(eq(watchlistsTable.id, watchlistId)).returning();
    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(watchlistItemsTable).where(eq(watchlistItemsTable.watchlistId, watchlistId));
    res.json({ ...updated, itemCount: Number(count), createdAt: updated.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "updateWatchlist failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/watchlists/:watchlistId
router.delete("/:watchlistId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const watchlistId = parseInt(req.params.watchlistId);
    const [existing] = await db.select().from(watchlistsTable)
      .where(and(eq(watchlistsTable.id, watchlistId), eq(watchlistsTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(watchlistsTable).where(eq(watchlistsTable.id, watchlistId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteWatchlist failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/watchlists/:watchlistId/items
router.get("/:watchlistId/items", async (req, res) => {
  try {
    const userId = getUserId(req);
    const watchlistId = parseInt(req.params.watchlistId);
    const [wl] = await db.select().from(watchlistsTable)
      .where(and(eq(watchlistsTable.id, watchlistId), eq(watchlistsTable.userId, userId)));
    if (!wl) { res.status(404).json({ error: "Not found" }); return; }

    const items = await db.select().from(watchlistItemsTable).where(eq(watchlistItemsTable.watchlistId, watchlistId));
    const withPrices = await Promise.all(items.map(async (item) => {
      const price = await fetchPrice(item.symbol, item.market);
      return {
        id: item.id, watchlistId: item.watchlistId, symbol: item.symbol,
        name: item.name, market: item.market,
        currentPrice: price.price,
        priceChange: price.priceChange,
        priceChangePct: price.priceChangePct,
        currency: price.currency || item.currency,
        lastUpdated: price.lastUpdated,
        createdAt: item.createdAt.toISOString(),
      };
    }));
    res.json(withPrices);
  } catch (err) {
    req.log.error({ err }, "listWatchlistItems failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/watchlists/:watchlistId/items
router.post("/:watchlistId/items", async (req, res) => {
  try {
    const userId = getUserId(req);
    const watchlistId = parseInt(req.params.watchlistId);
    const [wl] = await db.select().from(watchlistsTable)
      .where(and(eq(watchlistsTable.id, watchlistId), eq(watchlistsTable.userId, userId)));
    if (!wl) { res.status(404).json({ error: "Not found" }); return; }

    const { symbol, name, market, currency = "USD" } = req.body;
    if (!symbol || !name || !market) { res.status(400).json({ error: "symbol, name, market required" }); return; }

    const [item] = await db.insert(watchlistItemsTable).values({
      watchlistId, symbol: symbol.toUpperCase(), name, market, currency,
    }).returning();

    const price = await fetchPrice(item.symbol, item.market);
    res.status(201).json({
      id: item.id, watchlistId: item.watchlistId, symbol: item.symbol,
      name: item.name, market: item.market,
      currentPrice: price.price, priceChange: price.priceChange, priceChangePct: price.priceChangePct,
      currency: price.currency || item.currency,
      lastUpdated: price.lastUpdated,
      createdAt: item.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "addWatchlistItem failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/watchlists/:watchlistId/items/:itemId
router.delete("/:watchlistId/items/:itemId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const watchlistId = parseInt(req.params.watchlistId);
    const itemId = parseInt(req.params.itemId);
    const [wl] = await db.select().from(watchlistsTable)
      .where(and(eq(watchlistsTable.id, watchlistId), eq(watchlistsTable.userId, userId)));
    if (!wl) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(watchlistItemsTable)
      .where(and(eq(watchlistItemsTable.id, itemId), eq(watchlistItemsTable.watchlistId, watchlistId)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "removeWatchlistItem failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

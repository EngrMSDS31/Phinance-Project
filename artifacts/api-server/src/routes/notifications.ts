import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

function formatNotif(n: any) {
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    message: n.message,
    isRead: n.isRead,
    isArchived: n.isArchived,
    referenceId: n.referenceId,
    createdAt: n.createdAt.toISOString(),
  };
}

// GET /api/notifications
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const unreadOnly = req.query.unreadOnly === "true";

    const conditions = [eq(notificationsTable.userId, userId)];
    if (unreadOnly) conditions.push(eq(notificationsTable.isRead, false));

    const items = await db.select().from(notificationsTable)
      .where(and(...conditions))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(100);

    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));

    res.json({ items: items.map(formatNotif), unreadCount: Number(count) });
  } catch (err) {
    req.log.error({ err }, "listNotifications failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/notifications (clear all)
router.delete("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, userId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "clearAllNotifications failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/notifications/mark-all-read
router.post("/mark-all-read", async (req, res) => {
  try {
    const userId = getUserId(req);
    const result = await db.update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(notificationsTable).where(eq(notificationsTable.userId, userId));
    res.json({ count: Number(count) });
  } catch (err) {
    req.log.error({ err }, "markAllNotificationsRead failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/notifications/:notificationId
router.patch("/:notificationId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const notificationId = parseInt(req.params.notificationId);
    const [existing] = await db.select().from(notificationsTable)
      .where(and(eq(notificationsTable.id, notificationId), eq(notificationsTable.userId, userId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const updates: any = {};
    if (req.body.isRead !== undefined) updates.isRead = req.body.isRead;
    if (req.body.isArchived !== undefined) updates.isArchived = req.body.isArchived;

    const [updated] = await db.update(notificationsTable).set(updates)
      .where(eq(notificationsTable.id, notificationId)).returning();
    res.json(formatNotif(updated));
  } catch (err) {
    req.log.error({ err }, "updateNotification failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/notifications/:notificationId
router.delete("/:notificationId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const notificationId = parseInt(req.params.notificationId);
    await db.delete(notificationsTable)
      .where(and(eq(notificationsTable.id, notificationId), eq(notificationsTable.userId, userId)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteNotification failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

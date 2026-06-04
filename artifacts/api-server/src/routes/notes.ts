import { Router } from "express";
import { db, portfolioNotesTable, portfoliosTable, holdingsTable } from "@workspace/db";
import { eq, and, desc, or, isNull } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

async function verifyNoteOwner(noteId: number, userId: string) {
  const [note] = await db.select().from(portfolioNotesTable)
    .where(and(eq(portfolioNotesTable.id, noteId), eq(portfolioNotesTable.userId, userId)));
  return note ?? null;
}

// GET /api/notes?portfolioId=X&holdingId=Y
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = req.query.portfolioId ? parseInt(req.query.portfolioId as string) : null;
    const holdingId = req.query.holdingId ? parseInt(req.query.holdingId as string) : null;

    let where = eq(portfolioNotesTable.userId, userId);

    if (holdingId) {
      where = and(where, eq(portfolioNotesTable.holdingId, holdingId))!;
    } else if (portfolioId) {
      where = and(where, eq(portfolioNotesTable.portfolioId, portfolioId))!;
    }

    const notes = await db.select({
      id: portfolioNotesTable.id,
      portfolioId: portfolioNotesTable.portfolioId,
      holdingId: portfolioNotesTable.holdingId,
      title: portfolioNotesTable.title,
      content: portfolioNotesTable.content,
      isPinned: portfolioNotesTable.isPinned,
      color: portfolioNotesTable.color,
      createdAt: portfolioNotesTable.createdAt,
      updatedAt: portfolioNotesTable.updatedAt,
    }).from(portfolioNotesTable)
      .where(where)
      .orderBy(desc(portfolioNotesTable.isPinned), desc(portfolioNotesTable.updatedAt));

    // Enrich with portfolio/holding names
    const portfolioIds = [...new Set(notes.map(n => n.portfolioId).filter(Boolean))] as number[];
    const holdingIds = [...new Set(notes.map(n => n.holdingId).filter(Boolean))] as number[];

    const portfolios = portfolioIds.length
      ? await db.select({ id: portfoliosTable.id, name: portfoliosTable.name })
          .from(portfoliosTable).where(eq(portfoliosTable.userId, userId))
      : [];
    const holdings = holdingIds.length
      ? await db.select({ id: holdingsTable.id, symbol: holdingsTable.symbol, name: holdingsTable.name })
          .from(holdingsTable).where(eq(holdingsTable.id, holdingIds[0]))
      : [];

    const portfolioMap = new Map(portfolios.map(p => [p.id, p.name]));
    const holdingMap = new Map(holdings.map(h => [h.id, { symbol: h.symbol, name: h.name }]));

    res.json(notes.map(n => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      portfolioName: n.portfolioId ? portfolioMap.get(n.portfolioId) ?? null : null,
      holdingSymbol: n.holdingId ? holdingMap.get(n.holdingId)?.symbol ?? null : null,
    })));
  } catch (err) {
    req.log.error({ err }, "listNotes failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/notes
router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { portfolioId, holdingId, title, content, color = "default" } = req.body;

    if (!content?.trim()) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    // Verify portfolio ownership if provided
    if (portfolioId) {
      const [p] = await db.select({ id: portfoliosTable.id }).from(portfoliosTable)
        .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
      if (!p) { res.status(403).json({ error: "Portfolio not found" }); return; }
    }

    const [note] = await db.insert(portfolioNotesTable).values({
      userId,
      portfolioId: portfolioId ?? null,
      holdingId: holdingId ?? null,
      title: title?.trim() || null,
      content: content.trim(),
      color,
    }).returning();

    res.status(201).json({
      ...note,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "createNote failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/notes/:id
router.patch("/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const noteId = parseInt(req.params.id);

    const existing = await verifyNoteOwner(noteId, userId);
    if (!existing) { res.status(404).json({ error: "Note not found" }); return; }

    const { title, content, isPinned, color } = req.body;
    const updates: Partial<typeof portfolioNotesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (title !== undefined) updates.title = title?.trim() || null;
    if (content !== undefined) updates.content = content.trim();
    if (isPinned !== undefined) updates.isPinned = isPinned;
    if (color !== undefined) updates.color = color;

    const [updated] = await db.update(portfolioNotesTable)
      .set(updates)
      .where(eq(portfolioNotesTable.id, noteId))
      .returning();

    res.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "updateNote failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/notes/:id
router.delete("/:id", async (req, res) => {
  try {
    const userId = getUserId(req);
    const noteId = parseInt(req.params.id);

    const existing = await verifyNoteOwner(noteId, userId);
    if (!existing) { res.status(404).json({ error: "Note not found" }); return; }

    await db.delete(portfolioNotesTable).where(eq(portfolioNotesTable.id, noteId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "deleteNote failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/notes/:id/pin — toggle pin
router.patch("/:id/pin", async (req, res) => {
  try {
    const userId = getUserId(req);
    const noteId = parseInt(req.params.id);

    const existing = await verifyNoteOwner(noteId, userId);
    if (!existing) { res.status(404).json({ error: "Note not found" }); return; }

    const [updated] = await db.update(portfolioNotesTable)
      .set({ isPinned: !existing.isPinned, updatedAt: new Date() })
      .where(eq(portfolioNotesTable.id, noteId))
      .returning();

    res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "togglePin failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

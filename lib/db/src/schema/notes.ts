import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { portfoliosTable } from "./portfolios";
import { holdingsTable } from "./holdings";

export const portfolioNotesTable = pgTable("portfolio_notes", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  portfolioId: integer("portfolio_id").references(() => portfoliosTable.id, { onDelete: "cascade" }),
  holdingId: integer("holding_id").references(() => holdingsTable.id, { onDelete: "set null" }),
  title: text("title"),
  content: text("content").notNull(),
  isPinned: boolean("is_pinned").notNull().default(false),
  color: text("color").notNull().default("default"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPortfolioNoteSchema = createInsertSchema(portfolioNotesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type PortfolioNoteRow = typeof portfolioNotesTable.$inferSelect;
export type InsertPortfolioNote = z.infer<typeof insertPortfolioNoteSchema>;

import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const watchlistsTable = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull().default("MIXED"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const watchlistItemsTable = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  watchlistId: integer("watchlist_id").notNull().references(() => watchlistsTable.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  currency: text("currency").notNull().default("USD"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWatchlistSchema = createInsertSchema(watchlistsTable).omit({ id: true, userId: true, createdAt: true });
export const insertWatchlistItemSchema = createInsertSchema(watchlistItemsTable).omit({ id: true, createdAt: true });
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
export type WatchlistRow = typeof watchlistsTable.$inferSelect;
export type WatchlistItemRow = typeof watchlistItemsTable.$inferSelect;

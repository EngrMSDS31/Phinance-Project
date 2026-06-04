import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const psePriceCacheTable = pgTable("pse_price_cache", {
  id:              serial("id").primaryKey(),
  symbol:          text("symbol").notNull().unique(),
  lastClose:       numeric("last_close", { precision: 20, scale: 8 }).notNull(),
  lastTradingDate: text("last_trading_date").notNull(),
  fetchedAt:       timestamp("fetched_at").notNull(),
  source:          text("source").notNull().default("EODHD"),
  change:          numeric("change", { precision: 20, scale: 8 }),
  changePct:       numeric("change_pct", { precision: 10, scale: 6 }),
});

export type PsePriceCacheRow = typeof psePriceCacheTable.$inferSelect;

import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const priceCacheTable = pgTable("price_cache", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  market: text("market").notNull(),
  price: numeric("price", { precision: 20, scale: 8 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  priceChange: numeric("price_change", { precision: 20, scale: 8 }),
  priceChangePct: numeric("price_change_pct", { precision: 10, scale: 6 }),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  source: text("source"),
});

export type PriceCacheRow = typeof priceCacheTable.$inferSelect;

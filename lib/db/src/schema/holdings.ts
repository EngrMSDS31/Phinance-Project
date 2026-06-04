import { pgTable, serial, text, numeric, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { portfoliosTable } from "./portfolios";

export const holdingsTable = pgTable("holdings", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfoliosTable.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull(),
  assetType: text("asset_type").notNull().default("STOCK"),
  quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull().default("0"),
  avgCostBasis: numeric("avg_cost_basis", { precision: 20, scale: 8 }).notNull().default("0"),
  currentPrice: numeric("current_price", { precision: 20, scale: 8 }).notNull().default("0"),
  lastPriceUpdate: timestamp("last_price_update"),
  targetWeight: numeric("target_weight", { precision: 10, scale: 6 }),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes"),
  isCustom: boolean("is_custom").notNull().default(false),
  totalDividends: numeric("total_dividends", { precision: 20, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertHoldingSchema = createInsertSchema(holdingsTable).omit({ id: true, createdAt: true });
export type InsertHolding = z.infer<typeof insertHoldingSchema>;
export type HoldingRow = typeof holdingsTable.$inferSelect;

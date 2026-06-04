import { pgTable, serial, text, numeric, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portfoliosTable = pgTable("portfolios", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("USD"),
  type: text("type").notNull().default("MIXED"),
  defaultFeeRate: numeric("default_fee_rate", { precision: 10, scale: 6 }).notNull().default("0"),
  sellFeeRate: numeric("sell_fee_rate", { precision: 10, scale: 6 }).notNull().default("0"),
  defaultTaxRate: numeric("default_tax_rate", { precision: 10, scale: 6 }).notNull().default("0"),
  cashBalance: numeric("cash_balance", { precision: 20, scale: 6 }).notNull().default("0"),
  notes: text("notes"),
  color: text("color"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPortfolioSchema = createInsertSchema(portfoliosTable).omit({ id: true, userId: true, cashBalance: true, createdAt: true });
export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type Portfolio = typeof portfoliosTable.$inferSelect;

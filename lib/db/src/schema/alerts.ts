import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const priceAlertsTable = pgTable("price_alerts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  market: text("market").notNull(),
  name: text("name").notNull(),
  condition: text("condition").notNull(),
  targetPrice: numeric("target_price", { precision: 20, scale: 8 }).notNull(),
  currentPrice: numeric("current_price", { precision: 20, scale: 8 }),
  status: text("status").notNull().default("PENDING"),
  currency: text("currency").default("USD"),
  firedAt: timestamp("fired_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPriceAlertSchema = createInsertSchema(priceAlertsTable).omit({ id: true, userId: true, status: true, firedAt: true, createdAt: true });
export type InsertPriceAlert = z.infer<typeof insertPriceAlertSchema>;
export type PriceAlertRow = typeof priceAlertsTable.$inferSelect;

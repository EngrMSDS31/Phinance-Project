import { pgTable, serial, text, numeric, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { portfoliosTable } from "./portfolios";
import { holdingsTable } from "./holdings";

export const dividendEventsTable = pgTable("dividend_events", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfoliosTable.id, { onDelete: "cascade" }),
  holdingId: integer("holding_id").notNull().references(() => holdingsTable.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  dividendType: text("dividend_type").notNull().default("ORDINARY"),
  exDate: date("ex_date").notNull(),
  recordDate: date("record_date"),
  paymentDate: date("payment_date"),
  dividendPerShare: numeric("dividend_per_share", { precision: 20, scale: 8 }),
  totalAmount: numeric("total_amount", { precision: 20, scale: 6 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDividendEventSchema = createInsertSchema(dividendEventsTable).omit({ id: true, createdAt: true });
export type InsertDividendEvent = z.infer<typeof insertDividendEventSchema>;
export type DividendEventRow = typeof dividendEventsTable.$inferSelect;

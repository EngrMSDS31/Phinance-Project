import { pgTable, serial, text, numeric, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { portfoliosTable } from "./portfolios";
import { holdingsTable } from "./holdings";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfoliosTable.id, { onDelete: "cascade" }),
  holdingId: integer("holding_id").references(() => holdingsTable.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  date: date("date").notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 8 }),
  price: numeric("price", { precision: 20, scale: 8 }),
  amount: numeric("amount", { precision: 20, scale: 6 }).notNull().default("0"),
  feeAmount: numeric("fee_amount", { precision: 20, scale: 6 }),
  taxAmount: numeric("tax_amount", { precision: 20, scale: 6 }),
  feeRate: numeric("fee_rate", { precision: 10, scale: 6 }),
  taxRate: numeric("tax_rate", { precision: 10, scale: 6 }),
  currency: text("currency").notNull().default("USD"),
  notes: text("notes"),
  linkedTransactionId: integer("linked_transaction_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type TransactionRow = typeof transactionsTable.$inferSelect;

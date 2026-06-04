import { pgTable, serial, text, numeric, timestamp, integer, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { portfoliosTable } from "./portfolios";
import { holdingsTable } from "./holdings";

export const recurringPlansTable = pgTable("recurring_plans", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfoliosTable.id, { onDelete: "cascade" }),
  holdingId: integer("holding_id").references(() => holdingsTable.id, { onDelete: "set null" }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  market: text("market").notNull().default("US"),
  frequency: text("frequency").notNull(),
  investAmount: numeric("invest_amount", { precision: 20, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  nextRunDate: date("next_run_date").notNull(),
  lastRunDate: date("last_run_date"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRecurringPlanSchema = createInsertSchema(recurringPlansTable).omit({
  id: true,
  userId: true,
  holdingId: true,
  lastRunDate: true,
  createdAt: true,
});

export type RecurringPlanRow = typeof recurringPlansTable.$inferSelect;
export type InsertRecurringPlan = z.infer<typeof insertRecurringPlanSchema>;

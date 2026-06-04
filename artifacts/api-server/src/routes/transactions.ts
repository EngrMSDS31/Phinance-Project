import { Router } from "express";
import { db, portfoliosTable, holdingsTable, transactionsTable, dividendEventsTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const FUNDS_BONDS_MARKETS = new Set(["FUNDS", "BONDS"]);

async function ownsPortfolio(userId: string, portfolioId: number): Promise<boolean> {
  const [p] = await db.select({ id: portfoliosTable.id }).from(portfoliosTable)
    .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
  return !!p;
}

async function getHoldingMarket(holdingId: number | null): Promise<string | null> {
  if (!holdingId) return null;
  const [h] = await db.select({ market: holdingsTable.market }).from(holdingsTable)
    .where(eq(holdingsTable.id, holdingId));
  return h?.market ?? null;
}

async function recalcHolding(holdingId: number) {
  const [holding] = await db.select({ market: holdingsTable.market }).from(holdingsTable)
    .where(eq(holdingsTable.id, holdingId));

  const txs = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.holdingId, holdingId))
    .orderBy(transactionsTable.date);

  const hasFundTransfer = txs.some(tx => tx.type === "FUND_TRANSFER_IN" || tx.type === "FUND_TRANSFER_OUT");

  if (holding && (FUNDS_BONDS_MARKETS.has(holding.market) || hasFundTransfer)) {
    // FUNDS / BONDS: value accumulates from transfer amounts + net dividends
    let totalIn = 0;
    let totalOut = 0;
    let totalDividends = 0;

    for (const tx of txs) {
      const amt = parseFloat(tx.amount);
      if (tx.type === "FUND_TRANSFER_IN") {
        totalIn += amt;
      } else if (tx.type === "FUND_TRANSFER_OUT") {
        totalOut += amt;
      } else if (["DIVIDEND", "COUPON_INTEREST", "DISTRIBUTION"].includes(tx.type)) {
        const fee = parseFloat(tx.feeAmount ?? "0");
        const tax = parseFloat(tx.taxAmount ?? "0");
        totalDividends += Math.max(0, Math.abs(amt) - fee - tax);
      }
    }

    const netInvested = Math.max(0, totalIn - totalOut);
    const netValue = Math.max(0, totalIn - totalOut + totalDividends);

    await db.update(holdingsTable).set({
      quantity: netValue > 0 ? "1" : "0",
      avgCostBasis: String(netInvested),
      currentPrice: String(netValue),
      totalDividends: String(totalDividends),
    }).where(eq(holdingsTable.id, holdingId));
    return;
  }

  // Standard stocks / ETFs / crypto / custom
  let qty = 0;
  let totalCost = 0;
  let totalDividends = 0;

  for (const tx of txs) {
    const txQty = parseFloat(tx.quantity ?? "0");
    const txAmount = parseFloat(tx.amount);

    if (tx.type === "BUY") {
      const txFee = parseFloat(tx.feeAmount ?? "0");
      const txTax = parseFloat(tx.taxAmount ?? "0");
      totalCost += txAmount - txFee - txTax;
      qty += txQty;
    } else if (tx.type === "SELL" || tx.type === "MATURITY") {
      if (qty > 0) {
        const sellRatio = Math.min(txQty / qty, 1);
        totalCost = totalCost * (1 - sellRatio);
      }
      qty -= txQty;
    } else if (tx.type === "STOCK_SPLIT") {
      qty += txQty;
    } else if (["DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION"].includes(tx.type)) {
      totalDividends += Math.abs(txAmount);
    }
  }

  const avgCostBasis = qty > 0 ? totalCost / qty : 0;
  await db.update(holdingsTable).set({
    quantity: String(Math.max(0, qty)),
    avgCostBasis: String(avgCostBasis),
    totalDividends: String(totalDividends),
  }).where(eq(holdingsTable.id, holdingId));
}

async function updateCashBalance(
  portfolioId: number,
  type: string,
  amount: number,
  feeAmount: number,
  taxAmount: number,
  reverse = false,
  holdingMarket?: string | null,
) {
  const isFundsBonds = holdingMarket != null && FUNDS_BONDS_MARKETS.has(holdingMarket);
  const sign = reverse ? -1 : 1;
  let delta = 0;

  if (type === "DEPOSIT" || type === "CASH_GAIN") delta = amount * sign;
  else if (type === "WITHDRAWAL" || type === "CASH_EXPENSE") delta = -amount * sign;
  else if (type === "BUY") delta = -(amount) * sign;
  else if (type === "SELL" || type === "MATURITY") delta = amount * sign;
  else if (type === "DIVIDEND" || type === "COUPON_INTEREST" || type === "STAKING_REWARD" || type === "DISTRIBUTION") {
    // For FUNDS/BONDS holdings, dividends accumulate in the holding value — NOT cash
    if (!isFundsBonds) delta = amount * sign;
  }
  else if (type === "FEE") delta = -amount * sign;
  else if (type === "TAX") delta = -amount * sign;
  else if (type === "FUND_TRANSFER_IN") delta = -amount * sign;  // Cash → Holding: cash decreases
  else if (type === "FUND_TRANSFER_OUT") delta = amount * sign;  // Holding → Cash: cash increases
  // STOCK_SPLIT and TRANSFER have no cash balance impact

  if (delta !== 0) {
    await db.update(portfoliosTable).set({
      cashBalance: sql`cash_balance + ${String(delta)}`,
    }).where(eq(portfoliosTable.id, portfolioId));
  }
}

function formatTx(tx: any, holding?: any) {
  return {
    id: tx.id,
    portfolioId: tx.portfolioId,
    holdingId: tx.holdingId,
    holdingSymbol: holding?.symbol ?? null,
    holdingName: holding?.name ?? null,
    type: tx.type,
    date: tx.date,
    quantity: tx.quantity != null ? parseFloat(tx.quantity) : null,
    price: tx.price != null ? parseFloat(tx.price) : null,
    amount: parseFloat(tx.amount),
    feeAmount: tx.feeAmount != null ? parseFloat(tx.feeAmount) : null,
    taxAmount: tx.taxAmount != null ? parseFloat(tx.taxAmount) : null,
    feeRate: tx.feeRate != null ? parseFloat(tx.feeRate) : null,
    taxRate: tx.taxRate != null ? parseFloat(tx.taxRate) : null,
    currency: tx.currency,
    notes: tx.notes,
    linkedTransactionId: tx.linkedTransactionId,
    createdAt: tx.createdAt.toISOString(),
  };
}

// GET /api/portfolios/:portfolioId/transactions
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(transactionsTable).where(eq(transactionsTable.portfolioId, portfolioId));

    const txs = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.portfolioId, portfolioId))
      .orderBy(desc(transactionsTable.date), desc(transactionsTable.createdAt))
      .limit(limit).offset(offset);

    const holdingIds = [...new Set(txs.filter(t => t.holdingId).map(t => t.holdingId!))];
    const holdings = holdingIds.length
      ? await db.select().from(holdingsTable).where(inArray(holdingsTable.id, holdingIds))
      : [];
    const holdingMap = new Map(holdings.map(h => [h.id, h]));

    res.json({
      items: txs.map(tx => formatTx(tx, holdingMap.get(tx.holdingId!))),
      total: Number(count),
      page,
      limit,
    });
  } catch (err) {
    req.log.error({ err }, "listTransactions failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/portfolios/:portfolioId/transactions
router.post("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const { holdingId, type, date, quantity, price, amount, feeAmount, taxAmount, feeRate, taxRate, currency, notes, linkedTransactionId, symbol, market, name, assetType } = req.body;

    const [portfolioRow] = await db.select({ baseCurrency: portfoliosTable.baseCurrency })
      .from(portfoliosTable).where(eq(portfoliosTable.id, portfolioId));
    const txCurrency = currency || portfolioRow?.baseCurrency || "USD";

    const HOLDING_TYPES = ["BUY", "SELL", "DIVIDEND", "STOCK_SPLIT", "COUPON_INTEREST", "STAKING_REWARD", "MATURITY", "TRANSFER", "DISTRIBUTION", "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT"];
    let resolvedHoldingId: number | null = holdingId ?? null;
    if (!resolvedHoldingId && HOLDING_TYPES.includes(type) && symbol && market) {
      const symbolUpper = String(symbol).toUpperCase();
      const [existing] = await db.select({ id: holdingsTable.id }).from(holdingsTable)
        .where(and(eq(holdingsTable.portfolioId, portfolioId), eq(holdingsTable.symbol, symbolUpper), eq(holdingsTable.market, String(market))));
      if (existing) {
        resolvedHoldingId = existing.id;
      } else {
        const [created] = await db.insert(holdingsTable).values({
          portfolioId,
          symbol: symbolUpper,
          name: String(name || symbolUpper),
          market: String(market),
          assetType: String(assetType || "STOCK"),
          currency: txCurrency,
          isCustom: String(market) === "CUSTOM",
        }).returning();
        resolvedHoldingId = created.id;
      }
    }

    const [tx] = await db.insert(transactionsTable).values({
      portfolioId, holdingId: resolvedHoldingId, type, date,
      quantity: quantity != null ? String(quantity) : null,
      price: price != null ? String(price) : null,
      amount: String(amount ?? 0),
      feeAmount: feeAmount != null ? String(feeAmount) : null,
      taxAmount: taxAmount != null ? String(taxAmount) : null,
      feeRate: feeRate != null ? String(feeRate) : null,
      taxRate: taxRate != null ? String(taxRate) : null,
      currency: txCurrency, notes,
      linkedTransactionId: linkedTransactionId ?? null,
    }).returning();

    const holdingMarket = await getHoldingMarket(resolvedHoldingId);
    if (resolvedHoldingId) await recalcHolding(resolvedHoldingId);
    await updateCashBalance(portfolioId, type, parseFloat(amount ?? 0), parseFloat(feeAmount ?? 0), parseFloat(taxAmount ?? 0), false, holdingMarket);

    // No auto-create of dividend_events — transactions are the single source of truth for paid dividends

    const holding = resolvedHoldingId
      ? (await db.select().from(holdingsTable).where(eq(holdingsTable.id, resolvedHoldingId)))[0]
      : null;

    res.status(201).json(formatTx(tx, holding));
  } catch (err) {
    req.log.error({ err }, "createTransaction failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/portfolios/:portfolioId/transactions/:transactionId
router.get("/:transactionId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const transactionId = parseInt(req.params.transactionId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const [tx] = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.id, transactionId), eq(transactionsTable.portfolioId, portfolioId)));
    if (!tx) { res.status(404).json({ error: "Not found" }); return; }

    const holding = tx.holdingId
      ? (await db.select().from(holdingsTable).where(eq(holdingsTable.id, tx.holdingId)))[0]
      : null;
    res.json(formatTx(tx, holding));
  } catch (err) {
    req.log.error({ err }, "getTransaction failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/portfolios/:portfolioId/transactions/:transactionId
router.patch("/:transactionId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const transactionId = parseInt(req.params.transactionId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const [existing] = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.id, transactionId), eq(transactionsTable.portfolioId, portfolioId)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    // Reverse old cash impact — must know the old holding market
    const oldHoldingMarket = await getHoldingMarket(existing.holdingId);
    await updateCashBalance(portfolioId, existing.type, parseFloat(existing.amount), parseFloat(existing.feeAmount ?? "0"), parseFloat(existing.taxAmount ?? "0"), true, oldHoldingMarket);

    const updates: any = {};
    const fields = ["holdingId", "type", "date", "quantity", "price", "amount", "feeAmount", "taxAmount", "feeRate", "taxRate", "currency", "notes"];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates[f] = typeof req.body[f] === "number" ? String(req.body[f]) : req.body[f];
      }
    }

    const [updated] = await db.update(transactionsTable).set(updates)
      .where(eq(transactionsTable.id, transactionId)).returning();

    const newHoldingMarket = await getHoldingMarket(updated.holdingId);
    if (updated.holdingId) await recalcHolding(updated.holdingId);
    await updateCashBalance(portfolioId, updated.type, parseFloat(updated.amount), parseFloat(updated.feeAmount ?? "0"), parseFloat(updated.taxAmount ?? "0"), false, newHoldingMarket);

    const holding = updated.holdingId
      ? (await db.select().from(holdingsTable).where(eq(holdingsTable.id, updated.holdingId)))[0]
      : null;
    res.json(formatTx(updated, holding));
  } catch (err) {
    req.log.error({ err }, "updateTransaction failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/portfolios/:portfolioId/transactions/:transactionId
router.delete("/:transactionId", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const transactionId = parseInt(req.params.transactionId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const [tx] = await db.select().from(transactionsTable)
      .where(and(eq(transactionsTable.id, transactionId), eq(transactionsTable.portfolioId, portfolioId)));
    if (!tx) { res.status(404).json({ error: "Not found" }); return; }

    const holdingMarket = await getHoldingMarket(tx.holdingId);
    await db.delete(transactionsTable).where(eq(transactionsTable.id, transactionId));
    if (tx.holdingId) await recalcHolding(tx.holdingId);
    await updateCashBalance(portfolioId, tx.type, parseFloat(tx.amount), parseFloat(tx.feeAmount ?? "0"), parseFloat(tx.taxAmount ?? "0"), true, holdingMarket);

    // Cascade-delete any matching dividend_events entry so Calendar/List View stays in sync
    if (tx.type === "DIVIDEND" && tx.holdingId && tx.date) {
      await db.delete(dividendEventsTable).where(
        and(
          eq(dividendEventsTable.portfolioId, portfolioId),
          eq(dividendEventsTable.holdingId, tx.holdingId),
          eq(dividendEventsTable.exDate, tx.date)
        )
      );
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteTransaction failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/portfolios/:portfolioId/transactions/batch-delete
router.post("/batch-delete", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    if (!await ownsPortfolio(userId, portfolioId)) { res.status(404).json({ error: "Not found" }); return; }

    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids array required" }); return; }

    const txs = await db.select().from(transactionsTable)
      .where(and(inArray(transactionsTable.id, ids), eq(transactionsTable.portfolioId, portfolioId)));

    for (const tx of txs) {
      const holdingMarket = await getHoldingMarket(tx.holdingId);
      await db.delete(transactionsTable).where(eq(transactionsTable.id, tx.id));
      if (tx.holdingId) await recalcHolding(tx.holdingId);
      await updateCashBalance(portfolioId, tx.type, parseFloat(tx.amount), parseFloat(tx.feeAmount ?? "0"), parseFloat(tx.taxAmount ?? "0"), true, holdingMarket);
    }

    res.json({ count: txs.length });
  } catch (err) {
    req.log.error({ err }, "batchDeleteTransactions failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

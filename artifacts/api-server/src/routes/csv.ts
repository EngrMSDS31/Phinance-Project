import { Router } from "express";
import { db, portfoliosTable, holdingsTable, transactionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";
import { searchSymbols } from "../lib/prices";
import { PSE_STOCKS } from "../lib/pse-stocks";

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function ownsPortfolio(userId: string, portfolioId: number): Promise<any> {
  const [p] = await db.select().from(portfoliosTable)
    .where(and(eq(portfoliosTable.id, portfolioId), eq(portfoliosTable.userId, userId)));
  return p ?? null;
}

const CSV_HEADERS = ["Date", "Type", "Symbol", "Name", "Market", "Quantity", "Price", "Amount", "Fee", "Tax", "Currency", "Notes"];

const EVENT_TYPE_MAP: Record<string, string> = {
  "BUY": "BUY",
  "SELL": "SELL",
  "DIVIDEND": "DIVIDEND",
  "CASH_IN": "DEPOSIT",
  "CASH_OUT": "WITHDRAWAL",
  "CASH_GAIN": "CASH_GAIN",
  "CASH_EXPENSE": "CASH_EXPENSE",
  "FEE": "FEE",
  "TAX": "TAX",
  "DEPOSIT": "DEPOSIT",
  "WITHDRAWAL": "WITHDRAWAL",
};

const SKIP_EVENTS = new Set(["CUSTOM_HOLDING_PRICE", "CUSTOM_HOLDING_SETTINGS"]);

const EXCHANGE_MAP: Record<string, string> = {
  "PSE": "PSE",
  "LSE": "LSE",
  "US": "US",
  "NYSE": "US",
  "NASDAQ": "US",
  "CRYPTO": "CRYPTO",
  "CUSTOM_HOLDING": "CUSTOM",
  "CUSTOM": "CUSTOM",
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && inQuotes && line[i + 1] === '"') { current += '"'; i++; }
    else if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

function parseDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [m, d, y] = parts;
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return dateStr;
}

function detectFormat(headerLine: string): "standard" | "template" {
  const cols = parseCsvLine(headerLine);
  return cols[0]?.toLowerCase() === "event" ? "template" : "standard";
}

interface ParsedRow {
  type: string; date: string; symbol: string; name: string; market: string;
  quantity: number | null; price: number | null; amount: number;
  feeAmount: number | null; taxAmount: number | null; currency: string;
  notes: string | null; skip: boolean;
}

function parseTemplateRow(row: string[]): ParsedRow {
  const [event, date, symbol, priceStr, quantityStr, currency, feeTaxStr, exchange, , , note] = row;

  if (SKIP_EVENTS.has(event?.toUpperCase())) {
    return { type: "", date: "", symbol: "", name: "", market: "", quantity: null, price: null, amount: 0, feeAmount: null, taxAmount: null, currency: "", notes: null, skip: true };
  }

  const typeKey = event?.toUpperCase();
  const type = EVENT_TYPE_MAP[typeKey] || typeKey;
  const price = parseFloat(priceStr ?? "0") || 0;
  const quantity = parseFloat(quantityStr ?? "0") || 0;
  const feeTax = parseFloat(feeTaxStr ?? "0") || 0;
  const amount = Math.abs(price * quantity);

  const rawMarket = (exchange ?? "").toUpperCase();
  const market = EXCHANGE_MAP[rawMarket] || (rawMarket || "CUSTOM");

  const isCashEvent = ["DEPOSIT", "WITHDRAWAL", "CASH_GAIN", "CASH_EXPENSE", "FEE", "TAX"].includes(type);
  const stockSymbol = isCashEvent ? "" : (symbol || "");

  // Route FeeTax to the correct typed field based on transaction type:
  // BUY  → Buy Fee (feeAmount)
  // SELL → Sell Fee/Tax combined (feeAmount)
  // DIVIDEND → Dividend Tax (taxAmount)
  // Other → feeAmount by default
  let routedFeeAmount: number | null = null;
  let routedTaxAmount: number | null = null;
  if (feeTax > 0) {
    if (type === "DIVIDEND") {
      routedTaxAmount = feeTax;
    } else {
      routedFeeAmount = feeTax;
    }
  }

  return {
    type, date: parseDate(date),
    symbol: stockSymbol, name: stockSymbol,
    market, quantity: quantity || null, price: price || null,
    amount, feeAmount: routedFeeAmount,
    taxAmount: routedTaxAmount,
    currency: currency || "USD", notes: note || null, skip: false,
  };
}

// POST /api/portfolios/:portfolioId/csv/import
router.post("/import", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const portfolio = await ownsPortfolio(userId, portfolioId);
    if (!portfolio) { res.status(404).json({ error: "Not found" }); return; }

    const { csvContent, dryRun = false } = req.body;
    if (!csvContent) { res.status(400).json({ error: "csvContent required" }); return; }

    const lines = csvContent.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) { res.json({ imported: 0, skipped: 0, errors: ["No data rows found"] }); return; }

    const format = detectFormat(lines[0]);
    const dataLines = lines.slice(1);
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const row = parseCsvLine(dataLines[i]);
      try {
        let parsed: ParsedRow;

        if (format === "template") {
          parsed = parseTemplateRow(row);
          if (parsed.skip) { skipped++; continue; }
        } else {
          const [dateRaw, typeRaw, sym, nm, mkt, quantityStr, priceStr, amountStr, feeStr, taxStr, curr = "USD", noteRaw] = row;
          if (!dateRaw || !typeRaw) { skipped++; continue; }
          parsed = {
            type: typeRaw, date: parseDate(dateRaw),
            symbol: sym || "", name: nm || sym || "", market: mkt || "US",
            quantity: parseFloat(quantityStr ?? "0") || null,
            price: parseFloat(priceStr ?? "0") || null,
            amount: parseFloat(amountStr ?? "0") || 0,
            feeAmount: parseFloat(feeStr ?? "0") || null,
            taxAmount: parseFloat(taxStr ?? "0") || null,
            currency: curr, notes: noteRaw || null, skip: false,
          };
        }

        const { type, date, symbol, name, market, quantity, price, amount, feeAmount, taxAmount, currency, notes } = parsed;

        const validTypes = ["BUY", "SELL", "DIVIDEND", "FEE", "TAX", "DEPOSIT", "WITHDRAWAL", "CASH_GAIN", "CASH_EXPENSE"];
        if (!validTypes.includes(type.toUpperCase())) {
          errors.push(`Row ${i + 2}: Invalid type "${type}"`);
          skipped++;
          continue;
        }

        if (!dryRun) {
          let holdingId: number | null = null;
          if (symbol && name && market && ["BUY", "SELL", "DIVIDEND"].includes(type.toUpperCase())) {
            let [holding] = await db.select().from(holdingsTable)
              .where(and(
                eq(holdingsTable.portfolioId, portfolioId),
                eq(holdingsTable.symbol, symbol.toUpperCase()),
              ));

            if (!holding) {
              let resolvedName = name || symbol;
              if (!name || name === symbol) {
                const mktUp = market.toUpperCase();
                if (mktUp === "PSE") {
                  const pse = PSE_STOCKS.find(s => s.symbol === symbol.toUpperCase());
                  if (pse?.name) resolvedName = pse.name;
                } else if (["US", "LSE"].includes(mktUp)) {
                  try {
                    const results = await searchSymbols(symbol, mktUp);
                    if (results.length > 0) resolvedName = results[0].name;
                  } catch { /* ignore lookup failures */ }
                }
              }
              [holding] = await db.insert(holdingsTable).values({
                portfolioId, symbol: symbol.toUpperCase(), name: resolvedName,
                market: market.toUpperCase(), currency: currency || portfolio.baseCurrency,
                assetType: market.toUpperCase() === "CRYPTO" ? "CRYPTO" : "STOCK",
              }).returning();
            }
            holdingId = holding.id;
          }

          await db.insert(transactionsTable).values({
            portfolioId, holdingId,
            type: type.toUpperCase(),
            date,
            quantity: quantity != null ? String(quantity) : null,
            price: price != null ? String(price) : null,
            amount: String(amount),
            feeAmount: feeAmount != null ? String(feeAmount) : null,
            taxAmount: taxAmount != null ? String(taxAmount) : null,
            currency: currency || portfolio.baseCurrency,
            notes: notes || null,
          });

          if (holdingId) {
            const txs = await db.select().from(transactionsTable)
              .where(eq(transactionsTable.holdingId, holdingId));
            let qty = 0, totalCost = 0, totalDiv = 0;
            for (const tx of txs) {
              const tq = parseFloat(tx.quantity ?? "0");
              const ta = parseFloat(tx.amount);
              if (tx.type === "BUY") { totalCost += ta + parseFloat(tx.feeAmount ?? "0") + parseFloat(tx.taxAmount ?? "0"); qty += tq; }
              else if (tx.type === "SELL") { if (qty > 0) totalCost *= (1 - tq / qty); qty -= tq; }
              else if (tx.type === "DIVIDEND") totalDiv += Math.abs(ta);
            }
            await db.update(holdingsTable).set({
              quantity: String(Math.max(0, qty)),
              avgCostBasis: String(qty > 0 ? totalCost / qty : 0),
              totalDividends: String(totalDiv),
            }).where(eq(holdingsTable.id, holdingId));
          }

          const fee = feeAmount ?? 0;
          const tax = taxAmount ?? 0;
          let delta = 0;
          if (["DEPOSIT", "CASH_GAIN"].includes(type.toUpperCase())) delta = amount;
          else if (["WITHDRAWAL", "CASH_EXPENSE"].includes(type.toUpperCase())) delta = -amount;
          else if (type.toUpperCase() === "BUY") delta = -(amount + fee + tax);
          else if (type.toUpperCase() === "SELL") delta = amount - fee - tax;
          else if (type.toUpperCase() === "DIVIDEND") delta = amount - fee - tax;
          else if (["FEE", "TAX"].includes(type.toUpperCase())) delta = -amount;

          if (delta !== 0) {
            await db.update(portfoliosTable).set({
              cashBalance: `${parseFloat(portfolio.cashBalance) + delta}`,
            }).where(eq(portfoliosTable.id, portfolioId));
            portfolio.cashBalance = `${parseFloat(portfolio.cashBalance) + delta}`;
          }
        }
        imported++;
      } catch (rowErr) {
        errors.push(`Row ${i + 2}: ${rowErr}`);
        skipped++;
      }
    }

    res.json({ imported, skipped, errors });
  } catch (err) {
    req.log.error({ err }, "importCsv failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/portfolios/:portfolioId/csv/export
router.get("/export", async (req, res) => {
  try {
    const userId = getUserId(req);
    const portfolioId = parseInt((req.params as any).portfolioId);
    const portfolio = await ownsPortfolio(userId, portfolioId);
    if (!portfolio) { res.status(404).json({ error: "Not found" }); return; }

    const txs = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.portfolioId, portfolioId));

    const holdingIds = [...new Set(txs.filter(t => t.holdingId).map(t => t.holdingId!))];
    const holdingMap = new Map<number, any>();
    for (const hid of holdingIds) {
      const [h] = await db.select().from(holdingsTable).where(eq(holdingsTable.id, hid));
      if (h) holdingMap.set(hid, h);
    }

    const rows = [CSV_HEADERS.join(",")];
    for (const tx of txs) {
      const h = tx.holdingId ? holdingMap.get(tx.holdingId) : null;
      const row = [
        tx.date,
        tx.type,
        h?.symbol ?? "",
        h?.name ?? "",
        h?.market ?? "",
        tx.quantity ?? "",
        tx.price ?? "",
        tx.amount,
        tx.feeAmount ?? "",
        tx.taxAmount ?? "",
        tx.currency,
        tx.notes ? `"${tx.notes.replace(/"/g, '""')}"` : "",
      ];
      rows.push(row.join(","));
    }

    const csvContent = rows.join("\n");
    const filename = `portfolio-${portfolio.name.replace(/[^a-z0-9]/gi, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
    res.json({ csvContent, filename });
  } catch (err) {
    req.log.error({ err }, "exportCsv failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

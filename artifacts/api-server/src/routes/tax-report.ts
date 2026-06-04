import { Router } from "express";
import { db, portfoliosTable, holdingsTable, transactionsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth, getUserId } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

interface Lot {
  date: string; // YYYY-MM-DD
  qty: number;
  price: number; // cost per share
  currency: string;
}

interface RealizedEvent {
  portfolioId: number;
  portfolioName: string;
  holdingId: number | null;
  symbol: string;
  saleDate: string;
  qty: number;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
  holdingDays: number;
  termType: "SHORT" | "LONG";
  currency: string;
}

interface DividendEvent {
  portfolioId: number;
  portfolioName: string;
  holdingId: number | null;
  symbol: string;
  date: string;
  amount: number;
  currency: string;
}

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

// GET /api/tax-report?year=2024&portfolioId=optional
router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));
    const filterPortfolioId = req.query.portfolioId
      ? parseInt(req.query.portfolioId as string)
      : null;

    // Fetch all user portfolios (or just the filtered one)
    const allPortfolios = await db.select().from(portfoliosTable)
      .where(eq(portfoliosTable.userId, userId));

    const portfolios = filterPortfolioId
      ? allPortfolios.filter(p => p.id === filterPortfolioId)
      : allPortfolios;

    if (portfolios.length === 0) {
      res.json(buildEmptyResponse(year, allPortfolios.map(p => ({ id: p.id, name: p.name }))));
      return;
    }

    const realizedEvents: RealizedEvent[] = [];
    const dividendEvents: DividendEvent[] = [];

    for (const portfolio of portfolios) {
      // Get all holdings for this portfolio (including zero-qty, since they may have been sold)
      const holdings = await db.select().from(holdingsTable)
        .where(eq(holdingsTable.portfolioId, portfolio.id));

      const holdingMap = new Map(holdings.map(h => [h.id, h]));

      // Get all transactions chronologically
      const txs = await db.select().from(transactionsTable)
        .where(eq(transactionsTable.portfolioId, portfolio.id))
        .orderBy(asc(transactionsTable.date));

      // Group transactions by holdingId for lot tracking
      const byHolding = new Map<number | null, typeof txs>();
      for (const tx of txs) {
        const key = tx.holdingId;
        if (!byHolding.has(key)) byHolding.set(key, []);
        byHolding.get(key)!.push(tx);
      }

      for (const [holdingId, hTxs] of byHolding) {
        const holding = holdingId != null ? holdingMap.get(holdingId) : null;
        const symbol = holding?.symbol ?? "CASH";
        const defaultCurrency = holding?.currency ?? portfolio.baseCurrency;

        // FIFO lot queue
        const lots: Lot[] = [];

        for (const tx of hTxs) {
          const qty = tx.quantity ? parseFloat(tx.quantity) : 0;
          const price = tx.price ? parseFloat(tx.price) : 0;
          const amount = parseFloat(tx.amount);
          const currency = tx.currency ?? defaultCurrency;

          if (tx.type === "BUY" && qty > 0) {
            lots.push({ date: tx.date, qty, price: price || (qty > 0 ? amount / qty : 0), currency });
          } else if (tx.type === "SELL" && qty > 0) {
            // Match against FIFO lots
            let remaining = qty;
            while (remaining > 1e-9 && lots.length > 0) {
              const lot = lots[0];
              const used = Math.min(lot.qty, remaining);
              lot.qty -= used;
              remaining -= used;

              const costBasis = used * lot.price;
              const proceedsPerShare = price || (qty > 0 ? amount / qty : 0);
              const proceeds = used * proceedsPerShare;
              const gainLoss = proceeds - costBasis;
              const holdingDays = daysBetween(lot.date, tx.date);

              const txYear = new Date(tx.date).getFullYear();
              if (txYear === year) {
                realizedEvents.push({
                  portfolioId: portfolio.id,
                  portfolioName: portfolio.name,
                  holdingId,
                  symbol,
                  saleDate: tx.date,
                  qty: used,
                  proceeds,
                  costBasis,
                  gainLoss,
                  holdingDays,
                  termType: holdingDays >= 365 ? "LONG" : "SHORT",
                  currency,
                });
              }

              if (lot.qty < 1e-9) lots.shift();
            }
          } else if (tx.type === "DIVIDEND") {
            const txYear = new Date(tx.date).getFullYear();
            if (txYear === year) {
              dividendEvents.push({
                portfolioId: portfolio.id,
                portfolioName: portfolio.name,
                holdingId,
                symbol,
                date: tx.date,
                amount,
                currency,
              });
            }
          }
        }
      }
    }

    // Sort
    realizedEvents.sort((a, b) => a.saleDate.localeCompare(b.saleDate));
    dividendEvents.sort((a, b) => a.date.localeCompare(b.date));

    // Summary
    const shortTermGain = realizedEvents
      .filter(e => e.termType === "SHORT")
      .reduce((s, e) => s + e.gainLoss, 0);
    const longTermGain = realizedEvents
      .filter(e => e.termType === "LONG")
      .reduce((s, e) => s + e.gainLoss, 0);
    const totalRealizedGain = shortTermGain + longTermGain;
    const totalDividends = dividendEvents.reduce((s, e) => s + e.amount, 0);

    res.json({
      year,
      summary: {
        totalRealizedGain: round(totalRealizedGain),
        shortTermGain: round(shortTermGain),
        longTermGain: round(longTermGain),
        totalDividends: round(totalDividends),
        totalTaxableIncome: round(totalRealizedGain + totalDividends),
        realizedCount: realizedEvents.length,
        dividendCount: dividendEvents.length,
      },
      realizedEvents: realizedEvents.map(e => ({ ...e, proceeds: round(e.proceeds), costBasis: round(e.costBasis), gainLoss: round(e.gainLoss) })),
      dividendEvents: dividendEvents.map(e => ({ ...e, amount: round(e.amount) })),
      portfolios: allPortfolios.map(p => ({ id: p.id, name: p.name })),
      availableYears: buildAvailableYears(),
    });
  } catch (err) {
    req.log.error({ err }, "getTaxReport failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

function round(n: number) { return Math.round(n * 100) / 100; }

function buildEmptyResponse(year: number, portfolios: Array<{ id: number; name: string }>) {
  return {
    year,
    summary: { totalRealizedGain: 0, shortTermGain: 0, longTermGain: 0, totalDividends: 0, totalTaxableIncome: 0, realizedCount: 0, dividendCount: 0 },
    realizedEvents: [],
    dividendEvents: [],
    portfolios,
    availableYears: buildAvailableYears(),
  };
}

function buildAvailableYears() {
  const current = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => current - i);
}

export default router;

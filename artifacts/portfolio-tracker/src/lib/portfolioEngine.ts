/**
 * Universal Portfolio Computation Engine
 *
 * Single source of truth for all portfolio metrics.
 * Dashboard, Analytics, and Portfolio Tab all consume this module —
 * no other file may perform its own profit/value calculations.
 *
 * Authoritative formulas:
 *   Total Profit (Net)   = Capital Gain (Net) + Realized Gains (Net) + Dividends (Net)
 *   Capital Gain (Net)   = (currentPrice − FIFO avgCost) × unsoldShares − buyFees
 *   Realized Gains (Net) = sellProceeds − FIFOcost − sellFees − sellTaxes
 *   Dividends (Net)      = grossDividends − divTaxes
 *   Fees Paid            = buyFees + sellFees  (reported separately, NOT deducted again)
 *   Taxes                = sellTaxes + divTaxes (reported separately, NOT deducted again)
 *   Invested             = Deposits − Withdrawals  (fallback: FIFO BUY cost)
 *   Cash Net             = cashGains − cashExpenses
 *   Total Portfolio Value = Invested + Total Profit + Cash Net
 *   Total Profit %        = Total Profit ÷ Invested × 100
 *
 * FX rule:
 *   Single-portfolio view  → convertFn converts each holding's currency to portfolio baseCurrency
 *   All-portfolios view    → convertFn converts each holding's currency to user displayCurrency
 *   Pass the correct convertFn; the engine is currency-agnostic.
 */

import { computeFIFO, buildXirrCashFlows, type CashFlow } from "./fifo";

// ── Public types ──────────────────────────────────────────────────────────────

export interface HoldingEntry {
  holdingId?: number;
  symbol: string;
  currentPrice: number;
  /** Native currency of this holding (e.g. "GBP" for LSE stocks). */
  currency: string;
  /** Only BUY / SELL / DIVIDEND transactions for this holding. */
  txs: any[];
  /**
   * FUNDS / BONDS only — when set, bypass FIFO and use this as the holding's
   * current value directly (equals DB currentPrice × quantity = netValue).
   */
  precomputedCurrentValue?: number;
  /**
   * FUNDS / BONDS only — net invested amount (totalIn − totalOut).
   * Falls back to precomputedCurrentValue when not set.
   */
  precomputedInvested?: number;
}

export interface DepositRecord {
  type: "DEPOSIT" | "WITHDRAWAL";
  amount: string | number;
  /** Currency the transaction was recorded in. */
  currency: string;
}

export interface CashRecord {
  type: "CASH_GAIN" | "CASH_EXPENSE";
  amount: string | number;
  /** Currency the transaction was recorded in. */
  currency: string;
}

export interface PortfolioMetrics {
  // ── Guaranteed identity ───────────────────────────────────────────────────
  // totalPortfolioValue = totalInvested + totalProfit + cashNet
  totalInvested: number;
  totalProfit: number;
  totalProfitPct: number | null;
  cashNet: number;              // cashGains − cashExpenses (non-investment flows)
  cashIncentive: number;        // alias for cashNet — displayed as "Cash Incentive" in UI
  totalPortfolioValue: number;  // totalInvested + totalProfit + cashNet
  currentValue: number;         // alias for totalPortfolioValue

  // ── Profit breakdown ─────────────────────────────────────────────────────
  totalCapGainSubtext: number;    // unrealised net of buy fees
  totalRealizedSubtext: number;   // realised net of sell fees & taxes
  totalDividendsSubtext: number;  // gross dividends net of withholding taxes

  // ── Cost reporting (already embedded in net formulas — do NOT deduct again) ──
  feesPaid: number;  // buyFees + sellFees (reported separately for transparency)
  taxes: number;     // sellTaxes + divTaxes (reported separately for transparency)

  // ── Equity-only metrics (stocks, no uninvested cash) ─────────────────────
  totalCurrentValue: number;  // Σ(currentPrice × unsoldShares), converted
  totalCostBasis: number;     // Σ(FIFO unrealised cost), converted

  // ── Dividend metrics ─────────────────────────────────────────────────────
  projectedAnnualDiv: number;
  divYieldPct: number | null;
  yieldOnCost: number | null;
  weightedDivGrowth5y: number | null;

  // ── Chart data ───────────────────────────────────────────────────────────
  holdingsCapGains: Array<{ symbol: string; capitalGainConverted: number }>;
  dividendByAsset: Array<{ symbol: string; amount: number }>;
  holdingFifoList: Array<{ symbol: string; unsoldShares: number; currentValueConverted: number }>;

  // ── XIRR inputs (terminal values already appended & sorted) ──────────────
  allXirrCFs: CashFlow[];
  holdingsXirrCFs: CashFlow[];
}

// ── Empty sentinel returned on error ─────────────────────────────────────────

const EMPTY_METRICS: PortfolioMetrics = {
  totalInvested: 0,
  totalProfit: 0,
  totalProfitPct: null,
  cashNet: 0,
  cashIncentive: 0,
  totalPortfolioValue: 0,
  currentValue: 0,
  feesPaid: 0,
  taxes: 0,
  totalCapGainSubtext: 0,
  totalRealizedSubtext: 0,
  totalDividendsSubtext: 0,
  totalCurrentValue: 0,
  totalCostBasis: 0,
  projectedAnnualDiv: 0,
  divYieldPct: null,
  yieldOnCost: null,
  weightedDivGrowth5y: null,
  holdingsCapGains: [],
  dividendByAsset: [],
  holdingFifoList: [],
  allXirrCFs: [],
  holdingsXirrCFs: [],
};

// ── Engine ────────────────────────────────────────────────────────────────────

/**
 * Compute unified portfolio metrics from raw transaction + price data.
 *
 * @param holdingEntries  One entry per stock/crypto/custom holding.
 * @param depositRecords  All DEPOSIT and WITHDRAWAL transactions (with their currency).
 * @param convertFn       Converts `amount` from `fromCurrency` → target currency.
 *                        Caller decides target: baseCurrency (single-pf) or displayCurrency (all-pf).
 * @param cashRecords     Optional CASH_GAIN / CASH_EXPENSE transactions (default: []).
 *                        cashNet = Σ cashGains − Σ cashExpenses.
 */
export function computePortfolioMetrics(
  holdingEntries: HoldingEntry[],
  depositRecords: DepositRecord[],
  convertFn: (amount: number, fromCurrency: string) => number,
  cashRecords: CashRecord[] = []
): PortfolioMetrics {
  try {
    let totalCapGainSubtext = 0;
    let totalRealizedSubtext = 0;
    let totalDividendsSubtext = 0;
    let totalCostBasis = 0;
    let totalCurrentValue = 0;
    let totalBuyInvested = 0; // fallback when no DEPOSIT records exist
    let projectedAnnualDiv = 0;
    let weightedDivGrowthNumer = 0;
    let weightedDivGrowthDenom = 0;
    let feesPaid = 0;
    let taxes = 0;

    const allXirrCFs: CashFlow[] = [];
    const holdingsXirrCFs: CashFlow[] = [];
    const holdingFifoList: PortfolioMetrics["holdingFifoList"] = [];
    const holdingsCapGains: PortfolioMetrics["holdingsCapGains"] = [];
    const divByAsset = new Map<string, number>();

    const oneYearAgo = Date.now() - 365 * 86_400_000;
    const today = new Date();

    for (const { symbol, currentPrice, currency, txs, precomputedCurrentValue, precomputedInvested } of holdingEntries) {
      try {
        const cvt = (v: number) => convertFn(v, currency);

        // ── FUNDS / BONDS fast path — bypass FIFO ─────────────────────────────
        if (precomputedCurrentValue !== undefined) {
          const cv  = precomputedCurrentValue;
          const inv = precomputedInvested ?? cv;
          totalCurrentValue += cvt(cv);
          totalCostBasis    += cvt(inv);
          totalBuyInvested  += cvt(inv);
          holdingFifoList.push({ symbol, unsoldShares: cv > 0 ? 1 : 0, currentValueConverted: cvt(cv) });
          holdingsCapGains.push({ symbol, capitalGainConverted: 0 });

          const divTypes = new Set(["DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION"]);
          const netDivs = txs.filter(tx => divTypes.has(tx.type))
            .reduce((s, tx) => {
              const gross = Math.abs(parseFloat(tx.amount ?? "0") || 0);
              const tax   = Math.abs(parseFloat(String(tx.taxAmount ?? "0")) || 0);
              return s + Math.max(0, gross - tax);
            }, 0);
          totalDividendsSubtext += cvt(netDivs);
          divByAsset.set(symbol, (divByAsset.get(symbol) ?? 0) + cvt(netDivs));

          const ttmDivs = txs.filter(tx => divTypes.has(tx.type) && new Date(tx.date).getTime() >= oneYearAgo)
            .reduce((s, tx) => s + Math.abs(parseFloat(tx.amount ?? "0") || 0), 0);
          projectedAnnualDiv += cvt(ttmDivs);

          if (cv > 0) {
            const rawCFs = buildXirrCashFlows(txs, 0, today);
            const cCFs = rawCFs.map(cf => ({ amount: cvt(cf.amount), date: cf.date }));
            allXirrCFs.push(...cCFs);
            holdingsXirrCFs.push(...cCFs);
          }
          continue;
        }

        const fifo = computeFIFO(txs);
        const unsoldShares = fifo.totalUnrealizedShares;
        const capGain = (currentPrice - fifo.avgCostPerShare) * unsoldShares;
        const currentValue = currentPrice * unsoldShares;

        // Net profit breakdown — fees & taxes already embedded (NOT double-counted)
        totalCapGainSubtext  += cvt(capGain - fifo.buyFees);
        totalRealizedSubtext += cvt(fifo.realizedPnL - fifo.sellFees - fifo.sellTaxes);
        totalDividendsSubtext += cvt(fifo.grossDividends - fifo.divTaxes);
        totalCostBasis        += cvt(fifo.totalUnrealizedCost);
        totalCurrentValue     += cvt(currentValue);
        totalBuyInvested      += cvt(fifo.totalInvested);

        // Reporting-only lines (already embedded above, shown for transparency)
        feesPaid += cvt(fifo.feesPaid);
        taxes    += cvt(fifo.taxesPaid);

        // Projected annual dividends — trailing-12-month actuals
        const ttmDivs = txs
          .filter(tx => tx.type === "DIVIDEND" && new Date(tx.date).getTime() >= oneYearAgo)
          .reduce((s, tx) => s + Math.abs(parseFloat(tx.amount ?? "0") || 0), 0);
        projectedAnnualDiv += cvt(ttmDivs);

        // Lifetime dividends by asset (for bar chart) — net of tax
        divByAsset.set(symbol, (divByAsset.get(symbol) ?? 0) + cvt(fifo.grossDividends - fifo.divTaxes));

        // Weighted dividend CAGR (value-weighted across holdings)
        try {
          const annualMap = new Map<number, number>();
          txs.filter(t => t.type === "DIVIDEND").forEach(t => {
            const yr = new Date(t.date + "T00:00:00").getFullYear();
            annualMap.set(yr, (annualMap.get(yr) ?? 0) + Math.abs(parseFloat(t.amount ?? "0") || 0));
          });
          const years = [...annualMap.keys()].sort((a, b) => a - b);
          if (years.length >= 2) {
            const diff = years[years.length - 1] - years[0];
            const latest = annualMap.get(years[years.length - 1]) ?? 0;
            const oldest = annualMap.get(years[0]) ?? 0;
            if (diff > 0 && oldest > 0) {
              const cagr = Math.pow(latest / oldest, 1 / diff) - 1;
              const w = cvt(currentValue);
              weightedDivGrowthNumer += cagr * w;
              weightedDivGrowthDenom += w;
            }
          }
        } catch { /* skip CAGR for this holding */ }

        // XIRR cash flows (terminal added after loop)
        const rawCFs = buildXirrCashFlows(txs, 0, today);
        const cCFs = rawCFs.map(cf => ({ amount: cvt(cf.amount), date: cf.date }));
        allXirrCFs.push(...cCFs);
        holdingFifoList.push({ symbol, unsoldShares, currentValueConverted: cvt(currentValue) });
        holdingsCapGains.push({ symbol, capitalGainConverted: cvt(capGain) });
        if (unsoldShares > 1e-6) holdingsXirrCFs.push(...cCFs);
      } catch { /* skip bad holding */ }
    }

    const totalProfit = totalCapGainSubtext + totalRealizedSubtext + totalDividendsSubtext;

    // ── Invested = Deposits − Withdrawals (authoritative formula) ─────────────
    // Falls back to FIFO BUY cost when the user has not recorded deposit transactions.
    let depositNet = 0;
    for (const rec of depositRecords) {
      const amt = Math.abs(parseFloat(String(rec.amount)) || 0);
      const converted = convertFn(amt, rec.currency);
      if (rec.type === "DEPOSIT")    depositNet += converted;
      else if (rec.type === "WITHDRAWAL") depositNet -= converted;
    }
    const totalInvested = depositNet > 0 ? depositNet : totalBuyInvested;
    const totalProfitPct = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : null;

    // ── Cash Net = cashGains − cashExpenses ───────────────────────────────────
    let cashNet = 0;
    for (const rec of cashRecords) {
      const amt = Math.abs(parseFloat(String(rec.amount)) || 0);
      const converted = convertFn(amt, rec.currency);
      if (rec.type === "CASH_GAIN")    cashNet += converted;
      else if (rec.type === "CASH_EXPENSE") cashNet -= converted;
    }

    // ── Total Portfolio Value (authoritative) ─────────────────────────────────
    const totalPortfolioValue = totalInvested + totalProfit + cashNet;

    // ── Dividend yield metrics ────────────────────────────────────────────────
    const divYieldPct    = totalCurrentValue > 0 ? (projectedAnnualDiv / totalCurrentValue) * 100 : null;
    const yieldOnCost    = totalCostBasis    > 0 ? (projectedAnnualDiv / totalCostBasis)    * 100 : null;
    const weightedDivGrowth5y = weightedDivGrowthDenom > 0
      ? (weightedDivGrowthNumer / weightedDivGrowthDenom) * 100
      : null;

    // ── Append XIRR terminal values, then sort chronologically ───────────────
    if (totalCurrentValue > 0) allXirrCFs.push({ amount: totalCurrentValue, date: today });
    const holdingsTerminal = holdingFifoList
      .filter(h => h.unsoldShares > 1e-6)
      .reduce((s, h) => s + h.currentValueConverted, 0);
    if (holdingsTerminal > 0) holdingsXirrCFs.push({ amount: holdingsTerminal, date: today });
    allXirrCFs.sort((a, b) => a.date.getTime() - b.date.getTime());
    holdingsXirrCFs.sort((a, b) => a.date.getTime() - b.date.getTime());

    const dividendByAsset = [...divByAsset.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([symbol, amount]) => ({ symbol, amount }));

    return {
      totalInvested,
      totalProfit,
      totalProfitPct,
      cashNet,
      cashIncentive: cashNet,
      totalPortfolioValue,
      currentValue: totalPortfolioValue,
      feesPaid,
      taxes,
      totalCapGainSubtext,
      totalRealizedSubtext,
      totalDividendsSubtext,
      totalCurrentValue,
      totalCostBasis,
      projectedAnnualDiv,
      divYieldPct,
      yieldOnCost,
      weightedDivGrowth5y,
      holdingsCapGains,
      dividendByAsset,
      holdingFifoList,
      allXirrCFs,
      holdingsXirrCFs,
    };
  } catch {
    return { ...EMPTY_METRICS };
  }
}

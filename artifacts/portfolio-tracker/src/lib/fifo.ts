/**
 * FIFO Cost Basis Engine
 * Single source of truth for Capital Gain, Realized P&L, Cost per Share,
 * and XIRR across all portfolio calculations.
 */

export interface FifoLot {
  date: string;
  qty: number;
  costPerShare: number;
}

export interface FifoResult {
  lots: FifoLot[];
  realizedPnL: number;
  totalUnrealizedCost: number;
  totalUnrealizedShares: number;
  avgCostPerShare: number;
  totalInvested: number;
  /** All fees (buy + sell) */
  feesPaid: number;
  /** All taxes (sell + dividend) */
  taxesPaid: number;
  /** Breakdown: fees from BUY transactions */
  buyFees: number;
  /** Breakdown: fees from SELL transactions */
  sellFees: number;
  /** Breakdown: taxes from SELL transactions */
  sellTaxes: number;
  /** Breakdown: taxes from DIVIDEND transactions */
  divTaxes: number;
  grossDividends: number;
}

/**
 * Compute FIFO cost basis from a list of transactions for a single holding.
 * BUY transactions push lots; SELL transactions consume from oldest lot first.
 * Cost per share = price (if available) or (gross amount) / qty.
 */
export function computeFIFO(transactions: any[]): FifoResult {
  const sorted = [...transactions].sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (ta !== tb) return ta - tb;
    return (a.id ?? 0) - (b.id ?? 0);
  });

  const lots: FifoLot[] = [];
  let realizedPnL = 0;
  let totalInvested = 0;
  let buyFees = 0;
  let sellFees = 0;
  let sellTaxes = 0;
  let divTaxes = 0;
  let grossDividends = 0;

  for (const tx of sorted) {
    try {
      const qty = Math.abs(parseFloat(tx.quantity ?? "0") || 0);
      const price = parseFloat(tx.price ?? "0") || 0;
      const amount = parseFloat(tx.amount ?? "0") || 0;
      const fee = Math.abs(parseFloat(tx.feeAmount ?? "0") || 0);
      const tax = Math.abs(parseFloat(tx.taxAmount ?? "0") || 0);

      if (tx.type === "BUY") {
        const grossBuy =
          price > 0 && qty > 0 ? price * qty : Math.max(0, amount - fee - tax);
        const lotCostPerShare = qty > 0 ? grossBuy / qty : 0;
        if (qty > 1e-8) {
          lots.push({ date: tx.date, qty, costPerShare: lotCostPerShare });
        }
        totalInvested += grossBuy;
        buyFees += fee;
      } else if (tx.type === "SELL") {
        const sellPrice =
          price > 0 ? price : qty > 0 ? amount / qty : 0;
        const grossProceeds = qty * sellPrice;
        let sellQty = qty;
        let fifoCost = 0;

        while (sellQty > 1e-8 && lots.length > 0) {
          const lot = lots[0];
          const consumed = Math.min(lot.qty, sellQty);
          fifoCost += consumed * lot.costPerShare;
          lot.qty -= consumed;
          sellQty -= consumed;
          if (lot.qty < 1e-8) lots.shift();
        }

        realizedPnL += grossProceeds - fifoCost;
        sellFees += fee;
        sellTaxes += tax;
      } else if (tx.type === "DIVIDEND") {
        grossDividends += Math.abs(amount);
        divTaxes += tax;
      }
    } catch {
      // Skip malformed transactions
    }
  }

  const cleanLots = lots.filter((l) => l.qty > 1e-8);
  const totalUnrealizedCost = cleanLots.reduce(
    (s, l) => s + l.qty * l.costPerShare,
    0
  );
  const totalUnrealizedShares = cleanLots.reduce((s, l) => s + l.qty, 0);
  const avgCostPerShare =
    totalUnrealizedShares > 0 ? totalUnrealizedCost / totalUnrealizedShares : 0;

  return {
    lots: cleanLots,
    realizedPnL,
    totalUnrealizedCost,
    totalUnrealizedShares,
    avgCostPerShare,
    totalInvested,
    buyFees,
    sellFees,
    sellTaxes,
    divTaxes,
    feesPaid: buyFees + sellFees,
    taxesPaid: sellTaxes + divTaxes,
    grossDividends,
  };
}

export interface CashFlow {
  amount: number;
  date: Date;
}

/**
 * Solve for XIRR (irregular cash flow IRR) using Newton-Raphson.
 * Returns the annualized rate or null if it cannot converge.
 *
 * Convention:
 *   BUY  → negative cash flow  (money out)
 *   SELL → positive cash flow  (money in)
 *   DIVIDEND → positive cash flow (money in)
 *   Terminal value (current holdings value) → positive cash flow dated today
 */
export function computeXIRR(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;
  const hasNeg = cashFlows.some((cf) => cf.amount < 0);
  const hasPos = cashFlows.some((cf) => cf.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = cashFlows[0].date.getTime();
  const days = cashFlows.map((cf) => (cf.date.getTime() - t0) / 86_400_000);
  const amounts = cashFlows.map((cf) => cf.amount);

  function npv(rate: number): number {
    return amounts.reduce(
      (s, a, i) => s + a / Math.pow(1 + rate, days[i] / 365),
      0
    );
  }

  function npvDeriv(rate: number): number {
    return amounts.reduce((s, a, i) => {
      const exp = days[i] / 365;
      return s - (exp * a) / Math.pow(1 + rate, exp + 1);
    }, 0);
  }

  const guesses = [0.1, 0.5, -0.05, 1.0, 0.0];
  for (const guess of guesses) {
    let rate = guess;
    for (let iter = 0; iter < 300; iter++) {
      const f = npv(rate);
      const df = npvDeriv(rate);
      if (!isFinite(f) || !isFinite(df) || Math.abs(df) < 1e-14) break;
      const delta = f / df;
      rate -= delta;
      if (rate <= -0.9999) rate = -0.9999;
      if (Math.abs(delta) < 1e-8) {
        if (Math.abs(npv(rate)) < 1.0) return rate;
        break;
      }
    }
  }

  return null;
}

/** Build XIRR cash flows from transaction list. terminalValue in same currency. */
export function buildXirrCashFlows(
  transactions: any[],
  terminalValue: number,
  today: Date
): CashFlow[] {
  const cfs: CashFlow[] = [];
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  for (const t of sorted) {
    try {
      const qty = Math.abs(parseFloat(t.quantity ?? "0") || 0);
      const p = parseFloat(t.price ?? "0") || 0;
      const amt = parseFloat(t.amount ?? "0") || 0;
      const fee = Math.abs(parseFloat(t.feeAmount ?? "0") || 0);
      const tax = Math.abs(parseFloat(t.taxAmount ?? "0") || 0);
      const date = new Date(t.date);
      if (t.type === "BUY") {
        const gross = p > 0 && qty > 0 ? p * qty : Math.max(0, amt - fee - tax);
        if (gross + fee > 0) cfs.push({ amount: -(gross + fee), date });
      } else if (t.type === "SELL") {
        const gross = p > 0 && qty > 0 ? p * qty : amt;
        const net = gross - fee - tax;
        if (net !== 0) cfs.push({ amount: net, date });
      } else if (t.type === "DIVIDEND") {
        const net = amt - tax;
        if (net > 0) cfs.push({ amount: net, date });
      }
    } catch {
      // skip
    }
  }
  if (terminalValue > 0) cfs.push({ amount: terminalValue, date: today });
  return cfs;
}

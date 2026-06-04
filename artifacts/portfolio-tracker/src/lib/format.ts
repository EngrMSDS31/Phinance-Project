export function formatCurrency(amount: number, currency: string = "USD"): string {
  if (amount === undefined || amount === null) return "---";
  
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(value: number): string {
  if (value === undefined || value === null) return "---";
  
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero"
  }).format(value / 100);
}

export function formatNumber(value: number, decimals: number = 2): string {
  if (value === undefined || value === null) return "---";
  
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function cnValue(value: number): string {
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-muted-foreground";
}

// Compute net transaction amount from first principles (qty × price ± fees).
// BUY: total cost = gross + fee + tax
// SELL/DIVIDEND: net proceeds = amount - fee - tax
// Falls back to stored `amount` field for types without qty/price.
export function getNetAmount(t: {
  type: string;
  quantity?: number | string | null;
  price?: number | string | null;
  amount?: number | string | null;
  feeAmount?: number | string | null;
  taxAmount?: number | string | null;
}): number {
  const qty = parseFloat(String(t.quantity ?? "0")) || 0;
  const px  = parseFloat(String(t.price ?? "0")) || 0;
  const fee = parseFloat(String(t.feeAmount ?? "0")) || 0;
  const tax = parseFloat(String(t.taxAmount ?? "0")) || 0;
  const amt = parseFloat(String(t.amount ?? "0")) || 0;
  if (t.type === "BUY") {
    const gross = qty > 0 && px > 0 ? qty * px : Math.max(0, amt - fee - tax);
    return gross + fee + tax;
  }
  if (t.type === "SELL" || t.type === "DIVIDEND") {
    return amt - fee - tax;
  }
  return amt;
}

export function getMarketColor(market: string): string {
  switch (market) {
    case 'PSE': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    case 'LSE': return 'bg-red-500/10 text-red-500 border-red-500/20';
    case 'US': return 'bg-green-500/10 text-green-500 border-green-500/20';
    case 'CRYPTO': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    case 'CUSTOM': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
    case 'BONDS': return 'bg-teal-500/10 text-teal-500 border-teal-500/20';
    case 'FUNDS': return 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20';
    case 'MIXED': return 'bg-slate-500/10 text-slate-500 border-slate-500/20';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

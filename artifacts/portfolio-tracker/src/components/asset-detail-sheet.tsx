import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { StockLogo } from "@/components/stock-logo";
import { format } from "date-fns";
import { formatCurrency, formatPercent, formatNumber, cnValue } from "@/lib/format";

import { computeFIFO, computeXIRR, type CashFlow } from "@/lib/fifo";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type Period = "7D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "All";
type Tab = "overview" | "dividends" | "in-portfolio";

const PERIODS: Period[] = ["7D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "All"];

function getPeriod1(period: Period): string {
  const now = new Date();
  switch (period) {
    case "7D":  return new Date(now.getTime() - 7   * 86400000).toISOString().split("T")[0];
    case "1M":  return new Date(now.getTime() - 30  * 86400000).toISOString().split("T")[0];
    case "3M":  return new Date(now.getTime() - 90  * 86400000).toISOString().split("T")[0];
    case "6M":  return new Date(now.getTime() - 180 * 86400000).toISOString().split("T")[0];
    case "YTD": return `${now.getFullYear()}-01-01`;
    case "1Y":  return new Date(now.getTime() - 365 * 86400000).toISOString().split("T")[0];
    case "5Y":  return new Date(now.getTime() - 5 * 365 * 86400000).toISOString().split("T")[0];
    case "All": return new Date(now.getTime() - 10 * 365 * 86400000).toISOString().split("T")[0];
  }
}

function getInterval(period: Period): string {
  if (period === "5Y" || period === "All") return "1wk";
  return "1d";
}

function Row({ label, value, mono = false, valueClass = "" }: {
  label: string; value: React.ReactNode; mono?: boolean; valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm font-medium text-right ml-4 ${mono ? "font-mono" : ""} ${valueClass}`}>{value}</span>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-5 mb-1 pt-1">{title}</p>;
}

function na(v: React.ReactNode) {
  return v != null && v !== "" ? v : "N/A";
}

function fmtPct(v: number | null | undefined, dp = 2) {
  if (v == null) return "N/A";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

function colorPct(v: number | null | undefined) {
  if (v == null) return <span>N/A</span>;
  return <span className={v >= 0 ? "text-gain" : "text-loss"}>{fmtPct(v)}</span>;
}

export function AssetDetailSheet({
  holding,
  baseCurrency,
  allTransactions,
  portfolioTotalValue,
  onClose,
}: {
  holding: any;
  baseCurrency: string;
  allTransactions: any[];
  portfolioTotalValue: number;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("in-portfolio");
  const [chartPeriod, setChartPeriod] = useState<Period>("1Y");

  const currency = baseCurrency;
  const holdingTxs = allTransactions.filter((t: any) => t.holdingId === holding.id);

  const { data: chartData, isLoading: loadingChart } = useQuery({
    queryKey: ["asset-chart", holding.symbol, holding.market, chartPeriod],
    queryFn: async () => {
      const p1 = getPeriod1(chartPeriod);
      const iv = getInterval(chartPeriod);
      const r = await fetch(
        `${BASE_URL}/api/prices/chart?symbol=${holding.symbol}&market=${holding.market}&period1=${p1}&interval=${iv}`,
        { credentials: "include" }
      );
      if (!r.ok) return { quotes: [] };
      return r.json();
    },
    enabled: activeTab === "overview",
    staleTime: 10 * 60 * 1000,
  });

  const { data: qd, isLoading: loadingQd } = useQuery({
    queryKey: ["asset-qd", holding.symbol, holding.market],
    queryFn: async () => {
      const r = await fetch(
        `${BASE_URL}/api/prices/quote-detail?symbol=${holding.symbol}&market=${holding.market}`,
        { credentials: "include" }
      );
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  const { data: divInfo, isLoading: loadingDiv } = useQuery({
    queryKey: ["asset-div", holding.symbol, holding.market],
    queryFn: async () => {
      const r = await fetch(
        `${BASE_URL}/api/prices/dividend-info?symbol=${holding.symbol}&market=${holding.market}`,
        { credentials: "include" }
      );
      if (!r.ok) return { history: [] };
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  // ── FIFO Engine (single source of truth for all cost/gain/fee values) ─────────
  const fifo = useMemo(() => computeFIFO(holdingTxs), [holdingTxs]);

  const currentPrice     = holding.currentPrice ?? 0;
  const unsoldShares     = fifo.totalUnrealizedShares;

  // XIRR — must be a hook call at component top level
  const irrValue = useMemo((): number | null => {
    try {
      const cfs: CashFlow[] = [];
      const today = new Date();
      const sorted = [...holdingTxs].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      for (const t of sorted) {
        const qty  = Math.abs(parseFloat(t.quantity ?? "0") || 0);
        const p    = parseFloat(t.price ?? "0") || 0;
        const amt  = parseFloat(t.amount ?? "0") || 0;
        const fee  = Math.abs(parseFloat(t.feeAmount ?? "0") || 0);
        const tax  = Math.abs(parseFloat(t.taxAmount ?? "0") || 0);
        const date = new Date(t.date);
        if (t.type === "BUY") {
          const gross = p > 0 && qty > 0 ? p * qty : Math.max(0, amt - fee - tax);
          cfs.push({ amount: -(gross + fee), date });
        } else if (t.type === "SELL") {
          const gross = p > 0 && qty > 0 ? p * qty : amt;
          cfs.push({ amount: gross - fee - tax, date });
        } else if (t.type === "DIVIDEND") {
          const net = amt - tax;
          if (net > 0) cfs.push({ amount: net, date });
        }
      }
      const terminalValue = currentPrice * unsoldShares;
      if (terminalValue > 0) cfs.push({ amount: terminalValue, date: today });
      if (cfs.length < 2) return null;
      const holdingDays =
        (today.getTime() - cfs[0].date.getTime()) / 86_400_000;
      if (holdingDays < 30) return null;
      return computeXIRR(cfs);
    } catch {
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingTxs, currentPrice, unsoldShares]);

  // Derived values from FIFO
  const capitalGain      = (currentPrice - fifo.avgCostPerShare) * unsoldShares;
  const costBasis        = fifo.avgCostPerShare * unsoldShares;
  const shareInPortfolio =
    portfolioTotalValue > 0
      ? (currentPrice * unsoldShares / portfolioTotalValue) * 100
      : 0;
  const totalProfit =
    capitalGain + fifo.realizedPnL + fifo.grossDividends -
    fifo.taxesPaid - fifo.feesPaid;
  const totalProfitPct =
    fifo.totalInvested > 0 ? (totalProfit / fifo.totalInvested) * 100 : null;

  const dailyChange    = holding.priceChange ?? null;
  const dailyChangePct = holding.priceChangePct ?? null;
  const dailyValue     = dailyChange != null ? dailyChange * unsoldShares : null;

  const divHistory   = (divInfo?.history ?? []) as Array<{ date: string; amount: number }>;
  const dividendRate = qd?.dividendRate ?? divInfo?.dividendRate ?? null;
  const divYield     = qd?.dividendYield ?? divInfo?.dividendYield ?? null;
  const exDivDate    = qd?.exDividendDate ?? divInfo?.exDividendDate ?? null;
  const payoutRatio  = qd?.payoutRatio ?? null;

  // CAGR 5Y from aggregated annual payout history (proper CAGR, not simple %)
  let divGrowth5y: number | null = null;
  try {
    if (divHistory.length >= 2) {
      const annualMap = new Map<number, number>();
      for (const d of divHistory) {
        const yr = new Date(d.date + "T00:00:00").getFullYear();
        annualMap.set(yr, (annualMap.get(yr) ?? 0) + d.amount);
      }
      const years = [...annualMap.keys()].sort((a, b) => a - b);
      if (years.length >= 2) {
        const latestAmt = annualMap.get(years[years.length - 1]) ?? 0;
        const oldestAmt = annualMap.get(years[0]) ?? 0;
        const diff = years[years.length - 1] - years[0];
        if (diff > 0 && oldestAmt > 0) {
          divGrowth5y = (Math.pow(latestAmt / oldestAmt, 1 / diff) - 1) * 100;
        }
      }
    }
  } catch { /* ignore */ }

  // Projected Incomes (forward-looking, based on current unsold shares)
  const yieldOnCost =
    fifo.avgCostPerShare > 0 && dividendRate
      ? (dividendRate / fifo.avgCostPerShare) * 100
      : null;
  const projectedAnnualDiv =
    dividendRate != null && unsoldShares > 0
      ? dividendRate * unsoldShares
      : null;
  const nextPaymentEst =
    dividendRate != null && unsoldShares > 0
      ? (dividendRate / 4) * unsoldShares // assumes quarterly
      : null;

  const priceChange    = holding.priceChange ?? null;
  const priceChangePct = holding.priceChangePct ?? null;

  const chartQuotes: any[] = chartData?.quotes ?? [];

  const chartMin = chartQuotes.length > 0 ? Math.min(...chartQuotes.map((q: any) => q.close)) * 0.998 : "auto";
  const chartMax = chartQuotes.length > 0 ? Math.max(...chartQuotes.map((q: any) => q.close)) * 1.002 : "auto";
  const chartColor = chartQuotes.length >= 2
    ? (chartQuotes[chartQuotes.length - 1].close >= chartQuotes[0].close ? "#22c55e" : "#ef4444")
    : "#3b82f6";

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview",      label: "Overview"     },
    { key: "dividends",     label: "Dividends"    },
    { key: "in-portfolio",  label: "In Portfolio" },
  ];

  const txTypeBadge = (type: string) => {
    if (type === "BUY")      return "border-blue-500  text-blue-400";
    if (type === "SELL")     return "border-red-500   text-red-400";
    if (type === "DIVIDEND") return "border-green-500 text-green-400";
    return "border-border text-muted-foreground";
  };

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="h-[96svh] flex flex-col rounded-t-2xl overflow-hidden p-0">
        <div className="flex justify-center pt-3 pb-0 shrink-0">
          <div className="w-10 h-1 rounded-full bg-border/50" />
        </div>

        {/* Header */}
        <div className="px-4 pt-2 pb-3 shrink-0 border-b border-border/30">
          <div className="flex items-center gap-3 mb-2">
            <StockLogo symbol={holding.symbol} size={40} />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-base leading-tight truncate">{holding.name || holding.symbol}</div>
              <div className="text-xs text-muted-foreground">{holding.symbol} • {holding.market}</div>
            </div>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-bold font-mono">
              {formatCurrency(holding.currentPrice ?? 0, currency)}
            </span>
            {priceChange != null && (
              <span className={`text-xs font-mono ${priceChange >= 0 ? "text-gain" : "text-loss"}`}>
                {priceChange >= 0 ? "+" : ""}{formatCurrency(Math.abs(priceChange), currency)}
                {priceChangePct != null ? ` (${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(2)}%)` : ""}
              </span>
            )}
          </div>
        </div>

        {/* Pill Tabs */}
        <div className="px-4 py-2.5 shrink-0">
          <div className="flex gap-1 p-1 rounded-full bg-muted/40 border border-border/30 w-fit">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all ${
                  activeTab === tab.key
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-8">

          {/* ── OVERVIEW ─────────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <div>
              {/* Chart */}
              <div className="h-[180px] mb-2">
                {loadingChart ? (
                  <Skeleton className="w-full h-full rounded-lg" />
                ) : chartQuotes.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm border border-border/30 rounded-lg">
                    Chart unavailable
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartQuotes} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v: string) => {
                          try {
                            const d = new Date(v + "T00:00:00");
                            if (chartPeriod === "7D" || chartPeriod === "1M") return format(d, "MMM d");
                            if (chartPeriod === "5Y" || chartPeriod === "All") return format(d, "yyyy");
                            return format(d, "MMM yy");
                          } catch { return v; }
                        }}
                        tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                      />
                      <YAxis
                        domain={[chartMin, chartMax]}
                        tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                        tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(2)}
                      />
                      <Tooltip
                        formatter={(v: number) => [formatCurrency(v, currency), "Close"]}
                        labelFormatter={(l: string) => {
                          try { return format(new Date(l + "T00:00:00"), "MMM d, yyyy"); } catch { return l; }
                        }}
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Line type="monotone" dataKey="close" stroke={chartColor} strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Period selectors */}
              <div className="flex gap-1 mb-4">
                {PERIODS.map(p => (
                  <button
                    key={p}
                    onClick={() => setChartPeriod(p)}
                    className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
                      chartPeriod === p
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {loadingQd ? (
                <div className="space-y-2">{[1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-9" />)}</div>
              ) : (
                <>
                  <Section title="Estimate" />
                  <Row label="Beta" value={na(qd?.beta != null ? qd.beta.toFixed(2) : null)} />

                  <Section title="Dividends" />
                  <Row label="Dividend Yield"       value={na(divYield != null ? `${divYield.toFixed(2)}%` : null)} />
                  <Row label="Annual Payout"         value={na(dividendRate != null ? formatCurrency(dividendRate, currency) : null)} />
                  <Row label="Next Ex-Dividend Date" value={na(exDivDate ? format(new Date(exDivDate + "T00:00:00"), "MMM d, yyyy") : null)} />
                  <Row label="Payout (%)"            value={na(payoutRatio != null ? `${(payoutRatio * 100).toFixed(1)}%` : null)} />
                  <Row label="Dividend Growth, 5Y"   value={divGrowth5y != null ? colorPct(divGrowth5y) : "N/A"} />

                  <Section title="About the Company" />
                  <Row label="Ticker"      value={holding.symbol} />
                  <Row label="Country"     value={na(qd?.country)} />
                  <Row label="Sector (GICS)" value={na(qd?.sector)} />
                  <Row label="Class"       value={holding.assetType ?? "N/A"} />
                </>
              )}
            </div>
          )}

          {/* ── DIVIDENDS ─────────────────────────────────────────────── */}
          {activeTab === "dividends" && (
            <div>
              {(loadingQd || loadingDiv) ? (
                <div className="space-y-2">{[1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-9" />)}</div>
              ) : (
                <>
                  <Section title="Summary" />
                  <Row label="Dividend Yield"       value={na(divYield != null ? `${divYield.toFixed(2)}%` : null)} />
                  <Row label="Annual Payout"         value={na(dividendRate != null ? formatCurrency(dividendRate, currency) : null)} />
                  <Row label="Next Ex-Dividend Date" value={na(exDivDate ? format(new Date(exDivDate + "T00:00:00"), "MMM d, yyyy") : null)} />
                  <Row label="Frequency"             value={divHistory.length >= 4 ? "Quarterly" : divHistory.length >= 2 ? "Semi-Annual" : divHistory.length >= 1 ? "Annual" : "N/A"} />
                  <Row label="Payout (%)"            value={na(payoutRatio != null ? `${(payoutRatio * 100).toFixed(1)}%` : null)} />

                  <Section title="Growth" />
                  {(() => {
                    const msYr   = 365 * 86400000;
                    const yr1 = divHistory.filter((d) => new Date(d.date).getTime() >= Date.now() - msYr);
                    const yr2 = divHistory.filter((d) => {
                      const t = new Date(d.date).getTime();
                      return t < Date.now() - msYr && t >= Date.now() - 2 * msYr;
                    });
                    const g1tot = yr1.reduce((s, d) => s + d.amount, 0);
                    const g2tot = yr2.reduce((s, d) => s + d.amount, 0);
                    const g1 = g2tot > 0 ? ((g1tot - g2tot) / g2tot) * 100 : null;
                    return (
                      <>
                        <Row label="1 Year"  value={g1 != null ? colorPct(g1) : "N/A"} />
                        <Row label="5 Years" value={divGrowth5y != null ? colorPct(divGrowth5y) : "N/A"} />
                      </>
                    );
                  })()}
                  {divHistory.length > 0 && (
                    <Row label="Dividend Streak" value={`${divHistory.length} payment(s)`} />
                  )}

                  {divHistory.length > 0 && (
                    <>
                      <Section title="Payout History" />
                      <div className="rounded-lg border border-border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs py-2 px-3">Ex-Date</TableHead>
                              <TableHead className="text-right text-xs py-2 px-3">Per Share</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {divHistory.map((d, i) => (
                              <TableRow key={i} className="hover:bg-muted/20">
                                <TableCell className="text-xs py-2 px-3">
                                  {format(new Date(d.date + "T00:00:00"), "MMM d, yyyy")}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs py-2 px-3 text-gain">
                                  {formatCurrency(d.amount, currency)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── IN PORTFOLIO ──────────────────────────────────────────── */}
          {activeTab === "in-portfolio" && (
            <div>
              <div className="mb-4 pt-1">
                <div className="text-xs text-muted-foreground mb-0.5">Current Value</div>
                <div className="text-3xl font-bold font-mono">
                  {formatCurrency(holding.currentValue ?? 0, currency)}
                </div>
              </div>

              <Section title="General" />
              <Row label="Shares"            value={formatNumber(unsoldShares, 4)} mono />
              <Row label="Cost Basis"        value={unsoldShares > 0 ? formatCurrency(costBasis, currency) : "N/A"} mono />
              <Row label="Cost per Share"    value={unsoldShares > 0 ? formatCurrency(fifo.avgCostPerShare, currency) : "N/A"} mono />
              <Row label="Share Price"       value={formatCurrency(currentPrice, currency)} mono />
              <Row label="Share in Portfolio" value={`${shareInPortfolio.toFixed(2)}%`} mono />

              <Section title="Returns" />
              <Row
                label="Total Profit"
                value={
                  <span className={cnValue(totalProfit)}>
                    {formatCurrency(totalProfit, currency)}
                    {totalProfitPct != null
                      ? ` (${totalProfitPct >= 0 ? "+" : ""}${totalProfitPct.toFixed(2)}%)`
                      : ""}
                  </span>
                }
              />
              {dailyValue != null && (
                <Row
                  label="Daily"
                  value={
                    <span className={cnValue(dailyValue)}>
                      {formatCurrency(dailyValue, currency)}
                      {dailyChangePct != null ? ` (${dailyChangePct >= 0 ? "+" : ""}${dailyChangePct.toFixed(2)}%)` : ""}
                    </span>
                  }
                />
              )}
              <Row
                label="Capital Gain"
                value={<span className={cnValue(capitalGain)}>{formatCurrency(capitalGain, currency)}</span>}
              />
              {fifo.realizedPnL !== 0 && (
                <Row
                  label="Realized P&L"
                  value={<span className={cnValue(fifo.realizedPnL)}>{formatCurrency(fifo.realizedPnL, currency)}</span>}
                />
              )}
              <Row
                label="Dividends Received"
                value={<span className="text-gain">{formatCurrency(fifo.grossDividends, currency)}</span>}
              />
              {fifo.taxesPaid > 0 && (
                <Row
                  label="Taxes"
                  value={<span className="text-loss">-{formatCurrency(fifo.taxesPaid, currency)}</span>}
                />
              )}
              {fifo.feesPaid > 0 && (
                <Row
                  label="Fees Paid"
                  value={<span className="text-loss">-{formatCurrency(fifo.feesPaid, currency)}</span>}
                />
              )}
              <Row
                label="IRR"
                value={
                  irrValue != null
                    ? <span className={cnValue(irrValue)}>{(irrValue * 100).toFixed(2)}%</span>
                    : "N/A"
                }
              />

              <Section title="Incomes" />
              <Row
                label="Dividends (Annual, Est.)"
                value={
                  projectedAnnualDiv != null
                    ? <span className="text-gain">{formatCurrency(projectedAnnualDiv, currency)}</span>
                    : "N/A"
                }
              />
              <Row label="Dividends per Share"    value={na(dividendRate != null ? formatCurrency(dividendRate, currency) : null)} mono />
              <Row label="Dividend Yield"         value={na(divYield != null ? `${divYield.toFixed(2)}%` : null)} />
              <Row label="Dividend Yield on Cost" value={na(yieldOnCost != null ? `${yieldOnCost.toFixed(2)}%` : null)} />
              <Row label="Dividend Growth (5Y)"   value={divGrowth5y != null ? colorPct(divGrowth5y) : "N/A"} />
              <Row label="Date of Next Payment"   value={na(exDivDate ? format(new Date(exDivDate + "T00:00:00"), "MMM d, yyyy") : null)} />
              <Row
                label="Next Payment (Est.)"
                value={na(nextPaymentEst != null ? formatCurrency(nextPaymentEst, currency) : null)}
                mono
              />

              <Section title="Transactions" />
              {holdingTxs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No transactions for this holding.</p>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] py-2 px-2">Date</TableHead>
                        <TableHead className="text-[10px] py-2 px-2">Type</TableHead>
                        <TableHead className="text-right text-[10px] py-2 px-2">Qty</TableHead>
                        <TableHead className="text-right text-[10px] py-2 px-2">Price</TableHead>
                        <TableHead className="text-right text-[10px] py-2 px-2">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...holdingTxs]
                        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                        .map((t: any) => (
                          <TableRow key={t.id} className="hover:bg-muted/20">
                            <TableCell className="text-[10px] py-2 px-2 whitespace-nowrap">
                              {format(new Date(t.date), "MM/dd/yy")}
                            </TableCell>
                            <TableCell className="py-2 px-1.5">
                              <Badge variant="outline" className={`text-[9px] px-1 py-0 ${txTypeBadge(t.type)}`}>
                                {t.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-[10px] py-2 px-2">
                              {t.quantity != null ? formatNumber(t.quantity, 2) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-[10px] py-2 px-2">
                              {t.price != null ? formatCurrency(t.price, currency) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-[10px] py-2 px-2 font-medium">
                              {formatCurrency(t.amount - (t.feeAmount ?? 0) - (t.taxAmount ?? 0), currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

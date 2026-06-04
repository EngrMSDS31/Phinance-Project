import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useGetPortfolioSummary,
  getGetPortfolioSummaryQueryKey,
  useGetPortfolioPerformance,
  useGetDashboardSummary,
  useListPortfolios,
  useListHoldings,
  useListTransactions,
  getListHoldingsQueryKey,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react";

import { computeXIRR } from "@/lib/fifo";
import { computePortfolioMetrics } from "@/lib/portfolioEngine";
import { cnValue, formatCurrency } from "@/lib/format";
import { useFx } from "@/lib/fx-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, LabelList,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Period = "1M" | "3M" | "6M" | "1Y" | "ALL";
const PERIODS: Period[] = ["1M", "3M", "6M", "1Y", "ALL"];

const PIE_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
  "#6366f1", "#a855f7", "#eab308", "#22c55e", "#f43f5e",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CURRENT_YEAR = new Date().getFullYear();
const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

function niceYAxisTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

function fmtPct(v: number, decimals = 1): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function na(v: string | null | undefined): string {
  return v ?? "N/A";
}

// Custom tooltip for Unrealized P&L chart — colors the label dynamically
function PnlTooltip({ active, payload, fmt }: { active?: boolean; payload?: any[]; fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const gain: number = payload[0]?.value ?? 0;
  const color = gain >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)";
  return (
    <div style={{
      background: "hsl(var(--popover))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 6,
      color: "hsl(var(--foreground))",
      fontSize: 12,
      padding: "8px 12px",
    }}>
      <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, marginBottom: 2 }}>
        {payload[0]?.payload?.symbol}
      </div>
      <div>
        <span style={{ color }}>Unrealized P&L: </span>
        <span style={{ color, fontFamily: "monospace" }}>{fmt(gain)}</span>
      </div>
    </div>
  );
}

// Subtext row for metric cards
function SubRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between text-[10px] font-mono gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span style={color ? { color } : undefined} className={color ? undefined : "text-foreground"}>
        {value}
      </span>
    </div>
  );
}

export default function Analytics() {
  const { fxFormat, displayCurrency, convert, fetchedAt } = useFx();
  const { data: portfolios } = useListPortfolios();
  const [period, setPeriod] = useState<Period>("1Y");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(() => {
    try {
      const s = sessionStorage.getItem("folio_analytics_pf");
      return s && s !== "all" ? Number(s) : null;
    } catch { return null; }
  });
  const [activeAllocIdx, setActiveAllocIdx] = useState<number | null>(null);
  const [divView, setDivView] = useState<"yearly" | "monthly" | "asset">("monthly");
  const [divYear, setDivYear] = useState(CURRENT_YEAR);
  const [activeHoldingsIdx, setActiveHoldingsIdx] = useState<number | null>(null);
  const [activePnlIdx, setActivePnlIdx] = useState<number | null>(null);
  const [activeDivIdx, setActiveDivIdx] = useState<number | null>(null);
  const holdBarRef = useRef(false);
  const pnlBarRef = useRef(false);
  const divBarRef = useRef(false);

  useEffect(() => { setActiveDivIdx(null); }, [divView]);

  useEffect(() => {
    try { sessionStorage.setItem("folio_analytics_pf", selectedPortfolioId === null ? "all" : String(selectedPortfolioId)); }
    catch { /* ignore */ }
  }, [selectedPortfolioId]);

  const firstPortfolioId = portfolios?.[0]?.id ?? 0;
  const perfPortfolioId = selectedPortfolioId ?? firstPortfolioId;
  const isAllPortfolios = selectedPortfolioId === null;
  const allPortfolioIds = useMemo(() => portfolios?.map(p => p.id) ?? [], [portfolios]);

  // ── All-portfolios aggregation queries ──
  const allHoldingsQueries = useQueries({
    queries: (isAllPortfolios && allPortfolioIds.length > 0 ? allPortfolioIds : []).map(id => ({
      queryKey: ["analytics-all-holdings", id],
      queryFn: async () => {
        const r = await fetch(`${BASE_URL}/api/portfolios/${id}/holdings`, { credentials: "include" });
        if (!r.ok) return [];
        return r.json();
      },
      staleTime: 5 * 60 * 1000,
    })),
  });

  const allTxQueries = useQueries({
    queries: (isAllPortfolios && allPortfolioIds.length > 0 ? allPortfolioIds : []).map(id => ({
      queryKey: ["analytics-all-tx", id],
      queryFn: async () => {
        const r = await fetch(`${BASE_URL}/api/portfolios/${id}/transactions?limit=1000`, { credentials: "include" });
        if (!r.ok) return { items: [] };
        return r.json();
      },
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Performance queries for all portfolios
  const allPerfQueries = useQueries({
    queries: (isAllPortfolios && allPortfolioIds.length > 0 ? allPortfolioIds : []).map(id => ({
      queryKey: ["analytics-perf", id, period],
      queryFn: async () => {
        const r = await fetch(`${BASE_URL}/api/portfolios/${id}/performance?period=${period}`, { credentials: "include" });
        if (!r.ok) return [];
        return r.json();
      },
      staleTime: 5 * 60 * 1000,
    })),
  });

  const { data: dashSummary, isLoading: loadingDash } = useGetDashboardSummary(
    { targetCurrency: displayCurrency },
    { query: { queryKey: ["analytics-dash-summary", displayCurrency] } }
  );

  const { data: portfolioSummary, isLoading: loadingSummary } = useGetPortfolioSummary(
    perfPortfolioId,
    { query: { enabled: !isAllPortfolios && perfPortfolioId > 0, queryKey: getGetPortfolioSummaryQueryKey(perfPortfolioId) } }
  );

  const selectedPortfolio = portfolios?.find(p => p.id === perfPortfolioId);
  const baseCurrency = selectedPortfolio?.baseCurrency ?? "USD";
  const fmt = useCallback((v: number) =>
    isAllPortfolios ? fxFormat(v, displayCurrency) : formatCurrency(v, baseCurrency),
    [isAllPortfolios, fxFormat, displayCurrency, baseCurrency]
  );

  const { data: singlePerformance, isLoading: loadingSinglePerf } = useGetPortfolioPerformance(
    perfPortfolioId,
    { period },
    { query: { enabled: !isAllPortfolios && perfPortfolioId > 0, queryKey: ["analytics-performance", perfPortfolioId, period] } }
  );

  const { data: holdings } = useListHoldings(perfPortfolioId, {
    query: { enabled: !isAllPortfolios && perfPortfolioId > 0, queryKey: getListHoldingsQueryKey(perfPortfolioId) },
  });

  const { data: transactions } = useListTransactions(
    perfPortfolioId,
    { limit: 1000 },
    { query: { enabled: !isAllPortfolios && perfPortfolioId > 0, queryKey: getListTransactionsQueryKey(perfPortfolioId) } }
  );

  // Aggregated data — _pfCurrency tag enables per-holding FX conversion in all-portfolios mode
  const activeHoldings: any[] = useMemo(() => {
    if (!isAllPortfolios) return (holdings ?? []);
    return allHoldingsQueries.flatMap((r, i) => {
      const pfCurrency = portfolios?.[i]?.baseCurrency ?? "USD";
      return Array.isArray(r.data) ? (r.data as any[]).map((h: any) => ({ ...h, _pfCurrency: pfCurrency })) : [];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllPortfolios, allHoldingsQueries, holdings, portfolios]);

  const activeTransactionItems: any[] = isAllPortfolios
    ? allTxQueries.flatMap(r => ((r.data as any)?.items ?? []))
    : (transactions?.items ?? []);

  const activeLoading = isAllPortfolios ? loadingDash : loadingSummary;

  // ── FIFO Analytics — shared portfolioEngine (single source of truth for all screens) ──
  const fifoAnalytics = useMemo(() => {
    // ── FX conversion function ──────────────────────────────────────────────────
    // All-portfolios mode: convert each holding's currency → displayCurrency.
    // Single-portfolio mode: convert each holding's currency → portfolio baseCurrency.
    //   derivation: convert(v, c) / convert(1, baseCurrency) = v × (c→baseCurrency rate)
    const baseRate = isAllPortfolios ? 1 : (convert(1, baseCurrency) || 1);
    const convertFn = (v: number, fromCurrency: string): number => {
      if (isAllPortfolios) return convert(v, fromCurrency);
      if (fromCurrency === baseCurrency) return v;
      return convert(v, fromCurrency) / baseRate;
    };

    // ── Build holding entries ────────────────────────────────────────────────────
    const holdingEntries: Array<{ holdingId?: number; symbol: string; currentPrice: number; currency: string; txs: any[] }> = [];

    if (isAllPortfolios) {
      allPortfolioIds.forEach((_, i) => {
        const pHoldings = Array.isArray(allHoldingsQueries[i]?.data)
          ? (allHoldingsQueries[i].data as any[])
          : [];
        const currency = portfolios?.[i]?.baseCurrency ?? "USD";
        const pTxItems = (allTxQueries[i]?.data as any)?.items ?? [];

        const ANA_HOLDING_TX_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION", "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT"]);
        const ANA_FUND_BOND_MARKETS = new Set(["FUNDS", "BONDS"]);

        const txByHoldingId = new Map<number, any[]>();
        pTxItems.forEach((tx: any) => {
          if (!tx.holdingId || !ANA_HOLDING_TX_TYPES.has(tx.type)) return;
          if (!txByHoldingId.has(tx.holdingId)) txByHoldingId.set(tx.holdingId, []);
          txByHoldingId.get(tx.holdingId)!.push(tx);
        });

        pHoldings.forEach((h: any) => {
          const holdingTxs = txByHoldingId.get(h.id) ?? [];
          const hasFundTransfer = holdingTxs.some((tx: any) => tx.type === "FUND_TRANSFER_IN" || tx.type === "FUND_TRANSFER_OUT");
          const isFundBond = ANA_FUND_BOND_MARKETS.has(h.market) || hasFundTransfer;
          const entry: any = {
            holdingId: h.id,
            symbol: h.symbol,
            currentPrice: parseFloat(h.currentPrice ?? "0") || 0,
            currency,
            txs: holdingTxs,
          };
          if (isFundBond) {
            entry.precomputedCurrentValue = parseFloat(String(h.currentValue ?? 0)) || 0;
            entry.precomputedInvested = parseFloat(String(h.avgCostBasis ?? 0)) || 0;
          }
          holdingEntries.push(entry);
        });
      });
    } else {
      const currency = baseCurrency;
      const ANA_HOLDING_TX_TYPES2 = new Set(["BUY", "SELL", "DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION", "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT"]);
      const ANA_FUND_BOND_MARKETS2 = new Set(["FUNDS", "BONDS"]);

      const txByHoldingId = new Map<number, any[]>();
      (transactions?.items ?? []).forEach((tx: any) => {
        if (!tx.holdingId || !ANA_HOLDING_TX_TYPES2.has(tx.type)) return;
        if (!txByHoldingId.has(tx.holdingId)) txByHoldingId.set(tx.holdingId, []);
        txByHoldingId.get(tx.holdingId)!.push(tx);
      });

      (holdings ?? []).forEach((h: any) => {
        const holdingTxs = txByHoldingId.get(h.id) ?? [];
        const hasFundTransfer = holdingTxs.some((tx: any) => tx.type === "FUND_TRANSFER_IN" || tx.type === "FUND_TRANSFER_OUT");
        const isFundBond = ANA_FUND_BOND_MARKETS2.has(h.market) || hasFundTransfer;
        const entry: any = {
          holdingId: h.id,
          symbol: h.symbol,
          currentPrice: parseFloat(h.currentPrice ?? "0") || 0,
          currency,
          txs: holdingTxs,
        };
        if (isFundBond) {
          entry.precomputedCurrentValue = parseFloat(String(h.currentValue ?? 0)) || 0;
          entry.precomputedInvested = parseFloat(String(h.avgCostBasis ?? 0)) || 0;
        }
        holdingEntries.push(entry);
      });
    }

    // ── Build deposit records (Invested = Deposits − Withdrawals) ───────────────
    const depositRecords: Array<{ type: "DEPOSIT" | "WITHDRAWAL"; amount: string | number; currency: string }> = [];
    if (isAllPortfolios) {
      allPortfolioIds.forEach((_, i) => {
        const currency = portfolios?.[i]?.baseCurrency ?? "USD";
        const items = (allTxQueries[i]?.data as any)?.items ?? [];
        items.forEach((tx: any) => {
          if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") {
            depositRecords.push({ type: tx.type as "DEPOSIT" | "WITHDRAWAL", amount: tx.amount ?? "0", currency });
          }
        });
      });
    } else {
      (transactions?.items ?? []).forEach((tx: any) => {
        if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") {
          depositRecords.push({ type: tx.type as "DEPOSIT" | "WITHDRAWAL", amount: tx.amount ?? "0", currency: baseCurrency });
        }
      });
    }

    const cashRecords: Array<{ type: "CASH_GAIN" | "CASH_EXPENSE"; amount: string | number; currency: string }> = [];
    if (isAllPortfolios) {
      allPortfolioIds.forEach((_, i) => {
        const currency = portfolios?.[i]?.baseCurrency ?? "USD";
        const items = (allTxQueries[i]?.data as any)?.items ?? [];
        items.forEach((tx: any) => {
          if (tx.type === "CASH_GAIN" || tx.type === "CASH_EXPENSE") {
            cashRecords.push({ type: tx.type as "CASH_GAIN" | "CASH_EXPENSE", amount: tx.amount ?? "0", currency });
          }
        });
      });
    } else {
      (transactions?.items ?? []).forEach((tx: any) => {
        if (tx.type === "CASH_GAIN" || tx.type === "CASH_EXPENSE") {
          cashRecords.push({ type: tx.type as "CASH_GAIN" | "CASH_EXPENSE", amount: tx.amount ?? "0", currency: baseCurrency });
        }
      });
    }

    return computePortfolioMetrics(holdingEntries, depositRecords, convertFn, cashRecords);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAllPortfolios, allPortfolioIds,
    allHoldingsQueries, allTxQueries,
    holdings, transactions,
    baseCurrency, portfolios, convert,
  ]);

  // ── Combined Performance (all portfolios merged) ──────────────────────────────
  const combinedPerformance = useMemo(() => {
    if (!isAllPortfolios) return singlePerformance ?? [];
    if (allPerfQueries.length === 0) return [];
    const dateMap = new Map<string, number>();
    allPerfQueries.forEach((q, i) => {
      const data = (Array.isArray(q.data) ? q.data : []) as Array<{ date: string; value: number }>;
      const currency = portfolios?.[i]?.baseCurrency ?? "USD";
      data.forEach(({ date, value }) => {
        dateMap.set(date, (dateMap.get(date) ?? 0) + convert(value, currency));
      });
    });
    return [...dateMap.entries()]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllPortfolios, singlePerformance, allPerfQueries, portfolios, convert]);

  const loadingPerformance = isAllPortfolios
    ? allPerfQueries.some(q => q.isLoading)
    : loadingSinglePerf;
  const activePerformance = combinedPerformance;

  // ── IRR Metrics ───────────────────────────────────────────────────────────────
  const irrMetrics = useMemo(() => {
    try {
      const today = new Date();
      const minDays = 30;

      const pfCFs = fifoAnalytics.allXirrCFs;
      const hCFs = fifoAnalytics.holdingsXirrCFs;

      const pfFirst = pfCFs[0]?.date;
      const hFirst = hCFs[0]?.date;
      const pfDays = pfFirst ? (today.getTime() - pfFirst.getTime()) / 86_400_000 : 0;
      const hDays = hFirst ? (today.getTime() - hFirst.getTime()) / 86_400_000 : 0;

      return {
        portfolioIrr: pfDays >= minDays && pfCFs.length >= 2 ? computeXIRR(pfCFs) : null,
        holdingsIrr: hDays >= minDays && hCFs.length >= 2 ? computeXIRR(hCFs) : null,
      };
    } catch {
      return { portfolioIrr: null, holdingsIrr: null };
    }
  }, [fifoAnalytics.allXirrCFs, fifoAnalytics.holdingsXirrCFs]);

  // ── TWR (Beta) — Modified Dietz from performance data + external cash flows ───
  const twrMetric = useMemo((): number | null => {
    try {
      const perfData = activePerformance;
      if (!perfData || perfData.length < 3) return null;

      const sorted = [...perfData].sort((a, b) => a.date.localeCompare(b.date));

      // External cash flows: DEPOSIT/WITHDRAWAL (in display currency)
      const externalCFs: Array<{ dateMs: number; amount: number }> = [];
      if (isAllPortfolios) {
        allPortfolioIds.forEach((_, i) => {
          const currency = portfolios?.[i]?.baseCurrency ?? "USD";
          const items = (allTxQueries[i]?.data as any)?.items ?? [];
          items.forEach((tx: any) => {
            if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") {
              const amt = Math.abs(parseFloat(tx.amount ?? "0") || 0);
              externalCFs.push({
                dateMs: new Date(tx.date).getTime(),
                amount: tx.type === "DEPOSIT" ? convert(amt, currency) : -convert(amt, currency),
              });
            }
          });
        });
      } else {
        (transactions?.items ?? []).forEach((tx: any) => {
          if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") {
            const amt = Math.abs(parseFloat(tx.amount ?? "0") || 0);
            externalCFs.push({
              dateMs: new Date(tx.date).getTime(),
              amount: tx.type === "DEPOSIT" ? amt : -amt,
            });
          }
        });
      }

      const firstMs = new Date(sorted[0].date).getTime();
      const lastMs = new Date(sorted[sorted.length - 1].date).getTime();
      const totalDays = (lastMs - firstMs) / 86_400_000;
      if (totalDays < 2) return null;

      let chainedReturn = 1;
      let validPeriods = 0;

      for (let i = 0; i < sorted.length - 1; i++) {
        const startMs = new Date(sorted[i].date).getTime();
        const endMs = new Date(sorted[i + 1].date).getTime();
        const vStart = sorted[i].value;
        const vEnd = sorted[i + 1].value;
        if (vStart <= 0) continue;

        const cf = externalCFs
          .filter(e => e.dateMs > startMs && e.dateMs <= endMs)
          .reduce((s, e) => s + e.amount, 0);

        const denom = vStart + 0.5 * cf;
        if (Math.abs(denom) < 0.01) continue;
        const r = (vEnd - vStart - cf) / denom;
        if (!isFinite(r) || r < -1 || r > 100) continue;
        chainedReturn *= (1 + r);
        validPeriods++;
      }

      if (validPeriods < 2) return null;
      const twr = chainedReturn - 1;
      return Math.pow(1 + twr, 365 / totalDays) - 1;
    } catch {
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePerformance, isAllPortfolios, allPortfolioIds, allTxQueries, portfolios, convert, transactions]);

  // ── Holdings Charts ───────────────────────────────────────────────────────────
  const holdingsChart = useMemo(() => {
    const cvt = (h: any) => isAllPortfolios ? convert(h.currentValue ?? 0, h._pfCurrency ?? displayCurrency) : (h.currentValue ?? 0);
    return [...activeHoldings]
      .filter(h => cvt(h) > 0)
      .sort((a, b) => cvt(b) - cvt(a))
      .map(h => ({ symbol: h.symbol, value: cvt(h), gain: h.unrealizedGain ?? 0 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHoldings, isAllPortfolios, convert, displayCurrency]);

  const holdingsPnl = useMemo(() => {
    return [...fifoAnalytics.holdingsCapGains]
      .filter(h => h.capitalGainConverted !== 0)
      .sort((a, b) => b.capitalGainConverted - a.capitalGainConverted)
      .map(h => ({ symbol: h.symbol, gain: h.capitalGainConverted }));
  }, [fifoAnalytics.holdingsCapGains]);

  // ── Dividend Views ────────────────────────────────────────────────────────────
  const INCOME_TYPES = ["DIVIDEND", "CASH_GAIN", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION"];
  const firstDivYear = useMemo(() => {
    const divItems = activeTransactionItems.filter((tx: any) => INCOME_TYPES.includes(tx.type));
    if (!divItems.length) return CURRENT_YEAR;
    return Math.min(...divItems.map((tx: any) => new Date(tx.date).getFullYear()));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, allTxQueries]);

  const dividendByYear = useMemo(() => {
    const yearMap = new Map<number, number>();
    activeTransactionItems.forEach((tx: any) => {
      if (INCOME_TYPES.includes(tx.type)) {
        const year = new Date(tx.date).getFullYear();
        const gross = Math.abs(parseFloat(tx.amount ?? "0") || 0);
        const fee = Math.abs(parseFloat(String(tx.feeAmount ?? "0")) || 0);
        const tax = Math.abs(parseFloat(String(tx.taxAmount ?? "0")) || 0);
        const net = Math.max(0, gross - fee - tax);
        const amt = convert(net, tx.currency ?? baseCurrency);
        yearMap.set(year, (yearMap.get(year) ?? 0) + amt);
      }
    });
    const result = [];
    const minYear = Math.min(firstDivYear, CURRENT_YEAR - 4);
    for (let y = minYear; y <= CURRENT_YEAR; y++) {
      result.push({ year: String(y), amount: yearMap.get(y) ?? 0 });
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, allTxQueries, firstDivYear, convert, baseCurrency]);

  const dividendByMonthForYear = useMemo(() => {
    const monthTotals = new Array(12).fill(0);
    activeTransactionItems.forEach((tx: any) => {
      if (INCOME_TYPES.includes(tx.type) && new Date(tx.date).getFullYear() === divYear) {
        const gross = Math.abs(parseFloat(tx.amount ?? "0") || 0);
        const fee = Math.abs(parseFloat(String(tx.feeAmount ?? "0")) || 0);
        const tax = Math.abs(parseFloat(String(tx.taxAmount ?? "0")) || 0);
        const net = Math.max(0, gross - fee - tax);
        const amt = convert(net, tx.currency ?? baseCurrency);
        monthTotals[new Date(tx.date).getMonth()] += amt;
      }
    });
    return MONTHS.map((month, i) => ({ month, amount: monthTotals[i] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, allTxQueries, divYear, convert, baseCurrency]);

  // ── Shared UI ─────────────────────────────────────────────────────────────────
  const tooltipStyle = {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "6px",
    color: "hsl(var(--foreground))",
    fontSize: 12,
  };

  const xTickFormatter = (d: string) => {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    if (period === "1M") return format(date, "MMM d");
    if (period === "3M" || period === "6M") return format(date, "MMM d");
    return format(date, "MMM yy");
  };

  const pnlTooltipContent = useCallback(
    (props: any) => <PnlTooltip {...props} fmt={fmt} />,
    [fmt]
  );

  // ── IRR/Pct formatting helpers ────────────────────────────────────────────────
  const fmtIrr = (v: number | null) =>
    v == null ? "N/A" : `${fmtPct(v * 100, 2)}`;

  const colorIrr = (v: number | null) =>
    v == null ? undefined : v >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)";

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">Performance metrics and portfolio analysis.</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 min-h-[1.25em]">
          {isAllPortfolios && fetchedAt
            ? `All values in ${displayCurrency} · FX rates as of ${format(new Date(fetchedAt), "MMM d, HH:mm")}`
            : "\u00A0"
          }
        </p>
      </div>

      {/* Portfolio selector */}
      {portfolios && portfolios.length > 0 && (
        <>
          <div className="md:hidden">
            <Select
              value={selectedPortfolioId === null ? "all" : String(selectedPortfolioId)}
              onValueChange={v => setSelectedPortfolioId(v === "all" ? null : Number(v))}
            >
              <SelectTrigger className="rounded-full h-9 text-sm border-border w-auto min-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Portfolios</SelectItem>
                {portfolios.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} · {p.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="hidden md:flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedPortfolioId(null)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                selectedPortfolioId === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground"
              }`}
            >
              All Portfolios
            </button>
            {portfolios.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPortfolioId(p.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                  selectedPortfolioId === p.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground"
                }`}
              >
                {p.name}
                <span className="ml-1.5 text-xs opacity-70">{p.type}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Mobile metric cards ── */}
      <div className="md:hidden space-y-2">
        {/* Current Value — full width */}
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Current Value</div>
            {activeLoading ? <Skeleton className="h-7 w-32 mt-1" /> : (
              <div className="text-2xl font-bold font-mono mt-1">{fmt(fifoAnalytics.totalPortfolioValue)}</div>
            )}
            {!activeLoading && fifoAnalytics.totalInvested > 0 && (() => {
              const pct = (fifoAnalytics.totalPortfolioValue - fifoAnalytics.totalInvested) / fifoAnalytics.totalInvested * 100;
              return (
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  Invested: {fmt(fifoAnalytics.totalInvested)}{" "}
                  <span className={pct >= 0 ? "text-gain" : "text-loss"}>
                    ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)
                  </span>
                </div>
              );
            })()}
          </CardContent>
        </Card>
        {/* Total Profit + Dividend Yield — 2-col */}
        <div className="grid grid-cols-2 gap-2">
          {/* Total Profit */}
          <Card>
            <CardContent className="p-3">
              <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Total Profit</div>
              {activeLoading ? <Skeleton className="h-5 w-20 mt-2" /> : (
                <>
                  <div className={`text-base font-bold leading-tight mt-1.5 font-mono ${cnValue(fifoAnalytics.totalProfit)}`}>
                    {fmt(fifoAnalytics.totalProfit)}
                  </div>
                  {fifoAnalytics.totalProfitPct != null && (
                    <div className={`text-[10px] font-mono ${cnValue(fifoAnalytics.totalProfit)}`}>
                      {fmtPct(fifoAnalytics.totalProfitPct)}
                    </div>
                  )}
                </>
              )}
              <div className="text-[10px] text-muted-foreground space-y-0.5 mt-2 font-mono">
                <div className={cnValue(fifoAnalytics.totalCapGainSubtext)}>Capital Gain: {fmt(fifoAnalytics.totalCapGainSubtext)}</div>
                <div className={cnValue(fifoAnalytics.totalRealizedSubtext)}>Realized Gains: {fmt(fifoAnalytics.totalRealizedSubtext)}</div>
                <div className={cnValue(fifoAnalytics.totalDividendsSubtext)}>Dividends: {fmt(fifoAnalytics.totalDividendsSubtext)}</div>
              </div>
            </CardContent>
          </Card>
          {/* Dividend Yield */}
          <Card>
            <CardContent className="p-3">
              <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Dividend Yield</div>
              {activeLoading ? <Skeleton className="h-5 w-20 mt-2" /> : (
                <>
                  <div className="text-base font-bold leading-tight mt-1.5 font-mono text-gain">
                    {fifoAnalytics.divYieldPct != null ? `${fifoAnalytics.divYieldPct.toFixed(2)}%` : "N/A"}
                  </div>
                  {fifoAnalytics.totalProfitPct != null && (
                    <div className="text-[10px] font-mono invisible" aria-hidden="true">&nbsp;</div>
                  )}
                </>
              )}
              <div className="text-[10px] text-muted-foreground space-y-0.5 mt-2 font-mono">
                <div>Yield on Cost: {fifoAnalytics.yieldOnCost != null ? `${fifoAnalytics.yieldOnCost.toFixed(2)}%` : "N/A"}</div>
                <div className="text-gain">Annual Passive: {fmt(fifoAnalytics.projectedAnnualDiv)}</div>
                <div className={fifoAnalytics.weightedDivGrowth5y != null ? cnValue(fifoAnalytics.weightedDivGrowth5y) : ""}>
                  Growth (5Y): {fifoAnalytics.weightedDivGrowth5y != null ? fmtPct(fifoAnalytics.weightedDivGrowth5y) : "N/A"}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Desktop metric cards (3-col) ── */}
      <div className="hidden md:grid grid-cols-3 gap-4">
        {/* Current Value */}
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Current Value</div>
            {activeLoading ? <Skeleton className="h-7 w-32 mt-1" /> : (
              <div className="text-xl font-bold font-mono">{fmt(fifoAnalytics.totalPortfolioValue)}</div>
            )}
            {!activeLoading && fifoAnalytics.totalInvested > 0 && (() => {
              const pct = (fifoAnalytics.totalPortfolioValue - fifoAnalytics.totalInvested) / fifoAnalytics.totalInvested * 100;
              return (
                <div className="text-xs mt-1 font-mono text-muted-foreground">
                  Invested: {fmt(fifoAnalytics.totalInvested)}{" "}
                  <span className={pct >= 0 ? "text-gain" : "text-loss"}>
                    ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)
                  </span>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Total Profit (FIFO) */}
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Total Profit</div>
            {activeLoading ? <Skeleton className="h-7 w-32 mt-1" /> : (
              <div className={`text-xl font-bold font-mono ${cnValue(fifoAnalytics.totalProfit)}`}>
                {fmt(fifoAnalytics.totalProfit)}
                {fifoAnalytics.totalProfitPct != null && (
                  <span className="text-sm font-normal ml-1.5">
                    ({fmtPct(fifoAnalytics.totalProfitPct)})
                  </span>
                )}
              </div>
            )}
            {!activeLoading && (
              <div className="mt-2 space-y-0.5">
                <SubRow
                  label="Capital Gain"
                  value={fmt(fifoAnalytics.totalCapGainSubtext)}
                  color={fifoAnalytics.totalCapGainSubtext >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"}
                />
                <SubRow
                  label="Realized P&L"
                  value={fmt(fifoAnalytics.totalRealizedSubtext)}
                  color={fifoAnalytics.totalRealizedSubtext >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"}
                />
                <SubRow
                  label="Dividends"
                  value={fmt(fifoAnalytics.totalDividendsSubtext)}
                  color={fifoAnalytics.totalDividendsSubtext >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dividend Yield */}
        <Card>
          <CardContent className="pt-6 pb-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Dividend Yield</div>
            {activeLoading ? <Skeleton className="h-7 w-32 mt-1" /> : (
              <div className="text-xl font-bold font-mono text-gain">
                {fifoAnalytics.divYieldPct != null ? `${fifoAnalytics.divYieldPct.toFixed(2)}%` : "N/A"}
              </div>
            )}
            {!activeLoading && (
              <div className="mt-2 space-y-0.5">
                <SubRow
                  label="Yield on Cost"
                  value={na(fifoAnalytics.yieldOnCost != null ? `${fifoAnalytics.yieldOnCost.toFixed(2)}%` : null)}
                />
                <SubRow
                  label="Annual Passive Income"
                  value={fmt(fifoAnalytics.projectedAnnualDiv)}
                  color="hsl(142 76% 36%)"
                />
                <SubRow
                  label="Div Growth (5Y)"
                  value={na(fifoAnalytics.weightedDivGrowth5y != null
                    ? fmtPct(fifoAnalytics.weightedDivGrowth5y)
                    : null
                  )}
                  color={fifoAnalytics.weightedDivGrowth5y != null
                    ? fifoAnalytics.weightedDivGrowth5y >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"
                    : undefined
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Portfolio Performance (single + all portfolios) ── */}
      {(activePerformance.length > 0 || loadingPerformance) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <CardTitle className="text-base md:text-lg">Portfolio Performance</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {PERIODS.map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      period === p
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <Badge variant="outline" className="text-xs font-mono">
                  {isAllPortfolios ? displayCurrency : baseCurrency}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-[213px] md:h-[240px] px-2 md:px-6">
            {loadingPerformance ? (
              <Skeleton className="w-full h-full" />
            ) : !activePerformance.length ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No performance data for this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activePerformance} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={xTickFormatter}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    interval="preserveStartEnd" minTickGap={40}
                  />
                  <YAxis
                    tickFormatter={niceYAxisTick}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    width={52} allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(v: number) => [fmt(v), "Value"]}
                    labelFormatter={(d) => {
                      const date = new Date(d);
                      return isNaN(date.getTime()) ? d : format(date, "MMM d, yyyy");
                    }}
                    contentStyle={tooltipStyle}
                  />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Asset Allocation + Holdings by Value ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base md:text-lg">Asset Allocation</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            {(isAllPortfolios ? allHoldingsQueries.some(q => q.isLoading) : !holdings) ? (
              <Skeleton className="w-full h-[200px]" />
            ) : (() => {
              const cvtHPie = (h: any) => isAllPortfolios ? convert(h.currentValue ?? 0, h._pfCurrency ?? displayCurrency) : (h.currentValue ?? 0);
              const pieTotal = activeHoldings.reduce((s: number, h: any) => s + cvtHPie(h), 0);
              const pieData = activeHoldings
                .filter((h: any) => cvtHPie(h) > 0)
                .map((h, i) => ({
                  label: h.symbol,
                  value: cvtHPie(h),
                  color: PIE_COLORS[i % PIE_COLORS.length],
                  weight: pieTotal > 0 ? (cvtHPie(h) / pieTotal) * 100 : 0,
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 12);
              if (!pieData.length) return (
                <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">No holdings data.</div>
              );
              const active = activeAllocIdx !== null && activeAllocIdx < pieData.length ? pieData[activeAllocIdx] : null;
              return (
                <div className="flex flex-col gap-3">
                  <div className="relative w-full h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%" cy="50%"
                          innerRadius={52} outerRadius={80}
                          paddingAngle={0}
                          dataKey="value"
                          onClick={(_, index) => setActiveAllocIdx(prev => prev === index ? null : index)}
                          style={{ cursor: "pointer" }}
                        >
                          {pieData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.color}
                              opacity={activeAllocIdx === null || activeAllocIdx === index ? 1 : 0.35}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    {active && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <div className="text-[11px] font-semibold" style={{ color: active.color }}>{active.label}</div>
                          <div className="text-sm font-bold font-mono">{fmt(active.value)}</div>
                          <div className="text-[10px] text-muted-foreground">{active.weight.toFixed(1)}%</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 border-t border-border/40 pt-2">
                    {pieData.map((a, i) => (
                      <button
                        key={a.label}
                        onClick={() => setActiveAllocIdx(prev => prev === i ? null : i)}
                        className="flex items-center gap-1.5 px-1 py-0.5 rounded min-w-0 text-left"
                        style={{ background: activeAllocIdx === i ? `${a.color}15` : undefined }}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                        <span className="text-[9px] text-muted-foreground truncate flex-1 leading-none">{a.label}</span>
                        <span className="text-[9px] font-mono leading-none shrink-0">{a.weight.toFixed(1)}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base md:text-lg">Holdings by Value</CardTitle>
          </CardHeader>
          <CardContent className="px-2 md:px-6" style={{ height: Math.max(280, Math.min(600, holdingsChart.length * 24 + 40)) }}>
            {holdingsChart.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No holdings data.</div>
            ) : (
              <div className="relative w-full h-full" onClick={() => { if (!holdBarRef.current) setActiveHoldingsIdx(null); holdBarRef.current = false; }}>
                {activeHoldingsIdx !== null && holdingsChart[activeHoldingsIdx] && (
                  <div className="absolute top-0 left-14 z-10 flex items-center gap-2 text-[11px] font-mono bg-muted/90 border border-border rounded px-2 py-0.5 pointer-events-none">
                    <span className="font-semibold">{holdingsChart[activeHoldingsIdx].symbol}</span>
                    <span className="text-primary">{fmt(holdingsChart[activeHoldingsIdx].value)}</span>
                  </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={holdingsChart} layout="vertical" margin={{ left: 0, right: 52, top: activeHoldingsIdx !== null ? 20 : 4, bottom: 4 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="symbol"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      axisLine={false} tickLine={false} width={48}
                    />
                    <Bar dataKey="value" radius={[0, 3, 3, 0]} barSize={16} isAnimationActive={false}
                      onClick={(_data: any, idx: number) => { holdBarRef.current = true; setActiveHoldingsIdx(p => p === idx ? null : idx); }}
                      style={{ cursor: "pointer" }}
                    >
                      {holdingsChart.map((_entry, index) => (
                        <Cell key={index} fill="hsl(var(--primary))" fillOpacity={activeHoldingsIdx === null || activeHoldingsIdx === index ? 1 : 0.35} />
                      ))}
                      <LabelList dataKey="value" position="right"
                        formatter={(v: number) => { const a = Math.abs(v); return a >= 1e6 ? `${(v/1e6).toFixed(1)}M` : a >= 1e3 ? `${(v/1e3).toFixed(1)}k` : fmt(v); }}
                        style={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Unrealized P&L + Dividends ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Unrealized P&L — custom tooltip with dynamic label color */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base md:text-lg">Unrealized P&amp;L by Holding</CardTitle>
          </CardHeader>
          <CardContent className="px-2 md:px-6" style={{ height: Math.max(280, Math.min(600, holdingsPnl.length * 24 + 40)) }}>
            {holdingsPnl.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No P&L data.</div>
            ) : (
              <div className="relative w-full h-full" onClick={() => { if (!pnlBarRef.current) setActivePnlIdx(null); pnlBarRef.current = false; }}>
                {activePnlIdx !== null && holdingsPnl[activePnlIdx] && (
                  <div className="absolute top-0 left-14 z-10 flex items-center gap-2 text-[11px] font-mono bg-muted/90 border border-border rounded px-2 py-0.5 pointer-events-none">
                    <span className="font-semibold">{holdingsPnl[activePnlIdx].symbol}</span>
                    <span className={holdingsPnl[activePnlIdx].gain >= 0 ? "text-gain" : "text-loss"}>{fmt(holdingsPnl[activePnlIdx].gain)}</span>
                  </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={holdingsPnl} layout="vertical" margin={{ left: 0, right: 60, top: activePnlIdx !== null ? 20 : 4, bottom: 4 }}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="symbol"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      axisLine={false} tickLine={false} width={48}
                    />
                    <Bar dataKey="gain" radius={[0, 3, 3, 0]} barSize={16} isAnimationActive={false}
                      onClick={(_data: any, idx: number) => { pnlBarRef.current = true; setActivePnlIdx(p => p === idx ? null : idx); }}
                      style={{ cursor: "pointer" }}
                    >
                      {holdingsPnl.map((entry, index) => (
                        <Cell key={`cell-${index}`}
                          fill={entry.gain >= 0 ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"}
                          fillOpacity={activePnlIdx === null || activePnlIdx === index ? 1 : 0.35}
                        />
                      ))}
                      <LabelList dataKey="gain" position="right"
                        formatter={(v: number) => { const a = Math.abs(v); return a >= 1e6 ? `${(v/1e6).toFixed(1)}M` : a >= 1e3 ? `${(v/1e3).toFixed(1)}k` : fmt(v); }}
                        style={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dividends — yearly / monthly / asset views */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <CardTitle className="text-base md:text-lg shrink-0">Dividends</CardTitle>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Year nav — visibility:hidden keeps layout stable, year between arrows */}
                <div style={{ visibility: divView === "monthly" ? "visible" : "hidden" }} className="flex items-center gap-0.5">
                  <button
                    onClick={() => divYear > firstDivYear && setDivYear(y => y - 1)}
                    disabled={divYear <= firstDivYear}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-mono text-muted-foreground w-10 text-center select-none">{divYear}</span>
                  <button
                    onClick={() => divYear < CURRENT_YEAR && setDivYear(y => y + 1)}
                    disabled={divYear >= CURRENT_YEAR}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1 bg-muted rounded-full p-0.5">
                  {(["monthly", "yearly", "asset"] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setDivView(v)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                        divView === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                      }`}
                    >
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          {/* Fixed-height container — same across all views to prevent layout jumps */}
          <CardContent className="h-[256px] px-2 md:px-6">
            <div className="relative w-full h-full" onClick={() => { if (!divBarRef.current) setActiveDivIdx(null); divBarRef.current = false; }}>
            {(() => {
              if (divView === "asset") {
                const data = fifoAnalytics.dividendByAsset;
                if (!data.length) return (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No dividend data.</div>
                );
                return (
                  <>
                    {activeDivIdx !== null && data[activeDivIdx] && (
                      <div className="absolute top-0 left-14 z-10 flex items-center gap-2 text-[11px] font-mono bg-muted/90 border border-border rounded px-2 py-0.5 pointer-events-none">
                        <span className="font-semibold">{data[activeDivIdx].symbol}</span>
                        <span className="text-gain">{fmt(data[activeDivIdx].amount)}</span>
                      </div>
                    )}
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data} margin={{ left: 0, right: 8, top: activeDivIdx !== null ? 16 : 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
                        <XAxis dataKey="symbol"
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                          angle={-40}
                          textAnchor="end"
                          height={56}
                          interval={0}
                          axisLine={false} tickLine={false}
                          tickFormatter={(v: string) => v.length > 8 ? v.slice(0, 8) + "…" : v}
                        />
                        <YAxis
                          tickFormatter={niceYAxisTick}
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                          axisLine={false} tickLine={false}
                          width={48} allowDecimals={false}
                        />
                        <Bar dataKey="amount" radius={[3, 3, 0, 0]} isAnimationActive={false}
                          onClick={(_d: any, idx: number) => { divBarRef.current = true; setActiveDivIdx(p => p === idx ? null : idx); }}
                          style={{ cursor: "pointer" }}
                        >
                          {data.map((_e, index) => (
                            <Cell key={index} fill="hsl(142 76% 36%)" fillOpacity={activeDivIdx === null || activeDivIdx === index ? 1 : 0.35} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </>
                );
              }

              const chartData = divView === "yearly" ? dividendByYear : dividendByMonthForYear;
              const key = divView === "yearly" ? "year" : "month";
              if (!chartData.length || chartData.every(d => d.amount === 0)) return (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No income data.</div>
              );
              return (
                <>
                  {activeDivIdx !== null && chartData[activeDivIdx] && (
                    <div className="absolute top-0 left-14 z-10 flex items-center gap-2 text-[11px] font-mono bg-muted/90 border border-border rounded px-2 py-0.5 pointer-events-none">
                      <span className="font-semibold">{(chartData[activeDivIdx] as any)[key]}</span>
                      <span className="text-gain">{fmt(chartData[activeDivIdx].amount)}</span>
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ left: 0, right: 8, top: activeDivIdx !== null ? 16 : 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
                      <XAxis dataKey={key}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                        height={56}
                        axisLine={false} tickLine={false}
                      />
                      <YAxis
                        tickFormatter={niceYAxisTick}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                        axisLine={false} tickLine={false}
                        width={48} allowDecimals={false}
                      />
                      <Bar dataKey="amount" radius={[3, 3, 0, 0]} isAnimationActive={false}
                        onClick={(_d: any, idx: number) => { divBarRef.current = true; setActiveDivIdx(p => p === idx ? null : idx); }}
                        style={{ cursor: "pointer" }}
                      >
                        {chartData.map((_e, index) => (
                          <Cell key={index} fill="hsl(142 76% 36%)" fillOpacity={activeDivIdx === null || activeDivIdx === index ? 1 : 0.35} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              );
            })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Metrics Bar ── */}
      <Card>
        <CardContent className="py-4 px-2 md:px-4">
          <div className="flex divide-x divide-border">
            {/* IRR */}
            <div className="flex flex-col items-center justify-center text-center flex-1 px-1 py-1 gap-1">
              <div className="text-[10px] md:text-xs text-muted-foreground font-medium uppercase tracking-wider">IRR</div>
              <div
                className="text-base md:text-xl font-bold font-mono"
                style={{ color: colorIrr(irrMetrics.portfolioIrr) }}
              >
                {fmtIrr(irrMetrics.portfolioIrr)}
              </div>
              <div className="text-[9px] text-muted-foreground">Portfolio annualized</div>
            </div>

            {/* Current Holdings IRR */}
            <div className="flex flex-col items-center justify-center text-center flex-1 px-1 py-1 gap-1">
              <div className="text-[10px] md:text-xs text-muted-foreground font-medium uppercase tracking-wider">Holdings IRR</div>
              <div
                className="text-base md:text-xl font-bold font-mono"
                style={{ color: colorIrr(irrMetrics.holdingsIrr) }}
              >
                {fmtIrr(irrMetrics.holdingsIrr)}
              </div>
              <div className="text-[9px] text-muted-foreground">Unsold positions only</div>
            </div>

            {/* TWR (Beta) */}
            <div className="flex flex-col items-center justify-center text-center flex-1 px-1 py-1 gap-1">
              <div className="text-[10px] md:text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Portfolio TWR <span className="text-[8px] opacity-60">(Beta)</span>
              </div>
              <div
                className="text-base md:text-xl font-bold font-mono"
                style={{ color: colorIrr(twrMetric) }}
              >
                {fmtIrr(twrMetric)}
              </div>
              <div className="text-[9px] text-muted-foreground">Time-weighted, annualized</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

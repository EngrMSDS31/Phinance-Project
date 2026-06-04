import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatPercent } from "@/lib/format";

interface BenchmarkPoint {
  date: string;
  portfolioPct: number | null;
  benchmarkPct: number | null;
}

interface BenchmarkData {
  portfolioId: number;
  period: string;
  benchmark: { key: string; label: string; ticker: string } | null;
  portfolioReturnPct: number;
  benchmarkReturnPct: number | null;
  dataPoints: BenchmarkPoint[];
  availableBenchmarks: Array<{ key: string; label: string; currency: string }>;
}

const PERIODS = [
  { label: "1M", value: "1M" },
  { label: "3M", value: "3M" },
  { label: "6M", value: "6M" },
  { label: "1Y", value: "1Y" },
  { label: "2Y", value: "2Y" },
  { label: "All", value: "ALL" },
];

async function fetchBenchmark(portfolioId: number, benchmark: string, period: string): Promise<BenchmarkData> {
  const res = await fetch(`/api/portfolios/${portfolioId}/benchmark?benchmark=${benchmark}&period=${period}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch benchmark data");
  return res.json();
}

function ReturnBadge({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return null;
  const isPos = pct >= 0;
  const isNeg = pct < 0;
  const Icon = isPos ? TrendingUp : isNeg ? TrendingDown : Minus;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge
        variant="outline"
        className={`gap-1 text-xs font-mono ${
          isPos ? "border-green-600 text-green-500" :
          isNeg ? "border-red-600 text-red-500" :
          "border-slate-600 text-slate-400"
        }`}
      >
        <Icon className="w-3 h-3" />
        {isPos ? "+" : ""}{pct.toFixed(2)}%
      </Badge>
    </div>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-md shadow-lg p-3 text-sm">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: entry.color }} />
            <span className="text-muted-foreground text-xs">{entry.name}</span>
          </span>
          <span className={`font-mono font-semibold ${entry.value >= 0 ? "text-green-400" : "text-red-400"}`}>
            {entry.value >= 0 ? "+" : ""}{entry.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export function BenchmarkChart({ portfolioId }: { portfolioId: number }) {
  const [period, setPeriod] = useState("1Y");
  const [benchmark, setBenchmark] = useState("SP500");

  const { data, isLoading, isError } = useQuery<BenchmarkData>({
    queryKey: ["benchmark", portfolioId, benchmark, period],
    queryFn: () => fetchBenchmark(portfolioId, benchmark, period),
    staleTime: 5 * 60 * 1000,
    enabled: !!portfolioId,
  });

  const formatXAxis = useCallback((tick: string) => {
    const d = new Date(tick);
    if (isNaN(d.getTime())) return tick;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }, []);

  const formatYAxis = useCallback((value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`, []);

  const availableBenchmarks = data?.availableBenchmarks ?? [
    { key: "SP500",   label: "S&P 500",   currency: "USD" },
    { key: "NASDAQ",  label: "Nasdaq 100", currency: "USD" },
    { key: "DOW",     label: "Dow Jones",  currency: "USD" },
    { key: "FTSE100", label: "FTSE 100",  currency: "GBP" },
    { key: "PSEI",    label: "PSEi",       currency: "PHP" },
    { key: "BTC",     label: "Bitcoin",    currency: "USD" },
    { key: "ETH",     label: "Ethereum",   currency: "USD" },
    { key: "GOLD",    label: "Gold",       currency: "USD" },
  ];

  const benchmarkLabel = availableBenchmarks.find(b => b.key === benchmark)?.label ?? benchmark;

  // Downsample to at most 60 points for cleaner chart
  const chartData = (() => {
    const pts = data?.dataPoints ?? [];
    if (pts.length <= 60) return pts;
    const step = Math.ceil(pts.length / 60);
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  })();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="text-base font-semibold">Performance vs Benchmark</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* Period pills */}
            <div className="flex rounded-md border border-border overflow-hidden">
              {PERIODS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    period === p.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {/* Benchmark selector */}
            <Select value={benchmark} onValueChange={setBenchmark}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="Benchmark" />
              </SelectTrigger>
              <SelectContent>
                {availableBenchmarks.map(b => (
                  <SelectItem key={b.key} value={b.key} className="text-xs">
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* Return summary badges */}
        {data && (
          <div className="flex flex-wrap gap-3 pt-1">
            <ReturnBadge pct={data.portfolioReturnPct} label="Portfolio" />
            <ReturnBadge pct={data.benchmarkReturnPct} label={benchmarkLabel} />
            {data.benchmarkReturnPct != null && (
              <ReturnBadge
                pct={parseFloat((data.portfolioReturnPct - data.benchmarkReturnPct).toFixed(2))}
                label="Alpha"
              />
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[280px] w-full" />
        ) : isError ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            Could not load benchmark data.
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            No data available for this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis
                dataKey="date"
                tickFormatter={formatXAxis}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={formatYAxis}
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={54}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="4 2" />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8, color: "hsl(var(--muted-foreground))" }}
              />
              <Line
                type="monotone"
                dataKey="portfolioPct"
                name="Portfolio"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="benchmarkPct"
                name={benchmarkLabel}
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                strokeDasharray="5 3"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

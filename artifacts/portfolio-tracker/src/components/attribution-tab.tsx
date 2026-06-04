import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type AttributionItem = {
  id: number;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  holdingReturnPct: number;
  weightPct: number;
  contributionPpt: number;
  dividendIncome: number;
  totalReturn: number;
  totalReturnPctFormatted: number;
};

type AttributionData = {
  items: AttributionItem[];
  totalMarketValue: number;
  totalHoldingsValue: number;
  cashBalance: number;
  totalCostBasis: number;
  totalUnrealizedPL: number;
  totalDividends: number;
  totalReturn: number;
  totalPortfolioReturn: number;
};

async function fetchAttribution(portfolioId: number): Promise<AttributionData> {
  const res = await fetch(`/api/portfolios/${portfolioId}/attribution`);
  if (!res.ok) throw new Error("Failed to load attribution data");
  return res.json();
}

function fmt(n: number, digits = 2) {
  return n.toFixed(digits);
}

function fmtPct(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as AttributionItem;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs space-y-1 min-w-[180px]">
      <div className="font-semibold text-sm mb-1">{d.symbol} <span className="text-muted-foreground font-normal">· {d.market}</span></div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Weight</span>
        <span className="font-mono">{fmt(d.weightPct)}%</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Holding return</span>
        <span className={cn("font-mono", d.holdingReturnPct >= 0 ? "text-emerald-400" : "text-red-400")}>
          {fmtPct(d.holdingReturnPct)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Contribution</span>
        <span className={cn("font-mono font-semibold", d.contributionPpt >= 0 ? "text-emerald-400" : "text-red-400")}>
          {fmtPct(d.contributionPpt)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Unrealized P/L</span>
        <span className={cn("font-mono", d.unrealizedPL >= 0 ? "text-emerald-400" : "text-red-400")}>
          {d.unrealizedPL >= 0 ? "+" : ""}{fmtCurrency(d.unrealizedPL, d.currency)}
        </span>
      </div>
      {d.dividendIncome > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Dividends</span>
          <span className="font-mono text-blue-400">+{fmtCurrency(d.dividendIncome, d.currency)}</span>
        </div>
      )}
    </div>
  );
};

export function AttributionTab({ portfolioId, baseCurrency }: { portfolioId: number; baseCurrency: string }) {
  const { data, isLoading, error } = useQuery<AttributionData>({
    queryKey: ["attribution", portfolioId],
    queryFn: () => fetchAttribution(portfolioId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="text-sm text-muted-foreground p-8 text-center">Could not load attribution data.</div>;
  }

  if (!data.items.length) {
    return <div className="text-sm text-muted-foreground p-8 text-center">No holdings to analyze. Add holdings and transactions first.</div>;
  }

  const totalReturn = data.totalPortfolioReturn;
  const topContributors = [...data.items].sort((a, b) => b.contributionPpt - a.contributionPpt).slice(0, 3);
  const topDraggers = [...data.items].sort((a, b) => a.contributionPpt - b.contributionPpt).slice(0, 3);

  // Chart data sorted by contribution (most positive first)
  const chartData = [...data.items].sort((a, b) => b.contributionPpt - a.contributionPpt);

  return (
    <div className="space-y-5">
      {/* Fix 21: Summary strip — 2×2 on mobile, 4-col on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Portfolio Return</div>
          <div className={cn("text-2xl font-bold font-mono", totalReturn >= 0 ? "text-emerald-400" : "text-red-400")}>
            {fmtPct(totalReturn)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">unrealized + dividends</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Return (abs)</div>
          <div className={cn("text-xl font-bold font-mono", data.totalReturn >= 0 ? "text-emerald-400" : "text-red-400")}>
            {data.totalReturn >= 0 ? "+" : ""}{fmtCurrency(data.totalReturn, baseCurrency)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">cost basis {fmtCurrency(data.totalCostBasis, baseCurrency)}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Unrealized P/L</div>
          <div className={cn("text-xl font-bold font-mono", data.totalUnrealizedPL >= 0 ? "text-emerald-400" : "text-red-400")}>
            {data.totalUnrealizedPL >= 0 ? "+" : ""}{fmtCurrency(data.totalUnrealizedPL, baseCurrency)}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Dividend Income</div>
          <div className="text-xl font-bold font-mono text-blue-400">
            {fmtCurrency(data.totalDividends, baseCurrency)}
          </div>
        </div>
      </div>

      {/* Top contributors / draggers */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            Top Contributors
          </div>
          <div className="space-y-2">
            {topContributors.filter(i => i.contributionPpt > 0).map(item => (
              <div key={item.id} className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-mono font-semibold">{item.symbol}</span>
                  <span className="text-xs text-muted-foreground ml-2">{fmt(item.weightPct)}% weight</span>
                </div>
                <span className="text-sm font-mono font-semibold text-emerald-400">+{fmt(item.contributionPpt)}pp</span>
              </div>
            ))}
            {topContributors.every(i => i.contributionPpt <= 0) && (
              <div className="text-xs text-muted-foreground">No positive contributors yet</div>
            )}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
            Top Detractors
          </div>
          <div className="space-y-2">
            {topDraggers.filter(i => i.contributionPpt < 0).map(item => (
              <div key={item.id} className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-mono font-semibold">{item.symbol}</span>
                  <span className="text-xs text-muted-foreground ml-2">{fmt(item.weightPct)}% weight</span>
                </div>
                <span className="text-sm font-mono font-semibold text-red-400">{fmt(item.contributionPpt)}pp</span>
              </div>
            ))}
            {topDraggers.every(i => i.contributionPpt >= 0) && (
              <div className="text-xs text-muted-foreground">No detractors — all holdings positive</div>
            )}
          </div>
        </div>
      </div>

      {/* Contribution waterfall chart */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="text-xs font-medium text-muted-foreground mb-4">Return Contribution by Holding (pp = percentage points added to portfolio return)</div>
        <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 36)}>
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 0, right: 60, bottom: 0, left: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}pp`}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="symbol"
              tick={{ fontSize: 11, fill: "#e2e8f0", fontFamily: "monospace" }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            <Bar dataKey="contributionPpt" radius={3} maxBarSize={24}>
              {chartData.map((item) => (
                <Cell
                  key={item.id}
                  fill={item.contributionPpt >= 0 ? "rgba(52,211,153,0.75)" : "rgba(248,113,113,0.75)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed table — scrollable on mobile */}
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground sticky left-0 bg-card z-10 shadow-[1px_0_0_hsl(var(--border))]">Holding</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Market Value</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Weight</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Holding Return</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Contribution</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Unrealized P/L</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Dividends</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Total Return</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map(item => (
              <tr key={item.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 sticky left-0 bg-card z-10 shadow-[1px_0_0_hsl(var(--border))]">
                  <div className="font-mono font-semibold text-sm">{item.symbol}</div>
                  <div className="text-xs text-muted-foreground truncate max-w-[140px]">{item.name}</div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm">{fmtCurrency(item.marketValue, item.currency)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-400"
                        style={{ width: `${Math.min(100, item.weightPct)}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs w-10 text-right">{fmt(item.weightPct)}%</span>
                  </div>
                </td>
                <td className={cn("px-4 py-3 text-right font-mono text-sm", item.holdingReturnPct >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {fmtPct(item.holdingReturnPct)}
                </td>
                <td className={cn("px-4 py-3 text-right font-mono text-sm font-semibold", item.contributionPpt >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {item.contributionPpt >= 0 ? "+" : ""}{fmt(item.contributionPpt)}pp
                </td>
                <td className={cn("px-4 py-3 text-right font-mono text-sm", item.unrealizedPL >= 0 ? "text-emerald-400" : "text-red-400")}>
                  {item.unrealizedPL >= 0 ? "+" : ""}{fmtCurrency(item.unrealizedPL, item.currency)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm text-blue-400">
                  {item.dividendIncome > 0 ? fmtCurrency(item.dividendIncome, item.currency) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className={cn("px-4 py-3 text-right font-mono text-sm", item.totalReturn >= 0 ? "text-emerald-400" : "text-red-400")}>
                  <div>{item.totalReturn >= 0 ? "+" : ""}{fmtCurrency(item.totalReturn, item.currency)}</div>
                  <div className="text-xs opacity-75">{fmtPct(item.totalReturnPctFormatted)}</div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20">
              <td className="px-4 py-3 text-xs font-medium text-muted-foreground">Portfolio Total</td>
              <td className="px-4 py-3 text-right font-mono text-sm font-semibold">{fmtCurrency(data.totalHoldingsValue, baseCurrency)}</td>
              <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">100%</td>
              <td className="px-4 py-3" />
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-bold", totalReturn >= 0 ? "text-emerald-400" : "text-red-400")}>
                {fmtPct(totalReturn)}
              </td>
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-semibold", data.totalUnrealizedPL >= 0 ? "text-emerald-400" : "text-red-400")}>
                {data.totalUnrealizedPL >= 0 ? "+" : ""}{fmtCurrency(data.totalUnrealizedPL, baseCurrency)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm text-blue-400 font-semibold">
                {data.totalDividends > 0 ? fmtCurrency(data.totalDividends, baseCurrency) : <span className="text-muted-foreground">—</span>}
              </td>
              <td className={cn("px-4 py-3 text-right font-mono text-sm font-bold", data.totalReturn >= 0 ? "text-emerald-400" : "text-red-400")}>
                {data.totalReturn >= 0 ? "+" : ""}{fmtCurrency(data.totalReturn, baseCurrency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

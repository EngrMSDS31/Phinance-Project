import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatNumber, cnValue } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface RebalanceHolding {
  holdingId: number;
  symbol: string;
  name: string;
  market: string;
  assetType: string;
  currency: string;
  quantity: number;
  currentPrice: number;
  currentValue: number;
  currentWeight: number;
  targetWeight: number | null;
  targetValue: number | null;
  diffValue: number | null;
  sharesToTrade: number | null;
  action: "BUY" | "SELL" | "HOLD" | null;
}

interface RebalancePlan {
  portfolioId: number;
  totalValue: number;
  cashBalance: number;
  holdingsValue: number;
  currentCashWeight: number;
  cashTargetWeight: number;
  sumTargetWeights: number;
  holdings: RebalanceHolding[];
  baseCurrency: string;
}

async function fetchRebalancePlan(portfolioId: number): Promise<RebalancePlan> {
  const res = await fetch(`/api/portfolios/${portfolioId}/rebalance`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch rebalance plan");
  return res.json();
}

async function saveWeights(portfolioId: number, weights: Array<{ holdingId: number; targetWeight: number | null }>) {
  const res = await fetch(`/api/portfolios/${portfolioId}/rebalance/weights`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weights }),
  });
  if (!res.ok) throw new Error("Failed to save target weights");
  return res.json();
}

function ActionBadge({ action }: { action: "BUY" | "SELL" | "HOLD" | null }) {
  if (!action) return <span className="text-muted-foreground text-xs">—</span>;
  if (action === "BUY") return (
    <Badge variant="outline" className="border-green-600 text-green-500 gap-1 text-xs">
      <TrendingUp className="w-3 h-3" /> BUY
    </Badge>
  );
  if (action === "SELL") return (
    <Badge variant="outline" className="border-red-600 text-red-500 gap-1 text-xs">
      <TrendingDown className="w-3 h-3" /> SELL
    </Badge>
  );
  return (
    <Badge variant="outline" className="border-slate-600 text-slate-400 gap-1 text-xs">
      <Minus className="w-3 h-3" /> HOLD
    </Badge>
  );
}

function AllocationBar({ holdings, cash, baseCurrency }: {
  holdings: Array<{ symbol: string; currentWeight: number; targetWeight: number | null }>;
  cash: { currentWeight: number; targetWeight: number };
  baseCurrency: string;
}) {
  const COLORS = [
    "#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
    "#06b6d4", "#f97316", "#ec4899", "#84cc16", "#6366f1",
  ];

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Current Allocation</div>
      <div className="flex h-5 rounded-full overflow-hidden gap-px">
        {holdings.map((h, i) => (
          <div
            key={h.symbol}
            style={{ width: `${h.currentWeight}%`, background: COLORS[i % COLORS.length] }}
            title={`${h.symbol}: ${h.currentWeight.toFixed(1)}%`}
            className="transition-all duration-300"
          />
        ))}
        {cash.currentWeight > 0 && (
          <div
            style={{ width: `${cash.currentWeight}%`, background: "#475569" }}
            title={`Cash: ${cash.currentWeight.toFixed(1)}%`}
            className="transition-all"
          />
        )}
      </div>

      <div className="flex flex-wrap gap-3 pt-1">
        {holdings.map((h, i) => (
          <div key={h.symbol} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="text-xs text-muted-foreground">{h.symbol}</span>
            <span className="text-xs font-mono font-medium">{h.currentWeight.toFixed(1)}%</span>
          </div>
        ))}
        {cash.currentWeight > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0 bg-slate-500" />
            <span className="text-xs text-muted-foreground">Cash</span>
            <span className="text-xs font-mono font-medium">{cash.currentWeight.toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function RebalanceTab({ portfolioId, baseCurrency }: { portfolioId: number; baseCurrency: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<RebalancePlan>({
    queryKey: ["rebalance", portfolioId],
    queryFn: () => fetchRebalancePlan(portfolioId),
    staleTime: 2 * 60 * 1000,
    enabled: !!portfolioId,
  });

  // Local editable weights: holdingId → string (for input)
  const [localWeights, setLocalWeights] = useState<Record<number, string>>({});
  const [isDirty, setIsDirty] = useState(false);

  // Seed local weights when data loads
  useEffect(() => {
    if (data) {
      const initial: Record<number, string> = {};
      for (const h of data.holdings) {
        initial[h.holdingId] = h.targetWeight != null ? String(h.targetWeight) : "";
      }
      setLocalWeights(initial);
      setIsDirty(false);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (weights: Array<{ holdingId: number; targetWeight: number | null }>) =>
      saveWeights(portfolioId, weights),
    onSuccess: () => {
      toast({ title: "Target weights saved" });
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["rebalance", portfolioId] });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  function handleWeightChange(holdingId: number, value: string) {
    setLocalWeights(prev => ({ ...prev, [holdingId]: value }));
    setIsDirty(true);
  }

  function handleSave() {
    if (!data) return;
    const weights = data.holdings.map(h => {
      const raw = localWeights[h.holdingId] ?? "";
      const parsed = parseFloat(raw);
      return {
        holdingId: h.holdingId,
        targetWeight: raw === "" || isNaN(parsed) ? null : Math.max(0, Math.min(100, parsed)),
      };
    });
    saveMutation.mutate(weights);
  }

  // Compute local sums to show live feedback
  const localSum = data
    ? data.holdings.reduce((sum, h) => {
        const raw = localWeights[h.holdingId] ?? "";
        const parsed = parseFloat(raw);
        return sum + (raw === "" || isNaN(parsed) ? 0 : parsed);
      }, 0)
    : 0;
  const overAllocated = localSum > 100.001;

  // Compute live plan from local weights
  const livePlan = data
    ? data.holdings.map(h => {
        const raw = localWeights[h.holdingId] ?? "";
        const parsed = parseFloat(raw);
        const targetWeight = raw === "" || isNaN(parsed) ? null : parsed;
        const targetValue = targetWeight != null ? (targetWeight / 100) * data.totalValue : null;
        const diffValue = targetValue != null ? targetValue - h.currentValue : null;
        let sharesToTrade: number | null = null;
        let action: "BUY" | "SELL" | "HOLD" | null = null;
        if (diffValue != null) {
          if (Math.abs(diffValue) < 0.01) { action = "HOLD"; sharesToTrade = 0; }
          else if (diffValue > 0) { action = "BUY"; sharesToTrade = h.currentPrice > 0 ? diffValue / h.currentPrice : 0; }
          else { action = "SELL"; sharesToTrade = h.currentPrice > 0 ? Math.abs(diffValue) / h.currentPrice : 0; }
        }
        return { ...h, targetWeight, targetValue, diffValue, sharesToTrade, action };
      })
    : [];

  const totalBuys = livePlan.filter(r => r.action === "BUY").reduce((s, r) => s + Math.abs(r.diffValue ?? 0), 0);
  const totalSells = livePlan.filter(r => r.action === "SELL").reduce((s, r) => s + Math.abs(r.diffValue ?? 0), 0);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data) return (
    <div className="text-center text-sm text-muted-foreground py-12">Failed to load rebalance data.</div>
  );

  if (data.holdings.length === 0) return (
    <div className="text-center text-sm text-muted-foreground py-12">
      No holdings in this portfolio yet. Add holdings to use the rebalancing tool.
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Value</div>
          <div className="text-base font-bold font-mono">{formatCurrency(data.totalValue, baseCurrency)}</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">Cash</div>
          <div className="text-base font-bold font-mono">{formatCurrency(data.cashBalance, baseCurrency)}</div>
          <div className="text-xs text-muted-foreground">{data.currentCashWeight.toFixed(1)}% of portfolio</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">To Buy</div>
          <div className="text-base font-bold font-mono text-green-500">
            {totalBuys > 0 ? formatCurrency(totalBuys, baseCurrency) : "—"}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-xs text-muted-foreground mb-1">To Sell</div>
          <div className="text-base font-bold font-mono text-red-400">
            {totalSells > 0 ? formatCurrency(totalSells, baseCurrency) : "—"}
          </div>
        </div>
      </div>

      {/* Allocation bar */}
      <div className="bg-card border border-border rounded-lg p-4">
        <AllocationBar
          holdings={data.holdings.map(h => ({
            symbol: h.symbol,
            currentWeight: h.currentWeight,
            targetWeight: h.targetWeight,
          }))}
          cash={{ currentWeight: data.currentCashWeight, targetWeight: data.cashTargetWeight }}
          baseCurrency={baseCurrency}
        />
      </div>

      {/* Over-allocated warning */}
      {overAllocated && (
        <div className="flex items-center gap-2 rounded-md border border-amber-600/40 bg-amber-600/10 px-4 py-3 text-sm text-amber-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Target weights sum to {localSum.toFixed(1)}% — exceeds 100%. Reduce weights before saving.
        </div>
      )}

      {/* Actions toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Target allocation total:</span>
          <span className={cn("font-mono font-semibold", overAllocated ? "text-amber-400" : localSum > 0 ? "text-foreground" : "text-muted-foreground")}>
            {localSum.toFixed(1)}%
          </span>
          {!overAllocated && localSum > 0 && (
            <span className="text-muted-foreground">({(100 - localSum).toFixed(1)}% → Cash)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} className="h-8 w-8" title="Refresh Prices">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || overAllocated || saveMutation.isPending}
            className="gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saveMutation.isPending ? "Saving..." : "Save Targets"}
          </Button>
        </div>
      </div>

      {/* Rebalance table */}
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider sticky left-0 bg-card z-10 shadow-[1px_0_0_hsl(var(--border))]">Symbol</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Value</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Current %</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Target %</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Target Value</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Difference</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Shares</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {livePlan.map(row => {
              const weightOver = (parseFloat(localWeights[row.holdingId] ?? "0") || 0) > 100;
              return (
                <tr key={row.holdingId} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 sticky left-0 bg-card z-10 shadow-[1px_0_0_hsl(var(--border))]">
                    <div className="font-semibold">{row.symbol}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[140px]">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.market}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(row.currentValue, row.currency)}
                    <div className="text-xs text-muted-foreground">× {formatNumber(row.quantity, 2)} shares</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {row.currentWeight.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={localWeights[row.holdingId] ?? ""}
                        onChange={e => handleWeightChange(row.holdingId, e.target.value)}
                        placeholder="—"
                        className={cn(
                          "w-20 h-7 text-xs text-center font-mono px-2",
                          weightOver && "border-amber-600 focus-visible:ring-amber-600"
                        )}
                      />
                      <span className="ml-1 text-xs text-muted-foreground">%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {row.targetValue != null ? formatCurrency(row.targetValue, row.currency) : "—"}
                  </td>
                  <td className={cn("px-4 py-3 text-right font-mono font-medium", row.diffValue != null ? cnValue(row.diffValue) : "text-muted-foreground")}>
                    {row.diffValue != null
                      ? `${row.diffValue >= 0 ? "+" : ""}${formatCurrency(Math.abs(row.diffValue), row.currency)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {row.sharesToTrade != null && row.sharesToTrade !== 0
                      ? formatNumber(row.sharesToTrade, 4)
                      : row.action === "HOLD" ? <span className="text-muted-foreground text-xs">on target</span> : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ActionBadge action={row.action} />
                  </td>
                </tr>
              );
            })}
            {/* Cash row */}
            <tr className="bg-muted/10 text-muted-foreground">
              <td className="px-4 py-3">
                <div className="font-medium text-sm">Cash</div>
                <div className="text-xs">{baseCurrency}</div>
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(data.cashBalance, baseCurrency)}</td>
              <td className="px-4 py-3 text-right font-mono text-sm">{data.currentCashWeight.toFixed(2)}%</td>
              <td className="px-4 py-3 text-center font-mono text-sm">
                {data.cashTargetWeight > 0 ? `${(100 - localSum).toFixed(1)}%` : "—"}
              </td>
              <td colSpan={4} className="px-4 py-3 text-xs text-muted-foreground text-center">
                Remainder after holdings allocation
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Target weights are computed on total portfolio value including cash. Prices are live — click Refresh Prices for latest quotes. Shares to trade are estimates; actual execution depends on your broker.
      </p>
    </div>
  );
}

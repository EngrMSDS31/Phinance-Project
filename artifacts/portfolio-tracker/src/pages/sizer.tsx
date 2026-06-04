import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useListPortfolios } from "@workspace/api-client-react";
import { Plus, Trash2, Calculator, Zap, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type Method = "EQUAL" | "CUSTOM" | "RISK";

type Position = {
  id: string;
  symbol: string;
  name: string;
  market: string;
  allocationPct: string;
  stopLossPct: string;
};

type CalcResult = {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  price: number | null;
  allocationPct: number;
  stopLossPct: number | null;
  dollarAmount: number;
  shares: number | null;
  actualCost: number | null;
  priceFound: boolean;
};

type CalcResponse = {
  results: CalcResult[];
  totalCost: number;
  remainingCash: number;
  cash: number;
  method: Method;
};

const MARKET_OPTIONS = ["US", "LSE", "PSE", "CRYPTO", "CUSTOM"];
const METHOD_LABELS: Record<Method, { label: string; desc: string }> = {
  EQUAL:  { label: "Equal Weight",  desc: "Split cash evenly across all positions" },
  CUSTOM: { label: "Custom %",      desc: "Assign a specific allocation % to each position" },
  RISK:   { label: "Risk-Based",    desc: "Size by max $ risk per trade using your stop loss %" },
};

function uid() { return Math.random().toString(36).slice(2); }

function fmt(n: number | null, digits = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtC(n: number | null, currency = "USD") {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

async function apiFetch(path: string, body: unknown) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

export default function Sizer() {
  const { toast } = useToast();
  const { data: portfolios = [] } = useListPortfolios();

  const [method, setMethod] = useState<Method>("EQUAL");
  const [cash, setCash] = useState("5000");
  const [riskPct, setRiskPct] = useState("1");
  const [portfolioValue, setPortfolioValue] = useState("");
  const [portfolioId, setPortfolioId] = useState("");
  const [fractional, setFractional] = useState(true);
  const [positions, setPositions] = useState<Position[]>([
    { id: uid(), symbol: "", name: "", market: "US", allocationPct: "", stopLossPct: "5" },
  ]);
  const [result, setResult] = useState<CalcResponse | null>(null);

  const calcMutation = useMutation({
    mutationFn: (body: unknown) => apiFetch("/sizer/calculate", body),
    onSuccess: (data: CalcResponse) => setResult(data),
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const execMutation = useMutation({
    mutationFn: (body: unknown) => apiFetch("/sizer/execute", body),
    onSuccess: (data: { created: number }) => {
      toast({ title: `${data.created} trade(s) executed and recorded` });
      setResult(null);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  function addPosition() {
    setPositions(prev => [...prev, { id: uid(), symbol: "", name: "", market: "US", allocationPct: "", stopLossPct: "5" }]);
    setResult(null);
  }

  function removePosition(id: string) {
    setPositions(prev => prev.filter(p => p.id !== id));
    setResult(null);
  }

  function updatePosition(id: string, field: keyof Position, value: string) {
    setPositions(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
    setResult(null);
  }

  const totalCustomPct = positions.reduce((s, p) => s + (parseFloat(p.allocationPct) || 0), 0);
  const customPctValid = method !== "CUSTOM" || Math.abs(totalCustomPct - 100) < 0.01;

  function handleCalculate() {
    const validPositions = positions.filter(p => p.symbol.trim());
    if (!validPositions.length || !cash) return;
    calcMutation.mutate({
      cash: parseFloat(cash),
      method,
      portfolioId: portfolioId || null,
      positions: validPositions.map(p => ({
        symbol: p.symbol.trim().toUpperCase(),
        name: p.name || p.symbol.trim().toUpperCase(),
        market: p.market,
        allocationPct: parseFloat(p.allocationPct) || 0,
        stopLossPct: parseFloat(p.stopLossPct) || 5,
      })),
      riskPct: parseFloat(riskPct) || 1,
      portfolioValue: parseFloat(portfolioValue) || parseFloat(cash),
    });
  }

  function handleExecute() {
    if (!portfolioId || !result) return;
    const trades = result.results
      .filter(r => r.shares && r.shares > 0 && r.price)
      .map(r => ({
        symbol: r.symbol,
        name: r.name,
        market: r.market,
        price: r.price,
        shares: fractional ? r.shares : Math.floor(r.shares ?? 0),
        dollarAmount: r.dollarAmount,
        currency: r.currency,
      }));
    execMutation.mutate({ portfolioId: parseInt(portfolioId), trades });
  }

  const canCalculate = positions.some(p => p.symbol.trim()) && parseFloat(cash) > 0 && customPctValid;
  const canExecute = !!result && !!portfolioId && result.results.some(r => r.shares && r.shares > 0);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Position Sizer</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
          Calculate exact share counts to deploy fresh capital — equal weight, custom allocation, or risk-based sizing
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel — inputs */}
        <div className="lg:col-span-1 space-y-5">
          {/* Method selector */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sizing Method</Label>
            <div className="space-y-2">
              {(["EQUAL", "CUSTOM", "RISK"] as Method[]).map(m => (
                <button
                  key={m}
                  onClick={() => { setMethod(m); setResult(null); }}
                  className={cn(
                    "w-full text-left rounded-md px-3 py-2.5 border transition-all",
                    method === m
                      ? "border-blue-500/60 bg-blue-500/10"
                      : "border-border hover:border-border/80 hover:bg-muted/20"
                  )}
                >
                  <div className="text-sm font-medium">{METHOD_LABELS[m].label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{METHOD_LABELS[m].desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Capital settings */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Capital Settings</Label>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Cash to deploy</Label>
                <Input
                  type="number"
                  placeholder="5000"
                  value={cash}
                  onChange={e => { setCash(e.target.value); setResult(null); }}
                  className="font-mono"
                />
              </div>
              {method === "RISK" && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Portfolio total value (for risk calc)</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 50000"
                      value={portfolioValue}
                      onChange={e => { setPortfolioValue(e.target.value); setResult(null); }}
                      className="font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Max risk per trade (% of portfolio)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder="1"
                        step="0.1"
                        min="0.1"
                        max="10"
                        value={riskPct}
                        onChange={e => { setRiskPct(e.target.value); setResult(null); }}
                        className="font-mono"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Position size = (Portfolio × {riskPct || "1"}%) ÷ stop loss %
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Execution settings */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Execution</Label>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Record trades in portfolio</Label>
              <Select value={portfolioId} onValueChange={setPortfolioId}>
                <SelectTrigger><SelectValue placeholder="Optional — select portfolio" /></SelectTrigger>
                <SelectContent>
                  {(portfolios as any[]).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Fractional shares</div>
                <div className="text-xs text-muted-foreground">Allow partial shares (crypto, US)</div>
              </div>
              <button
                onClick={() => setFractional(f => !f)}
                className={cn(
                  "w-10 h-5 rounded-full relative transition-colors",
                  fractional ? "bg-blue-500" : "bg-muted"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                  fractional ? "translate-x-5" : "translate-x-0.5"
                )} />
              </button>
            </div>
          </div>
        </div>

        {/* Right panel — positions + results */}
        <div className="lg:col-span-2 space-y-5">
          {/* Position builder */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-medium">Positions</span>
              {method === "CUSTOM" && (
                <span className={cn("text-xs font-mono", Math.abs(totalCustomPct - 100) < 0.01 ? "text-emerald-400" : totalCustomPct > 100 ? "text-red-400" : "text-amber-400")}>
                  {totalCustomPct.toFixed(1)}% allocated
                  {Math.abs(totalCustomPct - 100) < 0.01 && " ✓"}
                </span>
              )}
              <Button size="sm" variant="outline" onClick={addPosition} className="gap-1 h-7 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>

            <div className="divide-y divide-border">
              {positions.map((pos, i) => (
                <div key={pos.id} className="px-4 py-3 flex items-center gap-2">
                  <div className="text-xs text-muted-foreground w-5 text-center">{i + 1}</div>
                  <Input
                    placeholder="AAPL"
                    value={pos.symbol}
                    onChange={e => updatePosition(pos.id, "symbol", e.target.value.toUpperCase())}
                    className="font-mono h-8 text-sm w-24"
                  />
                  <Input
                    placeholder="Name (optional)"
                    value={pos.name}
                    onChange={e => updatePosition(pos.id, "name", e.target.value)}
                    className="h-8 text-sm flex-1 min-w-0"
                  />
                  <Select value={pos.market} onValueChange={v => updatePosition(pos.id, "market", v)}>
                    <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MARKET_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {method === "CUSTOM" && (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        placeholder="%"
                        value={pos.allocationPct}
                        onChange={e => updatePosition(pos.id, "allocationPct", e.target.value)}
                        className="font-mono h-8 text-sm w-16 text-center"
                        min="0" max="100" step="0.1"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  )}
                  {method === "RISK" && (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        placeholder="SL%"
                        value={pos.stopLossPct}
                        onChange={e => updatePosition(pos.id, "stopLossPct", e.target.value)}
                        className="font-mono h-8 text-sm w-16 text-center"
                        min="0.1" max="100" step="0.1"
                      />
                      <span className="text-xs text-muted-foreground">SL%</span>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removePosition(pos.id)}
                    disabled={positions.length === 1}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-border flex items-center justify-between">
              {method === "CUSTOM" && !customPctValid && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Allocations must sum to exactly 100%
                </div>
              )}
              {method === "RISK" && (
                <div className="text-xs text-muted-foreground">
                  Formula: ({riskPct || "1"}% × portfolio) ÷ stop loss %
                </div>
              )}
              {method === "EQUAL" && (
                <div className="text-xs text-muted-foreground">
                  Each position: {positions.filter(p => p.symbol).length > 0
                    ? `${(100 / positions.filter(p => p.symbol).length).toFixed(1)}%`
                    : "—"
                  } of ${parseFloat(cash || "0").toLocaleString()}
                </div>
              )}
              <Button
                onClick={handleCalculate}
                disabled={!canCalculate || calcMutation.isPending}
                className="gap-2 ml-auto"
              >
                {calcMutation.isPending
                  ? <><RefreshCw className="h-4 w-4 animate-spin" /> Fetching prices...</>
                  : <><Calculator className="h-4 w-4" /> Calculate</>
                }
              </Button>
            </div>
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* Summary strip */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-card border border-border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Cash to deploy</div>
                  <div className="text-lg font-bold font-mono">${parseFloat(cash).toLocaleString()}</div>
                </div>
                <div className="bg-card border border-border rounded-lg p-3">
                  <div className="text-xs text-muted-foreground">Total trade cost</div>
                  <div className="text-lg font-bold font-mono text-blue-400">{fmtC(result.totalCost)}</div>
                </div>
                <div className={cn("bg-card border rounded-lg p-3", result.remainingCash < 0 ? "border-red-500/40" : "border-border")}>
                  <div className="text-xs text-muted-foreground">Remaining cash</div>
                  <div className={cn("text-lg font-bold font-mono", result.remainingCash < 0 ? "text-red-400" : "text-emerald-400")}>
                    {fmtC(result.remainingCash)}
                  </div>
                </div>
              </div>

              {/* Results table */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-sm font-medium">Trade Plan</span>
                  <div className="flex items-center gap-2">
                    {!fractional && <span className="text-xs text-muted-foreground">Whole shares only</span>}
                    <Badge variant="secondary" className="text-xs">{METHOD_LABELS[result.method].label}</Badge>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Symbol</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Price</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Allocation</th>
                      {result.method === "RISK" && (
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Stop Loss</th>
                      )}
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Dollar Amt</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Shares</th>
                      <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((r, i) => {
                      const shares = fractional ? r.shares : (r.shares != null ? Math.floor(r.shares) : null);
                      const cost = shares != null && r.price != null ? shares * r.price : null;
                      return (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-mono font-semibold">{r.symbol}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[120px]">{r.name}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {r.priceFound
                              ? fmtC(r.price, r.currency)
                              : <span className="text-amber-400 text-xs">No price</span>
                            }
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {fmt(r.allocationPct)}%
                          </td>
                          {result.method === "RISK" && (
                            <td className="px-4 py-3 text-right font-mono text-sm text-red-400">
                              {r.stopLossPct != null ? `${fmt(r.stopLossPct)}%` : "—"}
                            </td>
                          )}
                          <td className="px-4 py-3 text-right font-mono text-sm">{fmtC(r.dollarAmount)}</td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                            {shares != null ? (
                              <span className={shares > 0 ? "text-foreground" : "text-muted-foreground"}>
                                {fractional ? fmt(shares, 6) : shares.toLocaleString()}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-blue-400">
                            {cost != null ? fmtC(cost, r.currency) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Execute button */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground max-w-sm">
                  {portfolioId
                    ? "Clicking Execute will record these as BUY transactions and deduct from your cash balance."
                    : "Select a portfolio above to record these trades."}
                </p>
                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={handleCalculate} className="gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Recalculate
                  </Button>
                  <Button
                    onClick={handleExecute}
                    disabled={!canExecute || execMutation.isPending}
                    className="gap-2"
                  >
                    {execMutation.isPending
                      ? <><RefreshCw className="h-4 w-4 animate-spin" /> Executing...</>
                      : <><Zap className="h-4 w-4" /> Execute Trades</>
                    }
                  </Button>
                </div>
              </div>

              {execMutation.isSuccess && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  Trades recorded successfully in your portfolio.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

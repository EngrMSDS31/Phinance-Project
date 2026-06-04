import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useListPortfolios } from "@workspace/api-client-react";
import { formatDistanceToNow, format, parseISO, isPast, isToday } from "date-fns";
import { Plus, Play, Pause, Trash2, RefreshCw, CalendarClock, TrendingUp, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

type Plan = {
  id: number;
  symbol: string;
  name: string;
  market: string;
  frequency: string;
  investAmount: string;
  currency: string;
  nextRunDate: string;
  lastRunDate: string | null;
  isActive: boolean;
  notes: string | null;
  portfolioId: number;
  portfolioName: string;
  status: "UPCOMING" | "DUE_TODAY" | "OVERDUE" | "PAUSED";
};

const FREQ_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
};

const MARKET_OPTIONS = ["US", "LSE", "PSE", "CRYPTO", "CUSTOM"] as const;
const FREQ_OPTIONS = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"] as const;
const CURRENCIES = ["USD", "GBP", "EUR", "PHP", "JPY", "SGD", "HKD", "CAD", "AUD", "CHF", "CNY", "INR"];

function statusBadge(status: Plan["status"]) {
  switch (status) {
    case "OVERDUE":   return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px]">Overdue</Badge>;
    case "DUE_TODAY": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">Due Today</Badge>;
    case "UPCOMING":  return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">Upcoming</Badge>;
    case "PAUSED":    return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-[10px]">Paused</Badge>;
  }
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

const defaultForm = {
  symbol: "",
  name: "",
  market: "US",
  portfolioId: "",
  frequency: "MONTHLY",
  investAmount: "",
  currency: "USD",
  nextRunDate: new Date().toISOString().slice(0, 10),
  notes: "",
};

export default function Recurring() {
  const qc = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ ...defaultForm });
  const [execError, setExecError] = useState<Record<number, string>>({});
  const [executing, setExecuting] = useState<number | null>(null);

  const { data: portfolios = [] } = useListPortfolios();
  const { data: plans = [], isLoading } = useQuery<Plan[]>({
    queryKey: ["recurring"],
    queryFn: () => apiFetch("/recurring"),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/recurring", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurring"] }); setShowDialog(false); setForm({ ...defaultForm }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/recurring/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/recurring/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });

  async function executePlan(id: number) {
    setExecuting(id);
    setExecError(prev => ({ ...prev, [id]: "" }));
    try {
      await apiFetch(`/recurring/${id}/execute`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["recurring"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e: any) {
      setExecError(prev => ({ ...prev, [id]: e.message }));
    } finally {
      setExecuting(null);
    }
  }

  function handleCreate() {
    if (!form.symbol || !form.name || !form.portfolioId || !form.investAmount) return;
    createMutation.mutate({
      symbol: form.symbol,
      name: form.name,
      market: form.market,
      portfolioId: parseInt(form.portfolioId),
      frequency: form.frequency,
      investAmount: parseFloat(form.investAmount),
      currency: form.currency,
      nextRunDate: form.nextRunDate,
      notes: form.notes || null,
    });
  }

  // Stats
  const active = plans.filter(p => p.isActive);
  const dueCount = plans.filter(p => p.status === "DUE_TODAY" || p.status === "OVERDUE").length;
  const monthlyTotal = active.reduce((sum, p) => {
    const amt = parseFloat(p.investAmount);
    switch (p.frequency) {
      case "WEEKLY":    return sum + amt * 4.33;
      case "BIWEEKLY":  return sum + amt * 2.17;
      case "MONTHLY":   return sum + amt;
      case "QUARTERLY": return sum + amt / 3;
      default:          return sum + amt;
    }
  }, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Investment Plans</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">Recurring buy schedules with one-click execution</p>
        </div>
        <Button onClick={() => setShowDialog(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Plan
        </Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-blue-500/10 flex items-center justify-center">
            <CalendarClock className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Active Plans</div>
            <div className="text-xl font-semibold">{active.length}</div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-emerald-500/10 flex items-center justify-center">
            <Wallet className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Est. Monthly Deploy</div>
            <div className="text-xl font-semibold">${monthlyTotal.toFixed(0)}</div>
          </div>
        </div>
        <div className={cn("bg-card border border-border rounded-lg p-4 flex items-center gap-3", dueCount > 0 && "border-amber-500/40")}>
          <div className={cn("h-9 w-9 rounded-md flex items-center justify-center", dueCount > 0 ? "bg-amber-500/10" : "bg-slate-500/10")}>
            <TrendingUp className={cn("h-4 w-4", dueCount > 0 ? "text-amber-400" : "text-slate-400")} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Due / Overdue</div>
            <div className={cn("text-xl font-semibold", dueCount > 0 ? "text-amber-400" : "")}>{dueCount}</div>
          </div>
        </div>
      </div>

      {/* Plans list */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Loading plans...</div>
        ) : plans.length === 0 ? (
          <div className="p-12 text-center">
            <CalendarClock className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <div className="text-sm text-muted-foreground">No investment plans yet</div>
            <div className="text-xs text-muted-foreground mt-1">Create a recurring buy schedule and execute it with one click</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Symbol</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Portfolio</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Frequency</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Next Run</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Last Run</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(plan => (
                <tr key={plan.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold">{plan.symbol}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[120px]">{plan.name}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground max-w-[130px] truncate">{plan.portfolioName}</td>
                  <td className="px-4 py-3 text-sm">{FREQ_LABELS[plan.frequency] ?? plan.frequency}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span className="text-xs text-muted-foreground mr-1">{plan.currency}</span>
                    {parseFloat(plan.investAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={cn(
                      plan.status === "OVERDUE" ? "text-red-400" :
                      plan.status === "DUE_TODAY" ? "text-amber-400" : "text-muted-foreground"
                    )}>
                      {format(parseISO(plan.nextRunDate), "MMM d, yyyy")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {plan.lastRunDate ? formatDistanceToNow(parseISO(plan.lastRunDate), { addSuffix: true }) : "Never"}
                  </td>
                  <td className="px-4 py-3">{statusBadge(plan.status)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {execError[plan.id] && (
                        <span className="text-xs text-red-400 mr-1">{execError[plan.id]}</span>
                      )}
                      {plan.isActive && (
                        <Button
                          size="sm"
                          variant={plan.status === "UPCOMING" ? "outline" : "default"}
                          className={cn(
                            "h-7 px-2.5 text-xs gap-1",
                            plan.status === "OVERDUE" && "bg-red-500/80 hover:bg-red-500",
                            plan.status === "DUE_TODAY" && "bg-amber-500/80 hover:bg-amber-500",
                          )}
                          onClick={() => executePlan(plan.id)}
                          disabled={executing === plan.id}
                        >
                          {executing === plan.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                          Execute
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        title={plan.isActive ? "Pause plan" : "Resume plan"}
                        onClick={() => toggleMutation.mutate({ id: plan.id, isActive: !plan.isActive })}
                      >
                        {plan.isActive
                          ? <Pause className="h-3.5 w-3.5 text-muted-foreground" />
                          : <Play className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => { if (confirm(`Delete plan for ${plan.symbol}?`)) deleteMutation.mutate(plan.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Investment Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Symbol</Label>
                <Input
                  placeholder="AAPL"
                  value={form.symbol}
                  onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Market</Label>
                <Select value={form.market} onValueChange={v => setForm(f => ({ ...f, market: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MARKET_OPTIONS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="Apple Inc."
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Portfolio</Label>
              <Select value={form.portfolioId} onValueChange={v => setForm(f => ({ ...f, portfolioId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select portfolio" /></SelectTrigger>
                <SelectContent>
                  {(portfolios as any[]).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQ_OPTIONS.map(freq => (
                      <SelectItem key={freq} value={freq}>{FREQ_LABELS[freq]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount per run</Label>
                <Input
                  type="number"
                  placeholder="500"
                  min="0"
                  step="any"
                  value={form.investAmount}
                  onChange={e => setForm(f => ({ ...f, investAmount: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>First run date</Label>
                <Input
                  type="date"
                  value={form.nextRunDate}
                  onChange={e => setForm(f => ({ ...f, nextRunDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea
                placeholder="Dollar-cost averaging strategy..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !form.symbol || !form.name || !form.portfolioId || !form.investAmount}
            >
              {createMutation.isPending ? "Creating..." : "Create Plan"}
            </Button>
          </DialogFooter>
          {createMutation.isError && (
            <p className="text-xs text-red-400 mt-1">{(createMutation.error as Error).message}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

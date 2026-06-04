import { useState, useEffect, useRef, useMemo } from "react";
import {
  useGetDashboardSummary, useGetDashboardAllocation, useGetUpcomingDividends,
  useListPortfolios, useListHoldings, useCreateTransaction, useSearchSymbols,
  getGetDashboardSummaryQueryKey, getGetDashboardAllocationQueryKey,
  getListHoldingsQueryKey, getListTransactionsQueryKey,
} from "@workspace/api-client-react";
import { formatPercent, cnValue } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useFx } from "@/lib/fx-context";
import { computePortfolioMetrics } from "@/lib/portfolioEngine";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, RefreshCw, Search, X, ChevronLeft } from "lucide-react";
import { useQueryClient, useQueries } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { TxFormSummary } from "@/components/tx-form-summary";
import { usePrivacy } from "@/lib/privacy-context";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
type DashSymbol = { id?: number; symbol: string; name: string; market: string };

function DashboardAddTransactionDialog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"portfolio" | "form">("portfolio");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const { data: portfolios } = useListPortfolios();
  const { data: holdings } = useListHoldings(selectedPortfolioId ?? 0, { query: { enabled: !!selectedPortfolioId } as any });
  const selectedPortfolio = portfolios?.find(p => p.id === selectedPortfolioId);
  const createTx = useCreateTransaction();

  // Portfolio rates (support 4dp)
  const portfolioFeeRate = selectedPortfolio ? (selectedPortfolio.defaultFeeRate ?? 0) : 0;
  const portfolioTaxRate = selectedPortfolio ? (selectedPortfolio.defaultTaxRate ?? 0) : 0;

  // Symbol search
  const [selectedSymbol, setSelectedSymbol] = useState<DashSymbol | null>(null);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Transaction fields
  const [txType, setTxType] = useState("BUY");
  const [txDate, setTxDate] = useState(new Date().toISOString().split("T")[0]);
  const [txQty, setTxQty] = useState("");
  const [txPrice, setTxPrice] = useState("");
  const [txFeeAmt, setTxFeeAmt] = useState("");
  const [txTaxAmt, setTxTaxAmt] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [txCurrency, setTxCurrency] = useState("USD");
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  const [priceStatus, setPriceStatus] = useState<"live" | "delayed" | "lastclose" | "unavailable" | null>(null);
  const [priceLabel, setPriceLabel] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(symbolQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [symbolQuery]);

  const searchMarket = selectedPortfolio?.type && selectedPortfolio.type !== "MIXED" ? selectedPortfolio.type : undefined;
  const { data: searchResults, isFetching: isSearching } = useSearchSymbols(
    { q: debouncedQuery || "_", ...(searchMarket ? { market: searchMarket as any } : {}) },
    { query: { enabled: debouncedQuery.length >= 1 && showSuggestions && step === "form" } as any }
  );

  const existingMatches = debouncedQuery.length >= 1
    ? (holdings ?? []).filter((h: any) =>
        h.symbol.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        (h.name ?? "").toLowerCase().includes(debouncedQuery.toLowerCase())
      )
    : [];
  const existingSet = new Set(existingMatches.map((h: any) => `${h.symbol}:${h.market}`));
  const liveSuggestions = (searchResults ?? []).filter(r => !existingSet.has(`${r.symbol}:${r.market}`));

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const HOLDING_TYPES_DASH = ["BUY", "SELL", "DIVIDEND", "STOCK_SPLIT", "COUPON_INTEREST", "STAKING_REWARD", "MATURITY", "TRANSFER", "DISTRIBUTION"];
  const needsHolding = HOLDING_TYPES_DASH.includes(txType);
  const needsQtyPrice = txType === "BUY" || txType === "SELL";
  const isTrade = txType === "BUY" || txType === "SELL";
  const isIncome = ["DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION"].includes(txType);
  const isCashType = txType === "CASH_GAIN" || txType === "CASH_EXPENSE";

  const fetchLivePrice = async (sym: DashSymbol) => {
    setIsFetchingPrice(true); setPriceStatus(null); setPriceLabel(null);
    try {
      const res = await fetch(`${BASE_URL}/api/prices?symbols=${sym.symbol}:${sym.market}`, { credentials: "include" });
      if (res.ok) {
        const r = (await res.json() as any[])[0];
        if (r?.price > 0) {
          setTxPrice(r.price.toFixed(4));
          const lbl: string = r.priceLabel ?? (r.isStale ? "Last Price" : "Delayed");
          setPriceLabel(lbl);
          if (lbl === "Live") setPriceStatus("live");
          else if (lbl === "Last Close" || lbl === "Last Price") setPriceStatus("lastclose");
          else setPriceStatus("delayed");
        } else setPriceStatus("unavailable");
      } else setPriceStatus("unavailable");
    } catch { setPriceStatus("unavailable"); }
    finally { setIsFetchingPrice(false); }
  };

  const handleSelectSymbol = (sym: DashSymbol) => {
    setSelectedSymbol(sym); setSymbolQuery(""); setShowSuggestions(false);
    setTxCurrency(selectedPortfolio?.baseCurrency || "USD"); setPriceStatus(null); setPriceLabel(null);
    if (isTrade) fetchLivePrice(sym);
  };

  const handleSelectPortfolio = (id: number) => {
    setSelectedPortfolioId(id);
    const p = portfolios?.find(pp => pp.id === id);
    setTxCurrency(p?.baseCurrency || "USD");
    setStep("form");
  };

  const qty = parseFloat(txQty || "0");
  const pricePerShare = parseFloat(txPrice || "0");
  const subtotal = needsQtyPrice ? qty * pricePerShare : pricePerShare;

  // Auto-calculate fee/tax from portfolio rates
  useEffect(() => {
    if (!open || step !== "form") return;
    if (isTrade && portfolioFeeRate > 0 && subtotal > 0 && !txFeeAmt) {
      setTxFeeAmt((subtotal * portfolioFeeRate / 100).toFixed(4));
    }
    if (isIncome && portfolioTaxRate > 0 && subtotal > 0 && !txTaxAmt) {
      setTxTaxAmt((subtotal * portfolioTaxRate / 100).toFixed(4));
    }
  }, [subtotal, open, step]);

  const feeAmt = parseFloat(txFeeAmt || "0");
  const taxAmt = parseFloat(txTaxAmt || "0");
  const totalAmount = isCashType ? subtotal : subtotal + feeAmt + taxAmt;

  const resetAll = () => {
    setStep("portfolio"); setSelectedPortfolioId(null);
    setSelectedSymbol(null); setSymbolQuery(""); setDebouncedQuery("");
    setTxType("BUY"); setTxDate(new Date().toISOString().split("T")[0]);
    setTxQty(""); setTxPrice(""); setTxFeeAmt(""); setTxTaxAmt(""); setTxNotes("");
    setTxCurrency("USD"); setPriceStatus(null); setPriceLabel(null);
  };

  const handleSubmit = () => {
    if (needsHolding && !selectedSymbol) { toast({ title: "Select a stock or symbol", variant: "destructive" }); return; }
    const amt = totalAmount || pricePerShare || 0;
    if (amt <= 0) { toast({ title: "Enter an amount or qty + price", variant: "destructive" }); return; }

    const payload: any = {
      type: txType, date: txDate,
      quantity: txQty ? parseFloat(txQty) : undefined,
      price: pricePerShare > 0 ? pricePerShare : undefined,
      amount: amt,
      feeAmount: (!isCashType && !isIncome && feeAmt > 0) ? feeAmt : undefined,
      taxAmount: (!isCashType && taxAmt > 0) ? taxAmt : undefined,
      currency: txCurrency,
      notes: txNotes || undefined,
    };
    if (selectedSymbol) {
      if (selectedSymbol.id) { payload.holdingId = selectedSymbol.id; }
      else { payload.holdingId = null; payload.symbol = selectedSymbol.symbol; payload.market = selectedSymbol.market; payload.name = selectedSymbol.name; payload.assetType = "STOCK"; }
    }

    createTx.mutate({ portfolioId: selectedPortfolioId!, data: payload as any }, {
      onSuccess: () => {
        toast({ title: "Transaction added" });
        setOpen(false); resetAll();
        if (selectedPortfolioId) {
          qc.invalidateQueries({ queryKey: getListHoldingsQueryKey(selectedPortfolioId) });
          qc.invalidateQueries({ queryKey: getListTransactionsQueryKey(selectedPortfolioId) });
        }
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getGetDashboardAllocationQueryKey() });
      },
      onError: () => toast({ title: "Failed to add transaction", variant: "destructive" }),
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => { resetAll(); setOpen(true); }}>
        <Plus className="w-4 h-4 mr-2" /> Add Transaction
      </Button>
      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetAll(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {step === "form" && (
                <button onClick={() => setStep("portfolio")} className="text-muted-foreground hover:text-foreground">
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              {step === "portfolio" ? "Add Transaction" : `Add Transaction — ${selectedPortfolio?.name}`}
            </DialogTitle>
          </DialogHeader>

          {step === "portfolio" ? (
            <div className="space-y-2 py-2">
              <p className="text-sm text-muted-foreground mb-3">Select a portfolio:</p>
              {!portfolios?.length && <p className="text-sm text-muted-foreground">No portfolios yet. Create one first.</p>}
              {portfolios?.map(p => (
                <button key={p.id} onClick={() => handleSelectPortfolio(p.id)}
                  className="w-full text-left px-4 py-3 rounded-md border border-border hover:bg-muted/50 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.type} · {p.baseCurrency}
                      {((p.defaultFeeRate ?? 0) > 0) && ` · Fee: ${p.defaultFeeRate}%`}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">›</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Type</label>
                  <Select value={txType} onValueChange={v => { setTxType(v); setPriceStatus(null); setTxFeeAmt(""); setTxTaxAmt(""); }}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Trade</div>
                      <SelectItem value="BUY" className="pl-6">Buy</SelectItem>
                      <SelectItem value="SELL" className="pl-6">Sell</SelectItem>
                      <SelectItem value="DIVIDEND" className="pl-6">Dividend</SelectItem>
                      <SelectItem value="STOCK_SPLIT" className="pl-6">Stock Split</SelectItem>
                      <SelectItem value="DISTRIBUTION" className="pl-6">Distribution</SelectItem>
                      <SelectItem value="COUPON_INTEREST" className="pl-6">Coupon / Interest</SelectItem>
                      <SelectItem value="STAKING_REWARD" className="pl-6">Staking Reward</SelectItem>
                      <SelectItem value="MATURITY" className="pl-6">Maturity</SelectItem>
                      <SelectItem value="TRANSFER" className="pl-6">Transfer</SelectItem>
                      <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border/50 mt-0.5">Cash</div>
                      <SelectItem value="DEPOSIT" className="pl-6">Deposit</SelectItem>
                      <SelectItem value="WITHDRAWAL" className="pl-6">Withdrawal</SelectItem>
                      <SelectItem value="CASH_GAIN" className="pl-6">Other Income</SelectItem>
                      <SelectItem value="CASH_EXPENSE" className="pl-6">Other Expenses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Date</label>
                  <Input type="date" value={txDate} onChange={e => setTxDate(e.target.value)} className="h-9" />
                </div>
              </div>

              {/* Portfolio rate hint */}
              {(isTrade && portfolioFeeRate > 0) && (
                <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
                  Fee: {portfolioFeeRate}% of subtotal will be auto-calculated
                </p>
              )}

              {needsHolding && (
                <div className="space-y-1.5" ref={searchRef}>
                  <label className="text-sm font-medium">Stock / Symbol</label>
                  {selectedSymbol ? (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/30">
                      <span className="font-mono font-semibold text-sm">{selectedSymbol.symbol}</span>
                      <span className="text-muted-foreground text-xs ml-1 truncate flex-1">{selectedSymbol.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{selectedSymbol.market}</span>
                      <button onClick={() => { setSelectedSymbol(null); setSymbolQuery(""); setTxPrice(""); setPriceStatus(null); }}
                        className="text-muted-foreground hover:text-foreground shrink-0 ml-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Type ticker or company name…"
                        value={symbolQuery}
                        onChange={e => { setSymbolQuery(e.target.value); setShowSuggestions(true); }}
                        onFocus={() => setShowSuggestions(true)}
                        className="h-9 pl-8"
                        autoComplete="off"
                      />
                      {isSearching && <RefreshCw className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground animate-spin pointer-events-none" />}
                      {showSuggestions && (existingMatches.length > 0 || liveSuggestions.length > 0) && (
                        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                          {existingMatches.length > 0 && (
                            <>
                              <div className="px-2.5 py-1 text-xs text-muted-foreground bg-muted/40 border-b border-border">In this portfolio</div>
                              {existingMatches.map((h: any) => (
                                <button key={`ex-${h.id}`} className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center gap-2"
                                  onMouseDown={e => { e.preventDefault(); handleSelectSymbol({ id: h.id, symbol: h.symbol, name: h.name, market: h.market }); }}>
                                  <span className="font-mono font-semibold text-sm w-16 shrink-0">{h.symbol}</span>
                                  <span className="text-muted-foreground text-xs truncate flex-1">{h.name}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{h.market}</span>
                                </button>
                              ))}
                            </>
                          )}
                          {liveSuggestions.length > 0 && (
                            <>
                              <div className="px-2.5 py-1 text-xs text-muted-foreground bg-muted/40 border-b border-border border-t">
                                {existingMatches.length > 0 ? "Other matches" : "Search results"}
                              </div>
                              {liveSuggestions.map((s, i) => (
                                <button key={`live-${i}`} className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center gap-2"
                                  onMouseDown={e => { e.preventDefault(); handleSelectSymbol({ symbol: s.symbol, name: s.name, market: s.market }); }}>
                                  <span className="font-mono font-semibold text-sm w-16 shrink-0">{s.symbol}</span>
                                  <span className="text-muted-foreground text-xs truncate flex-1">{s.name}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{s.market}</span>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      )}
                      {showSuggestions && debouncedQuery.length >= 1 && !isSearching && existingMatches.length === 0 && liveSuggestions.length === 0 && (
                        <div className="absolute z-50 top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg px-3 py-3 text-xs text-muted-foreground">
                          No results — try a different symbol or company name
                        </div>
                      )}
                    </div>
                  )}
                  {isFetchingPrice && <p className="text-xs text-muted-foreground flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Fetching price…</p>}
                  {priceStatus && !isFetchingPrice && (
                    <p className={`text-xs flex items-center gap-1 ${priceStatus === "live" ? "text-green-500" : priceStatus === "unavailable" ? "text-muted-foreground" : "text-amber-400"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${priceStatus === "live" ? "bg-green-500" : priceStatus === "unavailable" ? "bg-muted-foreground" : "bg-amber-400"}`} />
                      {priceStatus === "unavailable" ? "Price unavailable — enter manually" : (priceLabel ?? (priceStatus === "live" ? "Live price" : "Last available price"))}
                    </p>
                  )}
                </div>
              )}

              {needsQtyPrice && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Quantity</label>
                    <Input type="number" min="0" step="any" placeholder="0" value={txQty} onChange={e => setTxQty(e.target.value)} className="h-9 font-mono" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Price / Share</label>
                    <Input type="number" min="0" step="any" placeholder="0.00" value={txPrice} onChange={e => setTxPrice(e.target.value)} className="h-9 font-mono" />
                  </div>
                </div>
              )}
              {!needsQtyPrice && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Amount</label>
                  <Input type="number" min="0" step="any" placeholder="0.00" value={txPrice} onChange={e => setTxPrice(e.target.value)} className="h-9 font-mono" />
                </div>
              )}

              {!isCashType && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Fee {isTrade && portfolioFeeRate > 0 && <span className="text-muted-foreground font-normal text-xs">({portfolioFeeRate}%)</span>}
                  </label>
                  <Input type="number" min="0" step="0.0001" placeholder="0.00" value={txFeeAmt} onChange={e => setTxFeeAmt(e.target.value)} className="h-9 font-mono" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Tax {isIncome && portfolioTaxRate > 0 && <span className="text-muted-foreground font-normal text-xs">({portfolioTaxRate}%)</span>}
                  </label>
                  <Input type="number" min="0" step="0.0001" placeholder="0.00" value={txTaxAmt} onChange={e => setTxTaxAmt(e.target.value)} className="h-9 font-mono" />
                </div>
              </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Currency</label>
                <Input placeholder="USD" value={txCurrency} onChange={e => setTxCurrency(e.target.value.toUpperCase())} className="h-9 font-mono uppercase" />
              </div>

              {(isTrade || isIncome) && subtotal > 0 ? (
                <TxFormSummary
                  type={txType}
                  currency={txCurrency}
                  gross={subtotal}
                  fee={isTrade ? feeAmt : 0}
                  tax={taxAmt}
                />
              ) : totalAmount > 0 ? (
                <div className="bg-muted/50 rounded-lg p-3 text-sm flex justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-mono font-semibold">{txCurrency} {totalAmount.toFixed(2)}</span>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Notes</label>
                <Input placeholder="Optional" value={txNotes} onChange={e => setTxNotes(e.target.value)} className="h-9" />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={createTx.isPending}>
                  {createTx.isPending ? "Saving…" : "Add Transaction"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MetricCard({ title, value, subtitle, subtitleNode, valueClass, loading, subtitleClass, highlight }: {
  title: string; value: string; subtitle?: string; subtitleNode?: React.ReactNode; valueClass?: string; loading?: boolean; subtitleClass?: string; highlight?: boolean;
}) {
  const { showAmounts } = usePrivacy();
  const maskedValue = showAmounts ? value : "•••••";
  return (
    <Card className={highlight ? "md:ring-1 md:ring-primary/20" : ""}>
      <CardContent className="p-4 md:pt-8 md:px-6 md:pb-8">
        <div className="text-[10px] md:text-[13px] text-muted-foreground uppercase tracking-wider font-semibold leading-none">{title}</div>
        {loading ? (
          <Skeleton className="h-6 md:h-8 w-24 md:w-36 mt-2" />
        ) : (
          <div className={`text-lg md:text-2xl font-bold leading-tight mt-2 ${valueClass ?? ""}`}>{maskedValue}</div>
        )}
        {subtitleNode && !loading && (
          <div className="text-[10px] md:text-xs mt-1 leading-tight">{showAmounts ? subtitleNode : <span className="text-muted-foreground select-none tracking-widest">••••</span>}</div>
        )}
        {subtitle && !subtitleNode && !loading && (
          <div className={`text-[10px] md:text-xs mt-1 leading-tight ${subtitleClass ?? "text-muted-foreground"}`}>{showAmounts ? subtitle : "••••"}</div>
        )}
      </CardContent>
    </Card>
  );
}

const PIE_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#f97316", "#06b6d4", "#ec4899", "#84cc16", "#6366f1",
];

export default function Dashboard() {
  const { fxFormat, displayCurrency, convert } = useFx();
  const { data: portfolios } = useListPortfolios();

  const params = { targetCurrency: displayCurrency };
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary(params);
  const { data: allocation, isLoading: loadingAllocation } = useGetDashboardAllocation(params);
  const { data: upcomingDividends, isLoading: loadingDividends } = useGetUpcomingDividends();

  const fmt = (v: number) => fxFormat(v, displayCurrency);

  const allPortfolioIds = useMemo(() => portfolios?.map(p => p.id) ?? [], [portfolios]);

  // Fetch holdings + transactions for all portfolios.
  // Uses the same query keys as Analytics so TanStack Query deduplicates the network requests.
  const allHoldingsQueries = useQueries({
    queries: allPortfolioIds.map(id => ({
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
    queries: allPortfolioIds.map(id => ({
      queryKey: ["analytics-all-tx", id],
      queryFn: async () => {
        const r = await fetch(`${BASE_URL}/api/portfolios/${id}/transactions?limit=1000`, { credentials: "include" });
        if (!r.ok) return { items: [] };
        return r.json();
      },
      staleTime: 5 * 60 * 1000,
    })),
  });

  // ── Shared FIFO engine — same function and data as Analytics ─────────────────
  // Guarantees: Dashboard Current Value = Analytics Current Value = Analytics All Portfolios
  const fifoEngine = useMemo(() => {
    const convertFn = (v: number, fromCurrency: string) => convert(v, fromCurrency);

    const holdingEntries: Array<{ holdingId?: number; symbol: string; currentPrice: number; currency: string; txs: any[] }> = [];
    const depositRecords: Array<{ type: "DEPOSIT" | "WITHDRAWAL"; amount: string | number; currency: string }> = [];
    const cashRecords: Array<{ type: "CASH_GAIN" | "CASH_EXPENSE"; amount: string | number; currency: string }> = [];

    allPortfolioIds.forEach((_, i) => {
      const pHoldings = Array.isArray(allHoldingsQueries[i]?.data) ? (allHoldingsQueries[i].data as any[]) : [];
      const currency = portfolios?.[i]?.baseCurrency ?? "USD";
      const pTxItems = (allTxQueries[i]?.data as any)?.items ?? [];

      const HOLDING_TX_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION", "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT"]);
      const FUND_BOND_MARKETS = new Set(["FUNDS", "BONDS"]);

      const txByHoldingId = new Map<number, any[]>();
      pTxItems.forEach((tx: any) => {
        if (!tx.holdingId || !HOLDING_TX_TYPES.has(tx.type)) return;
        if (!txByHoldingId.has(tx.holdingId)) txByHoldingId.set(tx.holdingId, []);
        txByHoldingId.get(tx.holdingId)!.push(tx);
      });

      pHoldings.forEach((h: any) => {
        const holdingTxs = txByHoldingId.get(h.id) ?? [];
        const hasFundTransfer = holdingTxs.some((tx: any) => tx.type === "FUND_TRANSFER_IN" || tx.type === "FUND_TRANSFER_OUT");
        const isFundBond = FUND_BOND_MARKETS.has(h.market) || hasFundTransfer;
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

      pTxItems.forEach((tx: any) => {
        if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") {
          depositRecords.push({ type: tx.type as "DEPOSIT" | "WITHDRAWAL", amount: tx.amount ?? "0", currency });
        } else if (tx.type === "CASH_GAIN" || tx.type === "CASH_EXPENSE") {
          cashRecords.push({ type: tx.type as "CASH_GAIN" | "CASH_EXPENSE", amount: tx.amount ?? "0", currency });
        }
      });
    });

    return computePortfolioMetrics(holdingEntries, depositRecords, convertFn, cashRecords);
  }, [allHoldingsQueries, allTxQueries, portfolios, allPortfolioIds, convert]);

  const fifoLoading = allPortfolioIds.length > 0 && (
    allHoldingsQueries.some(q => q.isLoading) || allTxQueries.some(q => q.isLoading)
  );
  const dashLoading = loadingSummary || fifoLoading;

  // Universal formula: currentValue = totalInvested + totalProfit + cashNet (same identity as Analytics and Portfolio Tab)
  const grandTotal = fifoEngine.totalPortfolioValue;
  const fxTotalCash = grandTotal - fifoEngine.totalCurrentValue;
  const totalGain = fifoEngine.totalProfit;
  const totalDeposited = fifoEngine.totalInvested;
  const totalGainPct = fifoEngine.totalProfitPct ?? 0;
  const returnPct = totalDeposited > 0 ? (totalGain / totalDeposited) * 100 : 0;

  // FX-adjusted allocation — recomputes each portfolio's slice value using the same
  // computePortfolioMetrics engine as fifoEngine, guaranteeing pie chart totals
  // reconcile exactly with the displayed Current Value.
  const fxAdjustedAllocation = useMemo(() => {
    if (!portfolios || !allocation || allPortfolioIds.length === 0) return allocation ?? [];
    if (allHoldingsQueries.some(q => q.isLoading) || allTxQueries.some(q => q.isLoading)) return allocation ?? [];

    const convertFn = (v: number, fromCurrency: string) => convert(v, fromCurrency);

    return allPortfolioIds.map((_, i) => {
      const pf = portfolios[i];
      if (!pf) return null;
      const currency = pf.baseCurrency ?? "USD";
      const pHoldings = (Array.isArray(allHoldingsQueries[i]?.data) ? allHoldingsQueries[i].data : []) as any[];
      const pTxItems = ((allTxQueries[i]?.data as any)?.items ?? []) as any[];

      const _HOLDING_TX_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION", "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT"]);
      const _FUND_BOND_MARKETS = new Set(["FUNDS", "BONDS"]);

      const txByHoldingId = new Map<number, any[]>();
      pTxItems.forEach((tx: any) => {
        if (!tx.holdingId || !_HOLDING_TX_TYPES.has(tx.type)) return;
        if (!txByHoldingId.has(tx.holdingId)) txByHoldingId.set(tx.holdingId, []);
        txByHoldingId.get(tx.holdingId)!.push(tx);
      });

      const holdingEntries = pHoldings.map((h: any) => {
        const holdingTxs = txByHoldingId.get(h.id) ?? [];
        const hasFundTransfer = holdingTxs.some((tx: any) => tx.type === "FUND_TRANSFER_IN" || tx.type === "FUND_TRANSFER_OUT");
        const isFundBond = _FUND_BOND_MARKETS.has(h.market) || hasFundTransfer;
        const entry: any = {
          holdingId: h.id as number,
          symbol: h.symbol as string,
          currentPrice: parseFloat(String(h.currentPrice ?? "0")) || 0,
          currency,
          txs: holdingTxs,
        };
        if (isFundBond) {
          entry.precomputedCurrentValue = parseFloat(String(h.currentValue ?? 0)) || 0;
          entry.precomputedInvested = parseFloat(String(h.avgCostBasis ?? 0)) || 0;
        }
        return entry;
      });

      const depositRecords = pTxItems
        .filter((tx: any) => tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL")
        .map((tx: any) => ({ type: tx.type as "DEPOSIT" | "WITHDRAWAL", amount: tx.amount ?? "0", currency }));

      const pCashRecords = pTxItems
        .filter((tx: any) => tx.type === "CASH_GAIN" || tx.type === "CASH_EXPENSE")
        .map((tx: any) => ({ type: tx.type as "CASH_GAIN" | "CASH_EXPENSE", amount: tx.amount ?? "0", currency }));

      const metrics = computePortfolioMetrics(holdingEntries, depositRecords, convertFn, pCashRecords);

      const apiSlice = (allocation ?? []).find((s: any) => s.portfolioId === pf.id) ?? {};
      return { ...apiSlice, label: pf.name, value: metrics.totalPortfolioValue, currentValue: metrics.totalCurrentValue };
    }).filter(Boolean) as unknown as typeof allocation;
  }, [allocation, portfolios, allPortfolioIds, allHoldingsQueries, allTxQueries, convert]);

  const [activeAllocIdx, setActiveAllocIdx] = useState<number | null>(null);
  const [pieView, setPieView] = useState<"total" | "assets">("total");

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Header — Fix 1: title + subtext matching Dividend Calendar format */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Your portfolio at a glance.</p>
        </div>
        <DashboardAddTransactionDialog />
      </div>

      {/* Fix 3: 2×2 rectangular grid on mobile, 4-col on desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
        <MetricCard
          highlight
          title="Total Portfolio"
          value={fmt(grandTotal)}
          subtitleNode={totalDeposited > 0 ? (
            <span className="text-muted-foreground">
              Invested: {fmt(totalDeposited)}{" "}
              <span className={returnPct >= 0 ? "text-gain" : "text-loss"}>
                ({returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%)
              </span>
            </span>
          ) : undefined}
          subtitle={totalDeposited <= 0 ? `${summary?.holdingCount ?? 0} holdings` : undefined}
          loading={dashLoading}
        />
        <MetricCard
          title="Total Profit"
          value={fmt(totalGain)}
          subtitleNode={(
            <span className={`block ${cnValue(totalGain)}`}>
              {totalGainPct >= 0 ? "+" : ""}{totalGainPct.toFixed(1)}%
            </span>
          )}
          valueClass={cnValue(totalGain)}
          loading={dashLoading}
        />
        <MetricCard
          title="Current Value"
          value={fmt(fifoEngine.totalCurrentValue)}
          subtitle={grandTotal > 0 ? `${formatPercent(fifoEngine.totalCurrentValue / grandTotal * 100)} of total` : undefined}
          loading={dashLoading}
        />
        <MetricCard
          title="Total Cash"
          value={fmt(fxTotalCash)}
          subtitle={grandTotal > 0 ? `${formatPercent(fxTotalCash / grandTotal * 100)} of total` : undefined}
          loading={!portfolios || loadingSummary}
        />
      </div>

      {/* FIX 3 & 4: Allocation chart — full-width centered on mobile, labels below */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 md:pb-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base md:text-lg">Portfolio Allocation</CardTitle>
              <div className="flex gap-1">
                <button onClick={() => setPieView("total")} className={`text-xs px-2 py-0.5 rounded border transition-colors ${pieView === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>Total</button>
                <button onClick={() => setPieView("assets")} className={`text-xs px-2 py-0.5 rounded border transition-colors ${pieView === "assets" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>Assets</button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            {loadingAllocation ? <Skeleton className="w-full h-[200px]" /> : (() => {
              const sliceValue = (a: any) => pieView === "assets" ? (a.currentValue ?? a.value ?? 0) : (a.value ?? 0);
              const totalAllocValue = fxAdjustedAllocation.reduce((s, a) => s + sliceValue(a), 0);
              const allocWithWeight = fxAdjustedAllocation.map((a, i) => ({
                ...a,
                weight: totalAllocValue > 0 ? (sliceValue(a) / totalAllocValue) * 100 : 0,
                color: a.color || PIE_COLORS[i % PIE_COLORS.length],
                _displayValue: sliceValue(a),
              }));

              if (!allocWithWeight.length) return (
                <p className="text-sm text-muted-foreground py-4">No holdings yet.</p>
              );

              const active = activeAllocIdx !== null ? allocWithWeight[activeAllocIdx] : null;

              return (
                <div className="flex flex-col md:flex-row md:h-[260px] gap-3">
                  {/* Chart */}
                  <div className="relative w-full md:w-[55%] h-[180px] md:h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={allocWithWeight}
                          cx="50%" cy="50%"
                          innerRadius={55} outerRadius={85}
                          paddingAngle={0}
                          dataKey="_displayValue"
                          onClick={(_, index) =>
                            setActiveAllocIdx(prev => prev === index ? null : index)
                          }
                          style={{ cursor: "pointer" }}
                        >
                          {allocWithWeight.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.color}
                              opacity={activeAllocIdx === null || activeAllocIdx === index ? 1 : 0.35}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Click: show label in donut center instead of tooltip box */}
                    {active && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center px-4">
                          <div className="text-[11px] font-semibold truncate max-w-[100px]" style={{ color: active.color }}>{active.label}</div>
                          <div className="text-sm font-bold font-mono">{fmt(active._displayValue)}</div>
                          <div className="text-[10px] text-muted-foreground">{active.weight.toFixed(1)}%</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Labels below on mobile — equal-width sections */}
                  <div className="flex md:hidden w-full gap-0">
                    {allocWithWeight.map((a, i) => (
                      <button
                        key={a.label}
                        onClick={() => setActiveAllocIdx(prev => prev === i ? null : i)}
                        className="flex-1 min-w-0 flex flex-col items-center gap-0.5 px-1 py-1.5 rounded"
                        style={{ background: activeAllocIdx === i ? `${a.color}15` : undefined }}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                        <span className="text-[9px] text-muted-foreground truncate w-full text-center leading-none">{a.label}</span>
                        <span className="text-[9px] font-mono font-semibold leading-none">{fmt(a._displayValue)}</span>
                        <span className="text-[9px] text-muted-foreground leading-none">{a.weight.toFixed(1)}%</span>
                      </button>
                    ))}
                  </div>

                  {/* Desktop: side legend */}
                  <div className="hidden md:flex flex-col justify-center gap-2.5 flex-1 min-w-0">
                    {allocWithWeight.map((a, i) => (
                      <button
                        key={a.label}
                        onClick={() => setActiveAllocIdx(prev => prev === i ? null : i)}
                        className="flex items-center gap-2 text-sm min-w-0 w-full text-left rounded px-1 py-0.5 hover:bg-muted/30"
                      >
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: a.color }} />
                        <span className="text-muted-foreground text-xs flex-1 truncate">{a.label}</span>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-xs font-medium">{fmt(a._displayValue)}</div>
                          <div className="text-[10px] text-muted-foreground">{a.weight.toFixed(1)}%</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Upcoming dividends — visible on desktop alongside chart; below on mobile */}
        <Card>
          <CardHeader className="pb-2 px-3 pt-3 md:px-6 md:pt-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base md:text-lg">Upcoming Dividends</CardTitle>
              <Link href="/dividend-calendar" className="text-xs text-primary hover:underline">View all</Link>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3 md:px-6 md:pb-6">
            {loadingDividends ? <Skeleton className="w-full h-[120px]" /> : (
              <div className="space-y-3">
                {!upcomingDividends?.length ? (
                  <p className="text-sm text-muted-foreground">No upcoming dividends.</p>
                ) : (
                  upcomingDividends.slice(0, 5).map(div => (
                    <div key={div.id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{div.symbol}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {div.paymentDate ? format(new Date(div.paymentDate), "MMM d") : (div.exDate ? `Ex: ${format(new Date(div.exDate), "MMM d")}` : "—")}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-semibold text-sm text-gain">
                          {div.totalAmount ? fxFormat(div.totalAmount, div.currency) : "—"}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

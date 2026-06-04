import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link } from "wouter";
import { RebalanceTab } from "@/components/rebalance-tab";
import { NotesPanel } from "@/components/notes-panel";
import { AttributionTab } from "@/components/attribution-tab";
import { DividendInfoPanel, type DividendInfo } from "@/components/dividend-info-panel";
import {
  useGetPortfolio,
  useGetPortfolioSummary,
  useGetPortfolioPerformance,
  useListHoldings,
  useListTransactions,
  useCreateHolding,
  useUpdateHolding,
  useDeleteHolding,
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
  useSearchSymbols,
  useListDividendEvents,
  getListDividendEventsQueryKey,
  getGetPortfolioQueryKey,
  getGetPortfolioSummaryQueryKey,
  getListHoldingsQueryKey,
  getListTransactionsQueryKey,
} from "@workspace/api-client-react";
import { formatCurrency, formatPercent, cnValue, formatNumber, getNetAmount } from "@/lib/format";
import { TxFormSummary } from "@/components/tx-form-summary";
import { SensitiveAmount } from "@/components/amount";
import { computeFIFO } from "@/lib/fifo";
import { computePortfolioMetrics } from "@/lib/portfolioEngine";
import { useFx } from "@/lib/fx-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StockLogo } from "@/components/stock-logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, RefreshCw, X, Search, TrendingUp, Calendar, ChevronDown, Trash2, Pencil, ChevronLeft } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CurrencyCombobox } from "@/components/currency-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getSettings } from "@/lib/use-settings";
import { AssetDetailSheet } from "@/components/asset-detail-sheet";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const holdingSchema = z.object({
  assetType: z.enum(["STOCK", "ETF", "FUND", "CRYPTO", "BOND", "SAVINGS", "CASH_ASSET", "CUSTOM"]),
  name: z.string().min(1),
  symbol: z.string().min(1),
  currency: z.string().min(1, "Currency is required"),
  notes: z.string().optional(),
});

type SymbolSelection = { id?: number; symbol: string; name: string; market: string };

function AddTransactionDialog({
  portfolioId,
  holdings,
  baseCurrency,
  portfolioMarket,
  defaultHoldingId,
  defaultFeeRate,
  sellFeeRate,
  defaultTaxRate,
  onSuccess,
  externalOpen,
  onExternalOpenChange,
}: {
  portfolioId: number;
  holdings: any[];
  baseCurrency: string;
  portfolioMarket?: string;
  defaultHoldingId?: number;
  defaultFeeRate?: number;
  sellFeeRate?: number;
  defaultTaxRate?: number;
  onSuccess: () => void;
  externalOpen?: boolean;
  onExternalOpenChange?: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  function setOpen(v: boolean) {
    if (onExternalOpenChange) onExternalOpenChange(v);
    else setInternalOpen(v);
  }
  const settings = getSettings();
  const createTx = useCreateTransaction();
  const searchRef = useRef<HTMLDivElement>(null);

  const initSelected = (): SymbolSelection | null => {
    if (!defaultHoldingId) return null;
    const h = holdings?.find((h: any) => h.id === defaultHoldingId);
    return h ? { id: h.id, symbol: h.symbol, name: h.name, market: h.market } : null;
  };

  const [selectedSymbol, setSelectedSymbol] = useState<SymbolSelection | null>(initSelected);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchMarketOverride, setSearchMarketOverride] = useState<string>(
    portfolioMarket && portfolioMarket !== "MIXED" ? portfolioMarket : "US"
  );

  const [txType, setTxType] = useState("BUY");
  const [txDate, setTxDate] = useState(new Date().toISOString().split("T")[0]);
  const [txQty, setTxQty] = useState("");
  const [txPrice, setTxPrice] = useState("");
  const [txFeeAmt, setTxFeeAmt] = useState("");
  const [txTaxAmt, setTxTaxAmt] = useState("");
  const [txNotes, setTxNotes] = useState("");
  const [txCurrency, setTxCurrency] = useState(baseCurrency || "USD");
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  const [priceStatus, setPriceStatus] = useState<"live" | "delayed" | "lastclose" | "unavailable" | null>(null);
  const [priceLabel, setPriceLabel] = useState<string | null>(null);
  const [showDividendPanel, setShowDividendPanel] = useState(false);
  const [txTransferHoldingId, setTxTransferHoldingId] = useState("");

  // Debounce symbol query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(symbolQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [symbolQuery]);

  // Search scoped to the user-selected market override
  const { data: searchResults, isFetching: isSearching } = useSearchSymbols(
    { q: debouncedQuery || "_", market: searchMarketOverride as any },
    { query: { enabled: debouncedQuery.length >= 1 && showSuggestions } as any }
  );

  // Existing holdings that match the search query
  const existingMatches = debouncedQuery.length >= 1
    ? (holdings ?? []).filter((h: any) =>
        h.symbol.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        (h.name ?? "").toLowerCase().includes(debouncedQuery.toLowerCase())
      )
    : [];
  const existingSet = new Set(existingMatches.map((h: any) => `${h.symbol}:${h.market}`));
  const liveSuggestions = (searchResults ?? []).filter(r => !existingSet.has(`${r.symbol}:${r.market}`));

  // Close dropdown on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const HOLDING_TX_TYPES = ["BUY", "SELL", "DIVIDEND", "STOCK_SPLIT", "COUPON_INTEREST", "STAKING_REWARD", "MATURITY", "TRANSFER", "DISTRIBUTION", "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT"];
  const isFundTransfer = txType === "FUND_TRANSFER_IN" || txType === "FUND_TRANSFER_OUT";
  const needsHolding = HOLDING_TX_TYPES.includes(txType) && !isFundTransfer;
  const isDividend = ["DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION"].includes(txType);
  const isBondFund = portfolioMarket === "BONDS" || portfolioMarket === "FUNDS";
  const needsQtyPrice = ["BUY", "SELL", "DIVIDEND", "STOCK_SPLIT"].includes(txType) && !(isBondFund && isDividend);

  const fetchLivePrice = async (sym: SymbolSelection) => {
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
          else if (lbl === "Last Close" || lbl === "Last Price" || lbl === "Last Trading Day Price" || lbl === "Latest Available Price") setPriceStatus("lastclose");
          else setPriceStatus("delayed");
        } else { setPriceStatus("unavailable"); }
      } else { setPriceStatus("unavailable"); }
    } catch { setPriceStatus("unavailable"); }
    finally { setIsFetchingPrice(false); }
  };

  const handleSelectSymbol = (sym: SymbolSelection) => {
    setSelectedSymbol(sym);
    setSymbolQuery(""); setShowSuggestions(false);
    setTxCurrency(baseCurrency || "USD"); setPriceStatus(null);
    setShowDividendPanel(true);
    if (txType === "BUY" || txType === "SELL") fetchLivePrice(sym);
  };

  const handleAddToCalendar = async (info: DividendInfo) => {
    if (!info.history.length && !info.lastDividendValue) return;
    const latest = info.history[0];
    if (!latest) return;
    try {
      await fetch(`${BASE_URL}/api/dividend-calendar`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioId,
          holdingId: selectedSymbol?.id ?? null,
          symbol: selectedSymbol?.symbol ?? info.symbol,
          exDate: info.exDividendDate ?? latest.date,
          paymentDate: latest.date,
          dividendPerShare: latest.amount,
          currency: info.currency,
          dividendType: "ORDINARY",
          notes: `Auto-imported from Yahoo Finance for ${info.symbol}`,
        }),
      });
      toast({ title: "Added to Dividend Calendar", description: `${info.symbol} — ${info.currency} ${latest.amount.toFixed(4)} per share` });
    } catch {
      toast({ title: "Failed to add to calendar", variant: "destructive" });
    }
  };

  const qty = parseFloat(txQty || "0");
  const pricePerShare = parseFloat(txPrice || "0");
  const subtotal = needsQtyPrice ? qty * pricePerShare : pricePerShare;

  const isTrade = txType === "BUY" || txType === "SELL";
  const isIncome = isDividend;
  const isCashType = txType === "CASH_GAIN" || txType === "CASH_EXPENSE";
  const isNoAmountType = txType === "STOCK_SPLIT" || txType === "TRANSFER";

  // Fee rate depends on transaction type: SELL uses sellFeeRate, BUY uses defaultFeeRate
  const applicableFeeRate = txType === "SELL" ? (sellFeeRate ?? 0) : (defaultFeeRate ?? 0);
  // Auto-compute fee/tax from current subtotal — no stale closure; shown as placeholder
  const autoFee = isTrade && subtotal > 0 ? subtotal * applicableFeeRate / 100 : 0;
  const autoTax = isIncome && subtotal > 0 ? subtotal * (defaultTaxRate ?? 0) / 100 : 0;
  // Use user-entered value if present, otherwise the auto-computed amount
  const feeAmt = txFeeAmt !== "" ? parseFloat(txFeeAmt) : autoFee;
  const taxAmt = txTaxAmt !== "" ? parseFloat(txTaxAmt) : autoTax;
  // For DIVIDEND: gross = qty × price/share; net displayed = gross − tax (fee n/a)
  // For BUY/SELL: total cost = subtotal + fee + tax
  const totalAmount = isDividend || isCashType ? subtotal : subtotal + feeAmt + taxAmt;
  const dividendNet = isDividend ? Math.max(0, subtotal - taxAmt) : 0;

  const resetForm = () => {
    setTxType("BUY"); setTxDate(new Date().toISOString().split("T")[0]);
    setTxQty(""); setTxPrice(""); setTxFeeAmt(""); setTxTaxAmt(""); setTxNotes("");
    setTxCurrency(baseCurrency || "USD"); setPriceStatus(null); setPriceLabel(null);
    setSelectedSymbol(initSelected()); setSymbolQuery(""); setDebouncedQuery("");
    setTxTransferHoldingId("");
    setShowDividendPanel(false);
  };

  const handleSubmit = () => {
    // Fund transfer path — holding is selected from dropdown, no symbol search
    if (isFundTransfer) {
      const holdingId = txTransferHoldingId ? parseInt(txTransferHoldingId) : null;
      if (!holdingId) { toast({ title: "Select a holding", variant: "destructive" }); return; }
      const amt = parseFloat(txPrice || "0");
      if (amt <= 0) { toast({ title: "Enter an amount greater than 0", variant: "destructive" }); return; }
      createTx.mutate({ portfolioId, data: {
        type: txType, date: txDate, amount: amt, holdingId,
        currency: txCurrency, notes: txNotes || undefined,
      } as any }, {
        onSuccess: () => { toast({ title: "Transfer added" }); setOpen(false); resetForm(); onSuccess(); },
        onError: () => toast({ title: "Failed to add transfer", variant: "destructive" }),
      });
      return;
    }

    if (needsHolding && !selectedSymbol) { toast({ title: "Select a stock or symbol", variant: "destructive" }); return; }
    // For DIVIDEND: use gross amount (qty × price/share); for others use totalAmount
    const rawAmt = isDividend ? (subtotal || pricePerShare || 0) : (totalAmount || pricePerShare || 0);
    const amt = isNoAmountType ? (parseFloat(txQty || "0") || 0) : rawAmt;
    if (!isNoAmountType && amt <= 0) { toast({ title: "Enter an amount or qty + price", variant: "destructive" }); return; }

    const payload: any = {
      type: txType, date: txDate,
      quantity: txQty ? parseFloat(txQty) : undefined,
      price: pricePerShare > 0 ? pricePerShare : undefined,
      amount: amt,
      // DIVIDEND: no fee (only tax withheld); CASH types: no fee or tax; BUY/SELL: both
      feeAmount: (!isDividend && !isCashType && feeAmt > 0) ? feeAmt : undefined,
      taxAmount: (!isCashType && taxAmt > 0) ? taxAmt : undefined,
      currency: txCurrency,
      notes: txNotes || undefined,
    };
    if (selectedSymbol) {
      if (selectedSymbol.id) {
        payload.holdingId = selectedSymbol.id;
      } else {
        payload.holdingId = null;
        payload.symbol = selectedSymbol.symbol;
        payload.market = selectedSymbol.market;
        payload.name = selectedSymbol.name;
        payload.assetType = "STOCK";
      }
    }

    createTx.mutate({ portfolioId, data: payload as any }, {
      onSuccess: () => { toast({ title: "Transaction added" }); setOpen(false); resetForm(); onSuccess(); },
      onError: () => toast({ title: "Failed to add transaction", variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm(); }}>
      {onExternalOpenChange === undefined && (
        <DialogTrigger asChild>
          <Button size="sm"><Plus className="w-4 h-4 mr-2" /> Add Transaction</Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {/* Type + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={txType} onValueChange={v => { setTxType(v); setPriceStatus(null); }}>
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
                  <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border/50 mt-0.5">Cash ↔ Holding</div>
                  <SelectItem value="FUND_TRANSFER_IN" className="pl-6">Transfer: Cash → Holding</SelectItem>
                  <SelectItem value="FUND_TRANSFER_OUT" className="pl-6">Transfer: Holding → Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date</label>
              <Input type="date" value={txDate} onChange={e => setTxDate(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* Symbol search */}
          {needsHolding && (
            <div className="space-y-1.5" ref={searchRef}>
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium">Stock / Symbol</label>
                {!selectedSymbol && (
                  <Select value={searchMarketOverride} onValueChange={v => { setSearchMarketOverride(v); setSymbolQuery(""); setDebouncedQuery(""); }}>
                    <SelectTrigger className="h-7 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PSE">PSE</SelectItem>
                      <SelectItem value="US">US</SelectItem>
                      <SelectItem value="LSE">LSE</SelectItem>
                      <SelectItem value="CRYPTO">CRYPTO</SelectItem>
                      <SelectItem value="FUNDS">FUNDS</SelectItem>
                      <SelectItem value="BONDS">BONDS</SelectItem>
                      <SelectItem value="CUSTOM">CUSTOM</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
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
              {isFetchingPrice && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Fetching price…
                </p>
              )}
              {priceStatus && !isFetchingPrice && (
                <p className={`text-xs flex items-center gap-1 ${priceStatus === "live" ? "text-green-500" : priceStatus === "lastclose" ? "text-amber-400" : priceStatus === "delayed" ? "text-amber-400" : "text-muted-foreground"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${priceStatus === "live" ? "bg-green-500" : priceStatus === "lastclose" || priceStatus === "delayed" ? "bg-amber-400" : "bg-muted-foreground"}`} />
                  {priceStatus === "live" ? "Live price" : priceStatus === "unavailable" ? "Price unavailable — enter manually" : (priceLabel ?? "Latest available price")}
                </p>
              )}

              {/* Dividend info panel — auto-fetches when a stock is selected */}
              {selectedSymbol && showDividendPanel && (
                <DividendInfoPanel
                  symbol={selectedSymbol.symbol}
                  market={selectedSymbol.market}
                  onAddToCalendar={handleAddToCalendar}
                />
              )}
            </div>
          )}

          {/* Fund Transfer: holding dropdown + direction indicator */}
          {isFundTransfer && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm bg-muted/30 rounded-md px-3 py-2 border border-border/40">
                <span className={txType === "FUND_TRANSFER_IN" ? "font-semibold text-foreground" : "text-muted-foreground"}>Idle Cash</span>
                <span className="text-muted-foreground mx-1">→</span>
                <span className={txType === "FUND_TRANSFER_OUT" ? "font-semibold text-foreground" : "text-muted-foreground"}>Holding</span>
                {txType === "FUND_TRANSFER_OUT" && (
                  <span className="text-[10px] text-muted-foreground ml-auto">(reversed direction)</span>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Holding</label>
                <Select value={txTransferHoldingId} onValueChange={setTxTransferHoldingId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select a holding…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(holdings ?? []).map((h: any) => (
                      <SelectItem key={h.id} value={String(h.id)}>
                        <span className="font-mono font-semibold mr-2">{h.symbol}</span>
                        <span className="text-muted-foreground text-xs">{h.market}</span>
                        <span className="text-muted-foreground text-xs ml-1 truncate">{h.name}</span>
                      </SelectItem>
                    ))}
                    {(holdings ?? []).length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No holdings yet — add one first</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Qty + Price (BUY, SELL, DIVIDEND, STOCK_SPLIT show these) */}
          {needsQtyPrice && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {isDividend ? "No. of Shares" : txType === "STOCK_SPLIT" ? "New Shares" : "Quantity"}
                </label>
                <Input type="number" min="0" step="any" placeholder="0" value={txQty} onChange={e => setTxQty(e.target.value)} className="h-9 font-mono" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {isDividend ? "Price per Share" : "Price / Share"}
                </label>
                <Input type="number" min="0" step="any" placeholder="0.00" value={txPrice} onChange={e => setTxPrice(e.target.value)} className="h-9 font-mono" />
              </div>
            </div>
          )}
          {!needsQtyPrice && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {isFundTransfer
                  ? (txType === "FUND_TRANSFER_IN" ? "Amount (Cash → Holding)" : "Amount (Holding → Cash)")
                  : "Amount"}
              </label>
              <Input type="number" min="0" step="any" placeholder="0.00" value={txPrice} onChange={e => setTxPrice(e.target.value)} className="h-9 font-mono" />
            </div>
          )}

          {/* Fee row — hidden for DIVIDEND, cash-only types, and fund transfers */}
          {!isDividend && !isCashType && !isFundTransfer && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {txType === "SELL" ? "Sell Fee & Tax" : "Buy Fee"}
                  {applicableFeeRate > 0 && <span className="text-muted-foreground font-normal ml-1">({applicableFeeRate.toFixed(4)}%)</span>}
                </label>
                <Input type="number" min="0" step="0.0001" placeholder={autoFee > 0 ? autoFee.toFixed(4) : "0.0000"} value={txFeeAmt} onChange={e => setTxFeeAmt(e.target.value)} className="h-9 font-mono" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Tax
                </label>
                <Input type="number" min="0" step="0.0001" placeholder={autoTax > 0 ? autoTax.toFixed(4) : "0.0000"} value={txTaxAmt} onChange={e => setTxTaxAmt(e.target.value)} className="h-9 font-mono" />
              </div>
            </div>
          )}

          {/* Dividend tax — shown only for DIVIDEND, full-width */}
          {isDividend && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Dividend Tax
                {(defaultTaxRate ?? 0) > 0 && <span className="text-muted-foreground font-normal ml-1">({(defaultTaxRate ?? 0).toFixed(2)}%)</span>}
              </label>
              <Input type="number" min="0" step="0.0001" placeholder={autoTax > 0 ? autoTax.toFixed(4) : "0.0000"} value={txTaxAmt} onChange={e => setTxTaxAmt(e.target.value)} className="h-9 font-mono" />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Currency</label>
            <CurrencyCombobox value={txCurrency} onChange={setTxCurrency} />
          </div>

          {/* Total summary row */}
          {isFundTransfer && parseFloat(txPrice || "0") > 0 ? (
            <div className="bg-muted/50 rounded-lg p-3 text-sm flex justify-between">
              <span className="text-muted-foreground">
                {txType === "FUND_TRANSFER_IN" ? "Cash deducted" : "Cash received"}
              </span>
              <span className="font-mono font-semibold">{txCurrency} {parseFloat(txPrice || "0").toFixed(2)}</span>
            </div>
          ) : (isTrade || isDividend) && subtotal > 0 ? (
            <TxFormSummary
              type={txType}
              currency={txCurrency}
              gross={subtotal}
              fee={isTrade ? feeAmt : 0}
              tax={taxAmt}
            />
          ) : totalAmount > 0 && !isNoAmountType ? (
            <div className="bg-muted/50 rounded-lg p-3 text-sm flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-mono font-semibold">{txCurrency} {totalAmount.toFixed(2)}</span>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <Input placeholder="Optional" value={txNotes} onChange={e => setTxNotes(e.target.value)} className="h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createTx.isPending}>
            {createTx.isPending ? "Saving…" : "Add Transaction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HoldingDetailSheet({
  holding,
  transactions,
  baseCurrency,
  onClose,
}: {
  holding: any;
  transactions: any[];
  baseCurrency: string;
  onClose: () => void;
}) {
  const holdingTxs = transactions.filter(t => t.holdingId === holding.id);

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-start justify-between">
            <div>
              <div className="text-xl font-bold">{holding.symbol}</div>
              <div className="text-sm font-normal text-muted-foreground">{holding.name}</div>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Position summary */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Market", value: holding.market },
              { label: "Asset Type", value: holding.assetType },
              { label: "Quantity", value: formatNumber(holding.quantity, 2) },
              { label: "Avg Cost", value: formatCurrency(holding.avgCostBasis, baseCurrency) },
              { label: "Current Price", value: formatCurrency(holding.currentPrice, baseCurrency) },
              { label: "Current Value", value: formatCurrency(holding.currentValue, baseCurrency) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/40 rounded-lg p-3">
                <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                <div className="font-semibold text-sm">{value}</div>
              </div>
            ))}
          </div>

          {/* Gain/Loss */}
          <div className={`rounded-lg p-4 ${holding.unrealizedGain >= 0 ? "bg-gain/10 border border-gain/20" : "bg-loss/10 border border-loss/20"}`}>
            <div className="text-xs text-muted-foreground mb-1">Unrealized Gain / Loss</div>
            <div className={`text-xl font-bold font-mono ${cnValue(holding.unrealizedGain)}`}>
              {formatCurrency(holding.unrealizedGain, baseCurrency)}
            </div>
            <div className={`text-sm ${cnValue(holding.unrealizedGainPct)}`}>
              {formatPercent(holding.unrealizedGainPct)}
            </div>
          </div>

          {/* Transactions for this holding */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Transactions ({holdingTxs.length})</h3>
            {holdingTxs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions for this holding.</p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Net Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {holdingTxs.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs">{format(new Date(t.date), 'MMM d, yyyy')}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs ${
                            t.type === 'BUY' ? 'border-blue-500 text-blue-400' :
                            t.type === 'SELL' ? 'border-red-500 text-red-400' :
                            t.type === 'DIVIDEND' ? 'border-green-500 text-green-400' :
                            t.type === 'FUND_TRANSFER_IN' ? 'border-teal-500 text-teal-400' :
                            t.type === 'FUND_TRANSFER_OUT' ? 'border-orange-500 text-orange-400' :
                            'border-border text-muted-foreground'
                          }`}>{t.type}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{t.quantity ? formatNumber(t.quantity, 2) : '-'}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{t.price ? formatCurrency(t.price, t.currency) : '-'}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-medium"><SensitiveAmount value={getNetAmount(t)} currency={t.currency} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Performance History Chart ─────────────────────────────────────────────────

const PERF_PERIODS = ["1M", "3M", "6M", "1Y", "ALL"] as const;
type PerfPeriod = typeof PERF_PERIODS[number];

function PerformanceHistoryChart({ portfolioId, baseCurrency }: { portfolioId: number; baseCurrency: string }) {
  const [period, setPeriod] = useState<PerfPeriod>("1Y");
  const { data: performance, isLoading } = useGetPortfolioPerformance(
    portfolioId,
    { period },
    { query: { enabled: portfolioId > 0, queryKey: ["perf-history", portfolioId, period] } }
  );

  const tooltipStyle = {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "6px",
    color: "hsl(var(--foreground))",
    fontSize: 12,
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold">Portfolio Performance History</CardTitle>
          <div className="flex items-center gap-1">
            {PERF_PERIODS.map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  period === p
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="h-[220px]">
        {isLoading ? (
          <div className="w-full h-full bg-muted/20 animate-pulse rounded" />
        ) : !performance?.length ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No performance data available for this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={performance}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis
                dataKey="date"
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={50}
                tickFormatter={(d) => {
                  const date = new Date(d);
                  if (isNaN(date.getTime())) return d;
                  return format(date, period === "1M" ? "MMM d" : "MMM yy");
                }}
              />
              <YAxis
                tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={60}
                tickFormatter={(v) => {
                  const abs = Math.abs(v);
                  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
                  return String(v);
                }}
              />
              <Tooltip
                formatter={(v: number) => [formatCurrency(v, baseCurrency), "Value"]}
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
  );
}

// ─── Dividends Tab ────────────────────────────────────────────────────────────

function DividendsTab({
  portfolioId,
  baseCurrency,
  holdings,
}: {
  portfolioId: number;
  baseCurrency: string;
  holdings: any[];
}) {
  const { toast } = useToast();
  const { data: events, isLoading, refetch } = useListDividendEvents(
    { portfolioId },
    { query: { enabled: !!portfolioId, queryKey: getListDividendEventsQueryKey({ portfolioId }) } }
  );

  const [selectedHoldingForSync, setSelectedHoldingForSync] = useState<any>(null);
  const [syncingHoldingId, setSyncingHoldingId] = useState<number | null>(null);

  const [syncingPortfolio, setSyncingPortfolio] = useState(false);

  const handleSyncAllDividends = async () => {
    setSyncingPortfolio(true);
    try {
      const res = await fetch(`${BASE_URL}/api/dividend-calendar/sync/${portfolioId}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("sync failed");
      const result = await res.json();
      toast({
        title: `Synced ${result.synced} dividend record${result.synced !== 1 ? "s" : ""}`,
        description: `Processed ${result.holdingsProcessed} holding${result.holdingsProcessed !== 1 ? "s" : ""} via EODHD`,
      });
      refetch();
    } catch {
      toast({ title: "Failed to sync dividends from EODHD", variant: "destructive" });
    } finally {
      setSyncingPortfolio(false);
    }
  };

  const handleSyncDividends = async (holding: any) => {
    setSyncingHoldingId(holding.id);
    try {
      const res = await fetch(`${BASE_URL}/api/dividend-calendar/sync/${portfolioId}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("sync failed");
      const result = await res.json();
      toast({
        title: `Synced ${result.synced} dividend record${result.synced !== 1 ? "s" : ""}`,
        description: `${holding.symbol} — imported from EODHD`,
      });
      refetch();
    } catch {
      toast({ title: `Failed to sync dividends for ${holding.symbol}`, variant: "destructive" });
    } finally {
      setSyncingHoldingId(null);
    }
  };

  const activeHoldings = holdings.filter(h => parseFloat(String(h.quantity ?? "0")) > 0);

  return (
    <div className="space-y-5">
      {/* Per-holding dividend info cards */}
      {activeHoldings.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Dividend Data by Holding</h3>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={syncingPortfolio}
              onClick={handleSyncAllDividends}
            >
              {syncingPortfolio
                ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Syncing all…</>
                : <><RefreshCw className="w-3 h-3 mr-1" /> Sync All via Yahoo Finance</>
              }
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeHoldings.map(h => (
              <div key={h.id} className="rounded-lg border border-border bg-card p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-semibold text-sm">{h.symbol}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{h.market}</span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{h.name}</div>
                  {selectedHoldingForSync?.id === h.id && (
                    <div className="mt-2">
                      <DividendInfoPanel
                        symbol={h.symbol}
                        market={h.market}
                        onAddToCalendar={async (info) => {
                          if (!info.history.length) return;
                          const latest = info.history[0];
                          await fetch(`${BASE_URL}/api/dividend-calendar`, {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              portfolioId, holdingId: h.id,
                              symbol: h.symbol,
                              exDate: info.exDividendDate ?? latest.date,
                              paymentDate: latest.date,
                              dividendPerShare: latest.amount,
                              currency: info.currency,
                              dividendType: "ORDINARY",
                            }),
                          });
                          toast({ title: `Added ${h.symbol} dividend to calendar` });
                          refetch();
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={syncingHoldingId === h.id}
                    onClick={() => handleSyncDividends(h)}
                  >
                    {syncingHoldingId === h.id
                      ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Syncing…</>
                      : <><TrendingUp className="w-3 h-3 mr-1" /> Sync</>
                    }
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setSelectedHoldingForSync((prev: any) => prev?.id === h.id ? null : h)}
                  >
                    {selectedHoldingForSync?.id === h.id ? "Hide" : "Preview"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dividend events table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">
            Dividend Events
            {events && events.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-xs font-normal">{events.length}</span>
            )}
          </h3>
        </div>
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs py-2 px-3">Symbol</TableHead>
                <TableHead className="text-xs py-2 px-3">Ex-Date</TableHead>
                <TableHead className="text-xs py-2 px-3">Pay Date</TableHead>
                <TableHead className="text-right text-xs py-2 px-3">Per Share</TableHead>
                <TableHead className="text-right text-xs py-2 px-3">Total</TableHead>
                <TableHead className="text-xs py-2 px-3">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-8"><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              ) : !events?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                    No dividend events yet.
                    {activeHoldings.length > 0 && " Use the Sync button above to import from Yahoo Finance."}
                  </TableCell>
                </TableRow>
              ) : (
                [...events]
                  .sort((a, b) => new Date(b.exDate ?? "").getTime() - new Date(a.exDate ?? "").getTime())
                  .map(ev => (
                  <TableRow key={ev.id}>
                    <TableCell className="font-mono font-semibold text-xs py-2 px-3">
                      {(ev as any).holdingSymbol || (ev as any).symbol || "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono py-2 px-3">
                      {ev.exDate ? format(new Date(ev.exDate), "MMM d, yy") : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono py-2 px-3">
                      {ev.paymentDate ? format(new Date(ev.paymentDate), "MMM d, yy") : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs py-2 px-3">
                      {ev.dividendPerShare != null
                        ? `${baseCurrency} ${Number(ev.dividendPerShare).toFixed(4)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs py-2 px-3">
                      {ev.totalAmount != null
                        ? formatCurrency(Number(ev.totalAmount), baseCurrency)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${(ev as any).isPaid ? "border-green-500/40 text-green-400" : "border-amber-500/40 text-amber-400"}`}
                      >
                        {(ev as any).isPaid ? "Paid" : "Pending"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function TxDetailSheet({ tx, portfolioId, onClose, onDeleted }: {
  tx: any; portfolioId: number; onClose: () => void; onDeleted: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteTx = useDeleteTransaction();
  const updateTx = useUpdateTransaction();
  const [isEditing, setIsEditing] = useState(false);

  const [editDate, setEditDate] = useState(tx.date ? String(tx.date).split("T")[0] : "");
  const [editAmount, setEditAmount] = useState(String(tx.amount ?? ""));
  const [editQty, setEditQty] = useState(tx.quantity != null ? String(tx.quantity) : "");
  const [editPrice, setEditPrice] = useState(tx.price != null ? String(tx.price) : "");
  const [editFee, setEditFee] = useState(tx.feeAmount ? String(tx.feeAmount) : "");
  const [editTax, setEditTax] = useState(tx.taxAmount ? String(tx.taxAmount) : "");
  const [editNotes, setEditNotes] = useState(tx.notes ?? "");

  useEffect(() => {
    const p = parseFloat(editPrice);
    const q = parseFloat(editQty);
    const f = parseFloat(editFee) || 0;
    const t = parseFloat(editTax) || 0;
    if (!isNaN(p) && p > 0 && !isNaN(q) && q > 0) {
      setEditAmount(String(p * q + f + t));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPrice, editQty, editFee, editTax]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey(portfolioId, { limit: 1000 }) });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey(portfolioId) });
    queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey(portfolioId) });
  };

  const handleDelete = () => {
    deleteTx.mutate(
      { portfolioId, transactionId: tx.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Transaction deleted" });
          onDeleted();
          onClose();
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  };

  const handleSaveEdit = () => {
    updateTx.mutate(
      {
        portfolioId,
        transactionId: tx.id,
        data: {
          date: editDate || tx.date,
          amount: parseFloat(editAmount) || tx.amount,
          quantity: editQty ? parseFloat(editQty) : null,
          price: editPrice ? parseFloat(editPrice) : null,
          feeAmount: editFee ? parseFloat(editFee) : null,
          taxAmount: editTax ? parseFloat(editTax) : null,
          notes: editNotes || null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Transaction updated" });
          setIsEditing(false);
          onDeleted();
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  };

  const typeBadgeClass = tx.type === "BUY" ? "border-blue-500 text-blue-400"
    : tx.type === "SELL" ? "border-red-500 text-red-400"
    : tx.type === "DIVIDEND" ? "border-green-500 text-green-400"
    : tx.type === "FUND_TRANSFER_IN" ? "border-teal-500 text-teal-400"
    : tx.type === "FUND_TRANSFER_OUT" ? "border-orange-500 text-orange-400"
    : "border-border text-muted-foreground";

  const txFee = tx.feeAmount != null ? parseFloat(String(tx.feeAmount)) : 0;
  const txTax = tx.taxAmount != null ? parseFloat(String(tx.taxAmount)) : 0;
  const grossAmt = (tx.price != null && tx.quantity != null)
    ? tx.price * tx.quantity
    : tx.amount - txFee - txTax;
  const netAmt = grossAmt - txFee - txTax;

  const rows = [
    { label: "Date", value: format(new Date(tx.date), "MMM d, yyyy"), mono: false },
    tx.quantity != null ? { label: "Quantity", value: formatNumber(tx.quantity, 4), mono: true } : null,
    tx.price != null ? { label: "Price", value: formatCurrency(tx.price, tx.currency), mono: true } : null,
    { label: "Gross Amount", value: formatCurrency(grossAmt, tx.currency), mono: true },
    txFee > 0 ? { label: "Fee", value: formatCurrency(txFee, tx.currency), mono: true } : null,
    txTax > 0 ? { label: "Tax", value: formatCurrency(txTax, tx.currency), mono: true } : null,
    (txFee > 0 || txTax > 0) ? { label: "Net Amount", value: formatCurrency(netAmt, tx.currency), mono: true } : null,
    tx.notes ? { label: "Notes", value: String(tx.notes), mono: false } : null,
  ].filter(Boolean) as { label: string; value: string; mono: boolean }[];

  return (
    <Sheet open={true} onOpenChange={() => { setIsEditing(false); onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-xl h-auto max-h-[82svh] flex flex-col">
        <SheetHeader className="pb-3 shrink-0">
          <SheetTitle className="text-left flex items-center gap-2">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${typeBadgeClass}`}>{tx.type}</Badge>
            {tx.holdingSymbol || "Transaction"}
            {isEditing && <span className="ml-auto text-xs text-muted-foreground font-normal">Editing</span>}
          </SheetTitle>
        </SheetHeader>

        {!isEditing ? (
          <div className="space-y-1 overflow-y-auto flex-1">
            {rows.map(r => (
              <div key={r.label} className="flex justify-between items-center py-2 border-b border-border/40">
                <span className="text-sm text-muted-foreground">{r.label}</span>
                <span className={`text-sm ${r.mono ? "font-mono" : ""}`}>{r.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3 overflow-y-auto flex-1 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Date</label>
                <Input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Price</label>
                <Input type="number" step="any" value={editPrice} onChange={e => setEditPrice(e.target.value)} placeholder="Optional" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Quantity</label>
                <Input type="number" step="any" value={editQty} onChange={e => setEditQty(e.target.value)} placeholder="Optional" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Fee</label>
                <Input type="number" step="any" value={editFee} onChange={e => setEditFee(e.target.value)} placeholder="0" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Tax</label>
                <Input type="number" step="any" value={editTax} onChange={e => setEditTax(e.target.value)} placeholder="0" className="h-8 text-sm font-mono" />
              </div>
              {parseFloat(editPrice) > 0 && parseFloat(editQty) > 0 && (() => {
                const gross = parseFloat(editPrice) * parseFloat(editQty);
                const net   = gross - (parseFloat(editFee) || 0) - (parseFloat(editTax) || 0);
                return (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Gross Amount</label>
                      <div className="h-8 flex items-center px-3 rounded-md bg-muted/40 text-sm font-mono text-muted-foreground">
                        {formatCurrency(gross, tx.currency)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Net Amount</label>
                      <div className={`h-8 flex items-center px-3 rounded-md bg-muted/40 text-sm font-mono ${net < 0 ? "text-loss" : ""}`}>
                        {formatCurrency(net, tx.currency)}
                      </div>
                    </div>
                  </>
                );
              })()}
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Optional" className="h-8 text-sm" />
              </div>
            </div>
          </div>
        )}

        <div className="pt-3 shrink-0 space-y-2">
          {!isEditing ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="w-full" onClick={() => setIsEditing(true)}>
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
              </Button>
              <Button variant="destructive" size="sm" className="w-full" onClick={handleDelete} disabled={deleteTx.isPending}>
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {deleteTx.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="w-full" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" className="w-full" onClick={handleSaveEdit} disabled={updateTx.isPending}>
                {updateTx.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EditHoldingDialog({ holding, portfolioId, onClose, onSuccess }: {
  holding: any; portfolioId: number; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const updateHolding = useUpdateHolding();
  const [name, setName] = useState<string>(holding.name ?? "");
  const [notes, setNotes] = useState<string>(holding.notes ?? "");
  const [targetWeight, setTargetWeight] = useState<string>(
    holding.targetWeight != null ? String(holding.targetWeight) : ""
  );

  const handleSave = () => {
    const data: any = {};
    if (name.trim()) data.name = name.trim();
    if (notes !== (holding.notes ?? "")) data.notes = notes;
    const tw = targetWeight !== "" ? parseFloat(targetWeight) : null;
    if (tw !== holding.targetWeight) data.targetWeight = tw ?? undefined;
    updateHolding.mutate({ portfolioId, holdingId: holding.id, data }, {
      onSuccess: () => { toast({ title: "Holding updated" }); onSuccess(); onClose(); },
      onError: () => toast({ title: "Failed to update holding", variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Edit {holding.symbol}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Target Weight (%)</label>
            <Input type="number" min="0" max="100" step="0.01" placeholder="—"
              value={targetWeight} onChange={e => setTargetWeight(e.target.value)} className="h-9 font-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} className="h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={updateHolding.isPending}>
            {updateHolding.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PortfolioDetail() {
  const { id } = useParams();
  const portfolioId = parseInt(id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { convert } = useFx();

  const { data: portfolio, isLoading: loadingPort } = useGetPortfolio(portfolioId, { query: { enabled: !!portfolioId, queryKey: getGetPortfolioQueryKey(portfolioId) } });
  const { data: summary, isLoading: loadingSum } = useGetPortfolioSummary(portfolioId, { query: { enabled: !!portfolioId, queryKey: getGetPortfolioSummaryQueryKey(portfolioId) } });
  const { data: holdings, isLoading: loadingHoldings } = useListHoldings(portfolioId, { query: { enabled: !!portfolioId, queryKey: getListHoldingsQueryKey(portfolioId) } });
  const { data: transactions, isLoading: loadingTx } = useListTransactions(portfolioId, { limit: 1000 }, { query: { enabled: !!portfolioId, queryKey: getListTransactionsQueryKey(portfolioId, { limit: 1000 }) } });

  useEffect(() => {
    if (!portfolioId) return;
    try { sessionStorage.setItem("folio_last_pf_id", String(portfolioId)); } catch {}
  }, [portfolioId]);

  const createHolding = useCreateHolding();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAddTxOpen, setIsAddTxOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    try { return sessionStorage.getItem(`phinance_tab_${portfolioId}`) || "holdings"; } catch { return "holdings"; }
  });

  useEffect(() => {
    if (!portfolioId) return;
    try { sessionStorage.setItem(`phinance_tab_${portfolioId}`, activeTab); } catch {}
  }, [activeTab, portfolioId]);
  const [selectedHolding, setSelectedHolding] = useState<any>(null);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [hideSold, setHideSold] = useState(() => localStorage.getItem("folio_hide_sold") === "true");
  const [holdSortKey, setHoldSortKey] = useState<string>("symbol");
  const [holdSortDir, setHoldSortDir] = useState<"asc" | "desc">("asc");
  const [holdSearchQuery, setHoldSearchQuery] = useState("");
  const [holdMobileSortOption, setHoldMobileSortOption] = useState<string>("portfolio-share");
  const [txSearchQuery, setTxSearchQuery] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState<string>("all");
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [editingHolding, setEditingHolding] = useState<any>(null);

  // ── Holdings list swipe state (mirrors Portfolio list pattern) ─────────────
  const [openHoldingSwipeId, setOpenHoldingSwipeId] = useState<number | null>(null);
  const holdingTouchStartRef = useRef<{ x: number; id: number } | null>(null);
  const holdingTouchDeltaRef = useRef<number>(0);

  useEffect(() => {
    if (openHoldingSwipeId === null) return;
    const handler = (e: PointerEvent) => {
      const el = (e.target as Element).closest("[data-holding-swipe-card]");
      if (!el || Number(el.getAttribute("data-holding-swipe-card")) !== openHoldingSwipeId) {
        setOpenHoldingSwipeId(null);
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [openHoldingSwipeId]);

  const deleteHolding = useDeleteHolding();
  const handleDeleteHolding = (h: any) => {
    if (!confirm(`Remove ${h.symbol} and all its transactions? This cannot be undone.`)) return;
    deleteHolding.mutate({ portfolioId, holdingId: h.id }, {
      onSuccess: () => {
        toast({ title: `${h.symbol} removed` });
        queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey(portfolioId) });
        queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey(portfolioId) });
      },
      onError: () => toast({ title: "Failed to delete holding", variant: "destructive" }),
    });
  };

  const handleRefreshPrices = async () => {
    if (!holdings?.length || isRefreshingPrices) return;
    setIsRefreshingPrices(true);
    try {
      const symbols = (holdings as any[]).map((h: any) => ({ symbol: h.symbol, market: h.market }));
      await fetch(`${BASE_URL}/api/prices/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
      await queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey(portfolioId) });
      await queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey(portfolioId) });
      toast({ title: "Prices refreshed" });
    } catch {
      toast({ title: "Failed to refresh prices", variant: "destructive" });
    } finally {
      setIsRefreshingPrices(false);
    }
  };

  // ── Portfolio-level dividend yield (trailing 12m actual dividends ÷ current value) ──
  const portfolioDivYield = useMemo(() => {
    if (!transactions?.items || !holdings) return null;
    try {
      const oneYearAgo = Date.now() - 365 * 86_400_000;
      let projectedAnnual = 0;
      (holdings as any[]).forEach((h: any) => {
        (transactions.items ?? [])
          .filter((tx: any) => tx.holdingId === h.id && tx.type === "DIVIDEND" && new Date(tx.date).getTime() >= oneYearAgo)
          .forEach((tx: any) => { projectedAnnual += Math.abs(parseFloat(tx.amount ?? "0") || 0); });
      });
      const portfolioTotal = (summary?.totalValue || 0) + (summary?.cashBalance || 0);
      return portfolioTotal > 0 ? (projectedAnnual / portfolioTotal) * 100 : null;
    } catch { return null; }
  }, [holdings, transactions, summary]);

  // ── FIFO metrics per holding (used for per-row gain/loss in the holdings table) ──
  const holdingFifoMap = useMemo(() => {
    const map = new Map<number, { totalProfit: number; totalProfitPct: number | null; capitalGain: number }>();
    if (!transactions?.items || !holdings) return map;
    (holdings as any[]).forEach((h: any) => {
      const txs = (transactions.items ?? []).filter((t: any) => t.holdingId === h.id);
      const fifo = computeFIFO(txs);
      const currentPrice = parseFloat(String(h.currentPrice ?? 0)) || 0;
      const unsoldShares = fifo.totalUnrealizedShares;
      const capitalGain = (currentPrice - fifo.avgCostPerShare) * unsoldShares;
      const totalProfit = capitalGain + fifo.realizedPnL + fifo.grossDividends - fifo.taxesPaid - fifo.feesPaid;
      const totalProfitPct = fifo.totalInvested > 0 ? (totalProfit / fifo.totalInvested) * 100 : null;
      map.set(h.id, { totalProfit, totalProfitPct, capitalGain });
    });
    return map;
  }, [holdings, transactions]);

  // ── Portfolio-level engine (shared with Analytics — single source of truth for metric cards) ──
  const portfolioEngine = useMemo(() => {
    if (!holdings || !transactions?.items || !portfolio) return null;
    const baseCurrency = portfolio.baseCurrency ?? "USD";
    const baseRate = convert(1, baseCurrency) || 1;
    const convertFn = (v: number, fromCurrency: string): number => {
      if (fromCurrency === baseCurrency) return v;
      return convert(v, fromCurrency) / baseRate;
    };

    const txItems = transactions.items as any[];

    const HOLDING_TX_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION", "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT"]);
    const FUND_BOND_MARKETS = new Set(["FUNDS", "BONDS"]);

    const txByHoldingId = new Map<number, any[]>();
    txItems.forEach((tx: any) => {
      if (!tx.holdingId || !HOLDING_TX_TYPES.has(tx.type)) return;
      if (!txByHoldingId.has(tx.holdingId)) txByHoldingId.set(tx.holdingId, []);
      txByHoldingId.get(tx.holdingId)!.push(tx);
    });

    const holdingEntries = (holdings as any[]).map((h: any) => {
      const holdingTxs = txByHoldingId.get(h.id) ?? [];
      const hasFundTransfer = holdingTxs.some((tx: any) => tx.type === "FUND_TRANSFER_IN" || tx.type === "FUND_TRANSFER_OUT");
      const isFundBond = FUND_BOND_MARKETS.has(h.market) || hasFundTransfer;
      const entry: any = {
        symbol: h.symbol,
        currentPrice: parseFloat(String(h.currentPrice ?? 0)) || 0,
        currency: baseCurrency,
        txs: holdingTxs,
      };
      if (isFundBond) {
        entry.precomputedCurrentValue = parseFloat(String(h.currentValue ?? 0)) || 0;
        entry.precomputedInvested = parseFloat(String(h.avgCostBasis ?? 0)) || 0;
      }
      return entry;
    });

    const depositRecords = txItems
      .filter((tx: any) => tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL")
      .map((tx: any) => ({
        type: tx.type as "DEPOSIT" | "WITHDRAWAL",
        amount: tx.amount ?? "0",
        currency: baseCurrency,
      }));

    const cashRecords = txItems
      .filter((tx: any) => tx.type === "CASH_GAIN" || tx.type === "CASH_EXPENSE")
      .map((tx: any) => ({
        type: tx.type as "CASH_GAIN" | "CASH_EXPENSE",
        amount: tx.amount ?? "0",
        currency: baseCurrency,
      }));

    return computePortfolioMetrics(holdingEntries, depositRecords, convertFn, cashRecords);
  }, [holdings, transactions, portfolio, convert]);

  const filteredSortedHoldings = [...(holdings ?? [])]
    .filter(h => {
      const qty = parseFloat(String(h.quantity ?? 0));
      if (hideSold) return qty > 0;
      return true;
    })
    .sort((a, b) => {
      // Primary: active holdings (qty > 0) first when showing all
      if (!hideSold) {
        const aActive = parseFloat(String(a.quantity ?? 0)) > 0 ? 0 : 1;
        const bActive = parseFloat(String(b.quantity ?? 0)) > 0 ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
      }
      let va: any, vb: any;
      switch (holdSortKey) {
        case "symbol": va = a.symbol; vb = b.symbol; break;
        case "asset": va = a.assetType; vb = b.assetType; break;
        case "quantity": va = parseFloat(String(a.quantity ?? 0)); vb = parseFloat(String(b.quantity ?? 0)); break;
        case "avgCost": va = parseFloat(String(a.avgCostBasis ?? 0)); vb = parseFloat(String(b.avgCostBasis ?? 0)); break;
        case "totalCost": { const qa = parseFloat(String(a.quantity ?? 0)); const qb = parseFloat(String(b.quantity ?? 0)); va = qa * parseFloat(String(a.avgCostBasis ?? 0)); vb = qb * parseFloat(String(b.avgCostBasis ?? 0)); break; }
        case "price": va = parseFloat(String(a.currentPrice ?? 0)); vb = parseFloat(String(b.currentPrice ?? 0)); break;
        case "value": va = parseFloat(String(a.currentValue ?? 0)); vb = parseFloat(String(b.currentValue ?? 0)); break;
        case "gain": va = holdingFifoMap.get(a.id)?.totalProfit ?? parseFloat(String(a.unrealizedGain ?? 0)); vb = holdingFifoMap.get(b.id)?.totalProfit ?? parseFloat(String(b.unrealizedGain ?? 0)); break;
        case "gainpct": va = holdingFifoMap.get(a.id)?.totalProfitPct ?? parseFloat(String(a.unrealizedGainPct ?? 0)); vb = holdingFifoMap.get(b.id)?.totalProfitPct ?? parseFloat(String(b.unrealizedGainPct ?? 0)); break;
        case "name": va = (a.name ?? "").toLowerCase(); vb = (b.name ?? "").toLowerCase(); break;
        default: va = a.symbol; vb = b.symbol;
      }
      if (va < vb) return holdSortDir === "asc" ? -1 : 1;
      if (va > vb) return holdSortDir === "asc" ? 1 : -1;
      return 0;
    })
    .filter(h => {
      if (!holdSearchQuery.trim()) return true;
      const q = holdSearchQuery.toLowerCase();
      return h.symbol.toLowerCase().includes(q) || (h.name ?? "").toLowerCase().includes(q);
    });

  const holdingsTotalCost = filteredSortedHoldings.reduce((s, h) => s + parseFloat(String(h.quantity ?? 0)) * parseFloat(String(h.avgCostBasis ?? 0)), 0);
  const holdingsTotalValue = filteredSortedHoldings.reduce((s, h) => s + parseFloat(String(h.currentValue ?? 0)), 0);
  const holdingsTotalGain = filteredSortedHoldings.reduce((s, h) => s + (holdingFifoMap.get(h.id)?.totalProfit ?? parseFloat(String(h.unrealizedGain ?? 0))), 0);
  const holdingsTotalGainPct = holdingsTotalCost > 0 ? (holdingsTotalGain / holdingsTotalCost) * 100 : 0;

  const handleHoldSort = (key: string) => {
    if (holdSortKey === key) setHoldSortDir(d => d === "asc" ? "desc" : "asc");
    else { setHoldSortKey(key); setHoldSortDir("asc"); }
  };

  const holdSortArrow = (col: string) =>
    holdSortKey === col ? (holdSortDir === "asc" ? " ↑" : " ↓") : "";

  const handleMobileSort = (v: string) => {
    setHoldMobileSortOption(v);
    if (v === '__asc') { setHoldSortDir('asc'); return; }
    if (v === '__desc') { setHoldSortDir('desc'); return; }
    const sortMap: Record<string, { key: string; dir: 'asc' | 'desc' }> = {
      'portfolio-share': { key: 'value', dir: 'desc' },
      'cost-basis': { key: 'totalCost', dir: 'desc' },
      'total-profit': { key: 'gain', dir: 'desc' },
      'total-profit-pct': { key: 'gainpct', dir: 'desc' },
      'capital-gain': { key: 'gain', dir: 'desc' },
      'capital-gain-pct': { key: 'gainpct', dir: 'desc' },
      'ticker': { key: 'symbol', dir: 'asc' },
      'name': { key: 'name', dir: 'asc' },
    };
    const s = sortMap[v];
    if (s) { setHoldSortKey(s.key); setHoldSortDir(s.dir); }
  };

  const filteredTxs = (transactions?.items ?? []).filter(t => {
    const q = txSearchQuery.trim().toLowerCase();
    const matchesSearch = !q ||
      (t.holdingSymbol ?? '').toLowerCase().includes(q) ||
      t.type.toLowerCase().includes(q);
    const matchesType = txTypeFilter === 'all' || t.type === txTypeFilter;
    return matchesSearch && matchesType;
  });

  const form = useForm<z.infer<typeof holdingSchema>>({
    resolver: zodResolver(holdingSchema),
    defaultValues: { assetType: "STOCK", name: "", symbol: "", currency: portfolio?.baseCurrency || "USD", notes: "" },
  });

  // Sync portfolio base currency into form once portfolio data loads
  useEffect(() => {
    if (portfolio?.baseCurrency && !form.getValues("currency")) {
      form.setValue("currency", portfolio.baseCurrency, { shouldDirty: false });
    }
  }, [portfolio?.baseCurrency]);

  const onSubmit = (values: z.infer<typeof holdingSchema>) => {
    const sym = values.symbol.toUpperCase();
    let market = "US";
    if (sym.endsWith(".PS") || sym.endsWith(".PSE")) market = "PSE";
    else if (sym.endsWith(".L")) market = "LSE";
    else if (values.assetType === "CRYPTO") market = "CRYPTO";
    else if (["SAVINGS", "CASH_ASSET", "BOND", "CUSTOM"].includes(values.assetType)) market = "CUSTOM";
    else if (values.assetType === "FUND" || portfolio?.type === "FUNDS") market = "CUSTOM";
    else if (portfolio?.type === "BONDS") market = "CUSTOM";
    createHolding.mutate({ data: { ...values, symbol: sym, market } as any, portfolioId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey(portfolioId) });
        queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey(portfolioId) });
        setIsCreateOpen(false);
        form.reset({ assetType: "STOCK", name: "", symbol: "", currency: portfolio?.baseCurrency || "USD", notes: "" });
        toast({ title: "Holding added" });
      },
      onError: (err: any) => {
        const msg = (err as any)?.data?.error ?? (err as any)?.data?.message ?? err?.message ?? "Failed to add holding";
        toast({ title: "Failed to add holding", description: msg, variant: "destructive" });
      },
    });
  };

  const handleTxSuccess = () => {
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey(portfolioId, { limit: 1000 }) });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey(portfolioId) });
    queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey(portfolioId) });
  };


  if (loadingPort) return <Skeleton className="h-64 w-full" />;
  if (!portfolio) return <div className="text-muted-foreground">Portfolio not found</div>;

  return (
    <div className="space-y-6">
      {selectedHolding && (
        <AssetDetailSheet
          holding={selectedHolding}
          baseCurrency={portfolio.baseCurrency}
          allTransactions={transactions?.items || []}
          portfolioTotalValue={parseFloat(String(summary?.totalValue ?? 0))}
          onClose={() => setSelectedHolding(null)}
        />
      )}

      {/* Fix 14: Mobile-controlled Add Transaction dialog — no button; driven by dropdown */}
      <AddTransactionDialog
        portfolioId={portfolioId}
        holdings={holdings as any[] ?? []}
        baseCurrency={portfolio.baseCurrency}
        portfolioMarket={portfolio.type}
        defaultFeeRate={Number(portfolio.defaultFeeRate) || undefined}
        sellFeeRate={Number(portfolio.sellFeeRate) || undefined}
        defaultTaxRate={Number(portfolio.defaultTaxRate) || undefined}
        onSuccess={handleTxSuccess}
        externalOpen={isAddTxOpen}
        onExternalOpenChange={setIsAddTxOpen}
      />

      <div>
        <Link
          href="/portfolios"
          onClick={() => { try { sessionStorage.removeItem("folio_last_pf_id"); } catch {} }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          All Portfolios
        </Link>
      </div>
      <div className="flex justify-between items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-3xl font-bold tracking-tight truncate">{portfolio.name}</h1>
          <p className="text-xs md:text-sm text-muted-foreground">{portfolio.type} · {portfolio.baseCurrency}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Fix 14: Mobile — single + icon button opens dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="md:hidden" aria-label="Add">
                <Plus className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setIsAddTxOpen(true)}>Add Transaction</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setIsCreateOpen(true)}>Add Holding</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Fix 14: Desktop Add Transaction button */}
          <div className="hidden md:contents">
          <AddTransactionDialog
            portfolioId={portfolioId}
            holdings={holdings as any[] ?? []}
            baseCurrency={portfolio.baseCurrency}
            portfolioMarket={portfolio.type}
            defaultFeeRate={Number(portfolio.defaultFeeRate) || undefined}
            sellFeeRate={Number(portfolio.sellFeeRate) || undefined}
            defaultTaxRate={Number(portfolio.defaultTaxRate) || undefined}
            onSuccess={handleTxSuccess}
          />
          </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="hidden md:inline-flex">
              <Plus className="w-4 h-4 mr-2" /> Add Holding
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Holding</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="assetType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tradable</div>
                        <SelectItem value="STOCK" className="pl-6">Stock</SelectItem>
                        <SelectItem value="ETF" className="pl-6">ETF</SelectItem>
                        <SelectItem value="FUND" className="pl-6">Fund</SelectItem>
                        <SelectItem value="CRYPTO" className="pl-6">Crypto</SelectItem>
                        <SelectItem value="BOND" className="pl-6">Bond</SelectItem>
                        <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border/50 mt-0.5">Non-Tradable</div>
                        <SelectItem value="SAVINGS" className="pl-6">Savings / Deposit</SelectItem>
                        <SelectItem value="CASH_ASSET" className="pl-6">Cash Asset</SelectItem>
                        <SelectItem value="CUSTOM" className="pl-6">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input placeholder="Apple Inc." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="symbol" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code / Ticker</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="AAPL"
                          {...field}
                          className="uppercase"
                          onChange={e => field.onChange(e.target.value.toUpperCase())}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="currency" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <FormControl>
                        <CurrencyCombobox value={field.value ?? ""} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl><Input placeholder="e.g. BDO Peso savings, maturity date..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <p className="text-[11px] text-muted-foreground -mt-2">
                  Market is auto-inferred from ticker (.PS → PSE, .L → LSE, CRYPTO type → CRYPTO).
                </p>
                <DialogFooter>
                  <Button type="submit" disabled={createHolding.isPending}>
                    {createHolding.isPending ? "Adding..." : "Add Holding"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Fix 15+16: Collapsible summary header on mobile scroll */}
      <div className="space-y-3 md:space-y-4">
      <Card className="border-border/60">
        <CardContent className="pt-3 pb-3 md:pt-5 md:pb-5">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1">Total Portfolio Value</div>
          <div className="text-2xl md:text-4xl font-bold tracking-tight">
            <SensitiveAmount
              value={portfolioEngine?.totalPortfolioValue ?? (summary?.totalValue || 0) + (summary?.cashBalance || 0)}
              currency={portfolio.baseCurrency}
            />
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Invested: <SensitiveAmount value={portfolioEngine?.totalInvested ?? summary?.netDeposited ?? 0} currency={portfolio.baseCurrency} />
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <Card><CardContent className="p-2.5 md:pt-4 md:pb-4 md:px-4">
          <div className="text-[9px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Profit</div>
          <div className={`text-sm md:text-xl font-bold mt-1 font-mono ${cnValue(portfolioEngine?.totalProfit ?? summary?.totalGains ?? 0)}`}>
            <SensitiveAmount value={portfolioEngine?.totalProfit ?? summary?.totalGains ?? summary?.unrealizedGain ?? 0} currency={portfolio.baseCurrency} />
          </div>
          <div className={`text-[9px] md:text-xs ${cnValue(portfolioEngine?.totalProfitPct ?? summary?.totalGainsPct ?? 0)}`}>
            {formatPercent(portfolioEngine?.totalProfitPct ?? summary?.totalGainsPct ?? summary?.unrealizedGainPct ?? 0)}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-2.5 md:pt-4 md:pb-4 md:px-4">
          <div className="text-[9px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Value</div>
          <div className="text-sm md:text-xl font-bold mt-1 font-mono"><SensitiveAmount value={portfolioEngine?.totalCurrentValue ?? summary?.totalValue ?? 0} currency={portfolio.baseCurrency} /></div>
          <div className="text-[9px] md:text-xs text-muted-foreground mt-0.5">{filteredSortedHoldings.length} holdings</div>
        </CardContent></Card>
        <Card><CardContent className="p-2.5 md:pt-4 md:pb-4 md:px-4">
          <div className="text-[9px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Cash</div>
          <div className="text-sm md:text-xl font-bold mt-1 font-mono"><SensitiveAmount value={(portfolioEngine?.totalPortfolioValue ?? (summary?.totalValue || 0) + (summary?.cashBalance || 0)) - (portfolioEngine?.totalCurrentValue ?? summary?.totalValue ?? 0)} currency={portfolio.baseCurrency} /></div>
          {portfolioEngine != null && portfolioEngine.cashIncentive !== 0 && (
            <div className={`text-[9px] md:text-xs mt-0.5 ${portfolioEngine.cashIncentive >= 0 ? "text-gain" : "text-loss"}`}>
              Cash Incentive: {portfolioEngine.cashIncentive >= 0 ? "+" : ""}{formatCurrency(portfolioEngine.cashIncentive, portfolio.baseCurrency)}
            </div>
          )}
        </CardContent></Card>
      </div>
      </div>{/* end collapsible summary */}

      {/* Fix 16: Tabs — Select dropdown on mobile, pill tabs on desktop */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="md:hidden mb-4">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="holdings">Holdings</SelectItem>
              <SelectItem value="transactions">Transactions</SelectItem>
              <SelectItem value="dividends">Dividends</SelectItem>
              <SelectItem value="rebalance">Rebalance</SelectItem>
              <SelectItem value="attribution">Attribution</SelectItem>
              <SelectItem value="notes">Notes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TabsList className="hidden md:flex">
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="dividends">Dividends</TabsTrigger>
          <TabsTrigger value="rebalance">Rebalance</TabsTrigger>
          <TabsTrigger value="attribution">Attribution</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        {/* Holdings tab */}
        <TabsContent value="holdings" className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[100px] max-w-xs">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search..."
                value={holdSearchQuery}
                onChange={e => setHoldSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="md:hidden shrink-0">
              <Select value={holdMobileSortOption} onValueChange={handleMobileSort}>
                <SelectTrigger className="h-8 text-xs w-[130px]">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__desc">Descending</SelectItem>
                  <SelectItem value="__asc">Ascending</SelectItem>
                  <SelectItem value="portfolio-share">Share in portfolio</SelectItem>
                  <SelectItem value="cost-basis">Cost Basis</SelectItem>
                  <SelectItem value="total-profit">Total Profit</SelectItem>
                  <SelectItem value="total-profit-pct">Total Profit %</SelectItem>
                  <SelectItem value="capital-gain">Capital Gain</SelectItem>
                  <SelectItem value="capital-gain-pct">Capital Gain %</SelectItem>
                  <SelectItem value="ticker">Ticker</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={() => setHideSold(v => { const next = !v; localStorage.setItem("folio_hide_sold", String(next)); return next; })}
              className={`h-8 text-xs px-2.5 rounded border transition-colors whitespace-nowrap shrink-0 ${
                hideSold
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {hideSold ? "Active only" : "All"}
            </button>
          </div>
          {/* Fix 17: Mobile card list */}
          <div className="md:hidden space-y-1.5 mb-2">
            {loadingHoldings ? (
              <Skeleton className="h-16 w-full" />
            ) : filteredSortedHoldings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {holdings?.length === 0 ? "No holdings yet. Use Add Holding above." : "No holdings match your search."}
              </div>
            ) : (
              filteredSortedHoldings.map(h => (
                <div
                  key={h.id}
                  data-holding-swipe-card={h.id}
                  className={`relative overflow-hidden rounded-lg border border-border${parseFloat(String(h.quantity ?? 0)) <= 0 ? " opacity-60" : ""}`}
                >
                  {/* Action buttons revealed on swipe */}
                  <div className="absolute right-0 top-0 bottom-0 flex items-stretch">
                    <button
                      className="w-12 flex flex-col items-center justify-center gap-0.5 bg-primary/25 hover:bg-primary/40 text-primary text-[10px] font-medium transition-colors"
                      onClick={() => { setEditingHolding(h); setOpenHoldingSwipeId(null); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      className="w-12 flex flex-col items-center justify-center gap-0.5 bg-destructive/25 hover:bg-destructive/40 text-destructive text-[10px] font-medium transition-colors"
                      onClick={() => { setOpenHoldingSwipeId(null); handleDeleteHolding(h); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </div>
                  {/* Card slides left on swipe */}
                  <div
                    className="bg-card hover:bg-muted/20 transition-colors"
                    style={{
                      transform: openHoldingSwipeId === h.id ? "translateX(-96px)" : "translateX(0)",
                      transition: "transform 0.2s ease",
                    }}
                    onTouchStart={e => {
                      holdingTouchStartRef.current = { x: e.touches[0].clientX, id: h.id };
                      holdingTouchDeltaRef.current = 0;
                      (holdingTouchStartRef.current as any).startY = e.touches[0].clientY;
                    }}
                    onTouchMove={e => {
                      if (holdingTouchStartRef.current?.id !== h.id) return;
                      const dx = e.touches[0].clientX - holdingTouchStartRef.current.x;
                      const dy = e.touches[0].clientY - ((holdingTouchStartRef.current as any).startY ?? e.touches[0].clientY);
                      if (Math.abs(dx) >= 15 && Math.abs(dx) > Math.abs(dy)) {
                        holdingTouchDeltaRef.current = dx;
                      } else if (Math.abs(dy) > Math.abs(dx)) {
                        holdingTouchDeltaRef.current = 0;
                      }
                    }}
                    onTouchEnd={() => {
                      if (holdingTouchDeltaRef.current < -40) setOpenHoldingSwipeId(h.id);
                      else if (holdingTouchDeltaRef.current > 40) setOpenHoldingSwipeId(null);
                      holdingTouchStartRef.current = null;
                      holdingTouchDeltaRef.current = 0;
                    }}
                  >
                    <button onClick={() => setSelectedHolding(h)}
                      className="flex items-center justify-between w-full px-3 py-2.5 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <StockLogo symbol={h.symbol} size={22} />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-sm">{h.symbol}</span>
                              {parseFloat(String(h.quantity ?? 0)) <= 0 && (
                                <span className="text-[9px] px-1 py-0.5 rounded-sm bg-muted text-muted-foreground border border-border/50">CLOSED</span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground">{parseFloat(String(h.quantity ?? 0)).toFixed(2)} sh · {h.assetType}</div>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <div className="font-medium text-sm">{formatCurrency(h.currentValue, portfolio.baseCurrency)}</div>
                        {(() => {
                          const fm = holdingFifoMap.get(h.id);
                          const profit = fm?.totalProfit ?? parseFloat(String(h.unrealizedGain ?? 0));
                          const pct = fm?.totalProfitPct ?? parseFloat(String(h.unrealizedGainPct ?? 0));
                          const pctStr = pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : formatPercent(h.unrealizedGainPct);
                          return <div className={`text-[10px] ${cnValue(profit)}`}>{pctStr}</div>;
                        })()}
                      </div>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="hidden md:block bg-card rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleHoldSort("symbol")}>Symbol{holdSortArrow("symbol")}</TableHead>
                    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleHoldSort("asset")}>Asset{holdSortArrow("asset")}</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleHoldSort("quantity")}>Quantity{holdSortArrow("quantity")}</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleHoldSort("avgCost")}>Avg Cost{holdSortArrow("avgCost")}</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleHoldSort("totalCost")}>Total Cost{holdSortArrow("totalCost")}</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleHoldSort("price")}>Price{holdSortArrow("price")}</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleHoldSort("value")}>Value{holdSortArrow("value")}</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleHoldSort("gain")}>Gain/Loss{holdSortArrow("gain")}</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingHoldings ? (
                    <TableRow><TableCell colSpan={9} className="py-8"><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                  ) : filteredSortedHoldings.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">{holdings?.length === 0 ? "No holdings yet. Use Add Holding above." : "No holdings match your search."}</TableCell></TableRow>
                  ) : (
                    filteredSortedHoldings.map(h => {
                      const totalCost = parseFloat(String(h.quantity ?? 0)) * parseFloat(String(h.avgCostBasis ?? 0));
                      return (
                        <TableRow
                          key={h.id}
                          className={`group/row cursor-pointer hover:bg-muted/30 transition-colors${parseFloat(String(h.quantity ?? 0)) <= 0 ? " opacity-50" : ""}`}
                          onClick={() => setSelectedHolding(h)}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <StockLogo symbol={h.symbol} size={28} />
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span>{h.symbol}</span>
                                  {parseFloat(String(h.quantity ?? 0)) <= 0 && (
                                    <span className="text-[9px] px-1 py-0.5 rounded-sm bg-muted text-muted-foreground border border-border/50 font-normal">CLOSED</span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">{h.name}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><Badge variant="secondary" className="text-xs">{h.assetType}</Badge></TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(h.quantity, 2)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(h.avgCostBasis, portfolio.baseCurrency)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(totalCost, portfolio.baseCurrency)}</TableCell>
                          <TableCell className="text-right font-mono">{formatCurrency(h.currentPrice, portfolio.baseCurrency)}</TableCell>
                          <TableCell className="text-right font-mono font-medium">{formatCurrency(h.currentValue, portfolio.baseCurrency)}</TableCell>
                          {(() => {
                            const fm = holdingFifoMap.get(h.id);
                            const gain = fm?.totalProfit ?? parseFloat(String(h.unrealizedGain ?? 0));
                            const pct = fm?.totalProfitPct;
                            const pctStr = pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : formatPercent(h.unrealizedGainPct);
                            return (
                              <TableCell className={`text-right font-mono ${cnValue(gain)}`}>
                                {formatCurrency(gain, portfolio.baseCurrency)}
                                <br />
                                <span className="text-xs opacity-80">{pctStr}</span>
                              </TableCell>
                            );
                          })()}
                          <TableCell className="w-16" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                              <button onClick={e => { e.stopPropagation(); setEditingHolding(h); }} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={e => { e.stopPropagation(); handleDeleteHolding(h); }} className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted/60 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                  {!loadingHoldings && filteredSortedHoldings.length > 0 && (
                    <TableRow className="bg-muted/30 font-semibold border-t-2 border-border">
                      <TableCell colSpan={4} className="text-xs text-muted-foreground uppercase tracking-wider">
                        Total ({filteredSortedHoldings.length})
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(holdingsTotalCost, portfolio.baseCurrency)}
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-right font-mono font-semibold">
                        {formatCurrency(holdingsTotalValue, portfolio.baseCurrency)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${cnValue(holdingsTotalGain)}`}>
                        {formatCurrency(holdingsTotalGain, portfolio.baseCurrency)}
                        <br />
                        <span className="text-xs opacity-80">{holdingsTotalGainPct != null ? `${holdingsTotalGainPct >= 0 ? "+" : ""}${holdingsTotalGainPct.toFixed(2)}%` : "—"}</span>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2 hidden md:block">Click any row to view holding details and its transactions.</p>
        </TabsContent>

        {/* Transactions tab */}
        <TabsContent value="transactions" className="mt-4">
          <div className="flex items-center gap-1.5 mb-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search"
                value={txSearchQuery}
                onChange={e => setTxSearchQuery(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Select value={txTypeFilter} onValueChange={setTxTypeFilter}>
              <SelectTrigger className="h-8 text-xs w-[80px] shrink-0">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="BUY">Buy</SelectItem>
                <SelectItem value="SELL">Sell</SelectItem>
                <SelectItem value="DIVIDEND">Dividend</SelectItem>
                <SelectItem value="DEPOSIT">Deposit</SelectItem>
                <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                <SelectItem value="FEE">Fee</SelectItem>
                <SelectItem value="TAX">Tax</SelectItem>
                <SelectItem value="CASH_GAIN">Cash Gain</SelectItem>
                <SelectItem value="CASH_EXPENSE">Cash Expense</SelectItem>
              </SelectContent>
            </Select>
            {holdings && (
              <AddTransactionDialog
                portfolioId={portfolioId}
                holdings={holdings as any[]}
                baseCurrency={portfolio.baseCurrency}
                portfolioMarket={portfolio.type}
                defaultFeeRate={Number(portfolio.defaultFeeRate) || undefined}
                sellFeeRate={Number(portfolio.sellFeeRate) || undefined}
                defaultTaxRate={Number(portfolio.defaultTaxRate) || undefined}
                onSuccess={handleTxSuccess}
              />
            )}
          </div>
          {/* Fix 18: Mobile card list for transactions — clickable, filterable */}
          <div className="md:hidden space-y-1.5 mb-2">
            {selectedTx && (
              <TxDetailSheet
                tx={selectedTx}
                portfolioId={portfolioId}
                onClose={() => setSelectedTx(null)}
                onDeleted={handleTxSuccess}
              />
            )}
            {loadingTx ? (
              <Skeleton className="h-14 w-full" />
            ) : !filteredTxs.length ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {transactions?.items?.length ? "No transactions match your filter." : "No transactions. Use Add Transaction above."}
              </div>
            ) : (
              filteredTxs.map(t => (
                <button key={t.id} onClick={() => setSelectedTx(t)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-card text-left hover:bg-muted/20 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                        t.type === 'BUY' ? 'border-blue-500 text-blue-400' :
                        t.type === 'SELL' ? 'border-red-500 text-red-400' :
                        t.type === 'DIVIDEND' ? 'border-green-500 text-green-400' :
                        t.type === 'FUND_TRANSFER_IN' ? 'border-teal-500 text-teal-400' :
                        t.type === 'FUND_TRANSFER_OUT' ? 'border-orange-500 text-orange-400' :
                        'border-border text-muted-foreground'
                      }`}>{t.type}</Badge>
                      <span className="font-semibold text-sm">{t.holdingSymbol || '—'}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{format(new Date(t.date), 'MMM d, yyyy')}{t.quantity ? ` · ${formatNumber(t.quantity, 2)} sh` : ''}</div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="font-medium text-sm"><SensitiveAmount value={getNetAmount(t)} currency={t.currency} /></div>
                    {t.price && <div className="text-[10px] text-muted-foreground">@ {formatCurrency(t.price, t.currency)}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="hidden md:block bg-card rounded-lg border border-border shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Net Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingTx ? (
                  <TableRow><TableCell colSpan={6} className="py-8"><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                ) : !filteredTxs.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    {transactions?.items?.length ? "No transactions match your filter." : "No transactions. Use Add Transaction above."}
                  </TableCell></TableRow>
                ) : (
                  filteredTxs.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm">{format(new Date(t.date), 'MMM d, yyyy')}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${
                          t.type === 'BUY' ? 'border-blue-500 text-blue-400' :
                          t.type === 'SELL' ? 'border-red-500 text-red-400' :
                          t.type === 'DIVIDEND' ? 'border-green-500 text-green-400' :
                          t.type === 'FUND_TRANSFER_IN' ? 'border-teal-500 text-teal-400' :
                          t.type === 'FUND_TRANSFER_OUT' ? 'border-orange-500 text-orange-400' :
                          'border-border text-muted-foreground'
                        }`}>{t.type}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{t.holdingSymbol || '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{t.quantity ? formatNumber(t.quantity, 2) : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{t.price ? formatCurrency(t.price, t.currency) : '-'}</TableCell>
                      <TableCell className="text-right font-mono font-medium"><SensitiveAmount value={getNetAmount(t)} currency={t.currency} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="dividends" className="mt-4">
          <DividendsTab portfolioId={portfolioId} baseCurrency={portfolio.baseCurrency} holdings={holdings ?? []} />
        </TabsContent>

        <TabsContent value="rebalance" className="mt-4">
          <RebalanceTab portfolioId={portfolioId} baseCurrency={portfolio.baseCurrency} />
        </TabsContent>

        <TabsContent value="attribution" className="mt-4">
          <AttributionTab portfolioId={portfolioId} baseCurrency={portfolio.baseCurrency} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesPanel portfolioId={portfolioId} />
        </TabsContent>
      </Tabs>
      {editingHolding && (
        <EditHoldingDialog
          holding={editingHolding}
          portfolioId={portfolioId}
          onClose={() => setEditingHolding(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey(portfolioId) })}
        />
      )}
    </div>
  );
}

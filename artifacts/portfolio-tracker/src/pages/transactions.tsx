import { useState, useEffect, useRef, useMemo } from "react";
import {
  useListTransactions,
  useBatchDeleteTransactions,
  useListPortfolios,
  useListHoldings,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useSearchSymbols,
  getListHoldingsQueryKey,
  getListTransactionsQueryKey,
  getGetPortfolioSummaryQueryKey,
} from "@workspace/api-client-react";
import { CurrencyCombobox } from "@/components/currency-combobox";
import { formatCurrency, formatNumber, getNetAmount } from "@/lib/format";
import { SensitiveAmount } from "@/components/amount";
import { TxFormSummary } from "@/components/tx-form-summary";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, RefreshCw, Pencil, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DragHandle, useSwipeToClose } from "@/components/drag-handle";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const PAGE_SIZE = 25;

type TxType = "BUY" | "SELL" | "DIVIDEND" | "FEE" | "TAX" | "DEPOSIT" | "WITHDRAWAL" | "CASH_GAIN" | "CASH_EXPENSE";
type TabId = "all" | "trades" | "incomes" | "cash";

const TX_TYPES: TxType[] = ["BUY", "SELL", "DIVIDEND", "DEPOSIT", "WITHDRAWAL", "FEE", "TAX", "CASH_GAIN", "CASH_EXPENSE"];

function typeTextClass(type: string) {
  switch (type) {
    case "BUY": return "text-gain font-medium";
    case "SELL": return "text-loss font-medium";
    case "DIVIDEND": case "CASH_GAIN": case "DEPOSIT": return "text-gain font-medium";
    case "WITHDRAWAL": case "CASH_EXPENSE": return "text-loss font-medium";
    default: return "text-muted-foreground font-medium";
  }
}

function amountClass(type: string) {
  if (["BUY", "DIVIDEND", "CASH_GAIN", "DEPOSIT"].includes(type)) return "text-gain";
  if (["SELL", "WITHDRAWAL", "CASH_EXPENSE", "FEE", "TAX"].includes(type)) return "text-loss";
  return "";
}


type SymbolSelection = { id?: number; symbol: string; name: string; market: string };

// ─── Add Transaction Dialog ────────────────────────────────────────────────────

function AddTransactionDialog({
  portfolios,
  defaultPortfolioId,
  onSuccess,
}: {
  portfolios: any[];
  defaultPortfolioId?: number;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const createTx = useCreateTransaction();
  const searchRef = useRef<HTMLDivElement>(null);

  const [txPortfolioId, setTxPortfolioId] = useState(defaultPortfolioId ? String(defaultPortfolioId) : "");
  const [txType, setTxType] = useState<TxType>("BUY");
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

  const [selectedSymbol, setSelectedSymbol] = useState<SymbolSelection | null>(null);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchMarketOverride, setSearchMarketOverride] = useState<string>("US");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(symbolQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [symbolQuery]);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const parsedPortfolioId = parseInt(txPortfolioId || "0");
  const selectedPortfolio = portfolios?.find(p => p.id === parsedPortfolioId);

  // Sync market override when portfolio selection changes
  useEffect(() => {
    if (selectedPortfolio?.type && selectedPortfolio.type !== "MIXED") {
      setSearchMarketOverride(selectedPortfolio.type);
    }
  }, [selectedPortfolio?.type]);

  // Use portfolio's fee/tax rates (supports 4dp)
  const portfolioFeeRate = selectedPortfolio ? (selectedPortfolio.defaultFeeRate ?? 0) : 0;
  const portfolioSellFeeRate = selectedPortfolio ? (selectedPortfolio.sellFeeRate ?? 0) : 0;
  const portfolioTaxRate = selectedPortfolio ? (selectedPortfolio.defaultTaxRate ?? 0) : 0;

  const { data: holdingsForPortfolio } = useListHoldings(parsedPortfolioId, {
    query: { enabled: parsedPortfolioId > 0, queryKey: getListHoldingsQueryKey(parsedPortfolioId) },
  });

  const { data: searchResults, isFetching: isSearching } = useSearchSymbols(
    { q: debouncedQuery || "_", market: searchMarketOverride as any },
    { query: { enabled: debouncedQuery.length >= 1 && showSuggestions } as any }
  );

  const existingMatches = debouncedQuery.length >= 1
    ? (holdingsForPortfolio ?? []).filter((h: any) =>
        h.symbol.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        (h.name ?? "").toLowerCase().includes(debouncedQuery.toLowerCase())
      )
    : [];
  const existingSet = new Set(existingMatches.map((h: any) => `${h.symbol}:${h.market}`));
  const liveSuggestions = (searchResults ?? []).filter(r => !existingSet.has(`${r.symbol}:${r.market}`));

  const needsHolding = txType === "BUY" || txType === "SELL" || txType === "DIVIDEND";
  const needsQtyPrice = txType === "BUY" || txType === "SELL";
  const isTrade = txType === "BUY" || txType === "SELL";
  const isIncome = txType === "DIVIDEND" || txType === "CASH_GAIN";

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
    setTxCurrency(selectedPortfolio?.baseCurrency || "USD"); setPriceStatus(null); setPriceLabel(null);
    if (isTrade) fetchLivePrice(sym);
  };

  const qty = parseFloat(txQty || "0");
  const pricePerShare = parseFloat(txPrice || "0");
  const subtotal = needsQtyPrice ? qty * pricePerShare : pricePerShare;

  // Fee rate depends on transaction type: SELL uses sellFeeRate, BUY uses defaultFeeRate
  const applicableFeeRate = txType === "SELL" ? portfolioSellFeeRate : portfolioFeeRate;
  // Auto-compute from current subtotal — no stale closure; shown as placeholder
  const autoFee = isTrade && subtotal > 0 ? subtotal * applicableFeeRate / 100 : 0;
  const autoTax = isIncome && subtotal > 0 ? subtotal * portfolioTaxRate / 100 : 0;
  // Use user-entered value if present, otherwise the auto-computed amount
  const feeAmt = txFeeAmt !== "" ? parseFloat(txFeeAmt) : autoFee;
  const taxAmt = txTaxAmt !== "" ? parseFloat(txTaxAmt) : autoTax;
  const totalAmount = subtotal + feeAmt + taxAmt;

  const resetForm = () => {
    setTxPortfolioId(defaultPortfolioId ? String(defaultPortfolioId) : "");
    setTxType("BUY"); setTxDate(new Date().toISOString().split("T")[0]);
    setTxQty(""); setTxPrice(""); setTxFeeAmt(""); setTxTaxAmt("");
    setTxNotes(""); setTxCurrency("USD"); setPriceStatus(null); setPriceLabel(null);
    setSelectedSymbol(null); setSymbolQuery(""); setDebouncedQuery("");
  };

  const handleOpen = () => {
    if (defaultPortfolioId) {
      setTxPortfolioId(String(defaultPortfolioId));
      const p = portfolios.find(pp => pp.id === defaultPortfolioId);
      if (p) setTxCurrency(p.baseCurrency || "USD");
    }
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!txPortfolioId) { toast({ title: "Select a portfolio", variant: "destructive" }); return; }
    if (needsHolding && !selectedSymbol) { toast({ title: "Select a stock or symbol", variant: "destructive" }); return; }
    if (!txDate) { toast({ title: "Enter a date", variant: "destructive" }); return; }
    const amt = totalAmount || pricePerShare || 0;
    if (amt <= 0) { toast({ title: "Enter an amount or quantity + price", variant: "destructive" }); return; }

    const payload: any = {
      type: txType, date: txDate,
      quantity: txQty ? parseFloat(txQty) : undefined,
      price: pricePerShare > 0 ? pricePerShare : undefined,
      amount: amt,
      feeAmount: feeAmt > 0 ? feeAmt : undefined,
      taxAmount: taxAmt > 0 ? taxAmt : undefined,
      currency: txCurrency,
      notes: txNotes || undefined,
    };
    if (selectedSymbol) {
      if (selectedSymbol.id) { payload.holdingId = selectedSymbol.id; }
      else { payload.holdingId = null; payload.symbol = selectedSymbol.symbol; payload.market = selectedSymbol.market; payload.name = selectedSymbol.name; payload.assetType = "STOCK"; }
    }

    createTx.mutate({ portfolioId: parsedPortfolioId, data: payload as any }, {
      onSuccess: () => { toast({ title: "Transaction added" }); setOpen(false); resetForm(); onSuccess(); },
      onError: () => toast({ title: "Failed to add transaction", variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) resetForm(); }}>
      <Button onClick={handleOpen} size="sm">
        <Plus className="w-4 h-4 mr-2" /> Add Transaction
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Transaction</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Portfolio + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Portfolio</label>
              <Select value={txPortfolioId} onValueChange={(v) => {
                setTxPortfolioId(v);
                setSelectedSymbol(null); setTxFeeAmt(""); setTxTaxAmt("");
                const p = portfolios.find(pp => pp.id === parseInt(v));
                if (p) setTxCurrency(p.baseCurrency || "USD");
              }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {portfolios?.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={txType} onValueChange={(v) => { setTxType(v as TxType); setSelectedSymbol(null); setTxFeeAmt(""); setTxTaxAmt(""); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TX_TYPES.map(t => <SelectItem key={t} value={t}>{formatTxType(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Fee/tax hint */}
          {selectedPortfolio && (isTrade && portfolioFeeRate > 0 || isIncome && portfolioTaxRate > 0) && (
            <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
              {isTrade && portfolioFeeRate > 0 && `Fee: ${portfolioFeeRate}% of subtotal`}
              {isTrade && portfolioFeeRate > 0 && isIncome && portfolioTaxRate > 0 && " · "}
              {isIncome && portfolioTaxRate > 0 && `Tax: ${portfolioTaxRate}% of amount`}
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Date</label>
            <Input type="date" value={txDate} onChange={e => setTxDate(e.target.value)} className="h-9" />
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
                    placeholder={txPortfolioId ? "Type ticker or company name…" : "Select a portfolio first"}
                    value={symbolQuery}
                    onChange={e => { setSymbolQuery(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    disabled={!txPortfolioId}
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
                  {priceStatus === "unavailable" ? "Price unavailable — enter manually" : (priceLabel ?? (priceStatus === "live" ? "Live price" : "Delayed price"))}
                </p>
              )}
            </div>
          )}

          {needsQtyPrice ? (
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
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Amount</label>
              <Input type="number" min="0" step="any" placeholder="0.00" value={txPrice} onChange={e => setTxPrice(e.target.value)} className="h-9 font-mono" />
            </div>
          )}

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
                {isIncome ? "Dividend Tax" : "Tax"}
                {isIncome && portfolioTaxRate > 0 && <span className="text-muted-foreground font-normal ml-1">({portfolioTaxRate.toFixed(4)}%)</span>}
              </label>
              <Input type="number" min="0" step="0.0001" placeholder={autoTax > 0 ? autoTax.toFixed(4) : "0.0000"} value={txTaxAmt} onChange={e => setTxTaxAmt(e.target.value)} className="h-9 font-mono" />
            </div>
          </div>

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
            <div className="bg-muted/50 rounded-lg p-3 text-sm flex justify-between items-center">
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
            {createTx.isPending ? "Saving..." : "Add Transaction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatTxType(type: string): string {
  switch (type) {
    case "BUY": return "Buy";
    case "SELL": return "Sell";
    case "DIVIDEND": return "Dividend";
    case "DEPOSIT": return "Deposit";
    case "WITHDRAWAL": return "Withdrawal";
    case "FEE": return "Fee";
    case "TAX": return "Tax";
    case "CASH_GAIN": return "Cash Gain";
    case "CASH_EXPENSE": return "Cash Expense";
    default: return type;
  }
}

// ─── Transaction Detail Dialog ────────────────────────────────────────────────

function TransactionDetailDialog({
  transaction,
  onClose,
  onEdit,
  onDelete,
}: {
  transaction: any;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const currency = transaction.currency ?? "USD";
  const isBuy = transaction.type === "BUY";
  const isSell = transaction.type === "SELL";
  const isDividend = transaction.type === "DIVIDEND";
  const gross = parseFloat(transaction.amount ?? "0");
  const fee = parseFloat(transaction.feeAmount ?? "0");
  const tax = parseFloat(transaction.taxAmount ?? "0");
  const netAmt = getNetAmount(transaction);
  const qty = parseFloat(transaction.quantity ?? "0");
  const price = parseFloat(transaction.price ?? "0");

  let dateDisplay = transaction.date ?? "";
  try { if (transaction.date) dateDisplay = format(new Date(transaction.date), "MMM d, yyyy"); } catch {}

  const Row = ({ label, value, valueClass, indent }: { label: string; value: string; valueClass?: string; indent?: boolean }) => (
    <div className={`flex justify-between py-1.5 border-b border-border/30 ${indent ? "pl-2" : ""}`}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-mono ${valueClass ?? ""}`}>{value}</span>
    </div>
  );

  const swipeHandlers = useSwipeToClose(onClose);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm" {...swipeHandlers}>
        <DragHandle />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`text-sm font-bold ${typeTextClass(transaction.type)}`}>{formatTxType(transaction.type)}</span>
            {transaction.holdingSymbol && (
              <span className="font-mono font-bold text-foreground">{transaction.holdingSymbol}</span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="py-1">
          <Row label="Date" value={dateDisplay} />
          {qty > 0 && <Row label="Quantity" value={formatNumber(qty, 4)} />}
          {price > 0 && <Row label="Price" value={formatCurrency(price, currency)} />}
          {gross > 0 && <Row label="Gross Amount" value={formatCurrency(gross, currency)} />}
          {fee > 0 && (
            <Row
              label={isBuy ? "+ Fee" : "− Fee"}
              value={`${isBuy ? "+" : "−"}${formatCurrency(fee, currency)}`}
              valueClass={isBuy ? undefined : "text-destructive"}
            />
          )}
          {tax > 0 && (isDividend || isSell) && (
            <Row label="− Tax" value={`−${formatCurrency(tax, currency)}`} valueClass="text-destructive" />
          )}
          <div className="flex justify-between py-2 mt-1">
            <span className="text-sm font-semibold">Net Amount</span>
            <span className="text-sm font-mono font-bold text-gain">{formatCurrency(netAmt, currency)}</span>
          </div>
          {transaction.notes && (
            <div className="mt-1 bg-muted/40 rounded px-3 py-2 text-xs text-muted-foreground">{transaction.notes}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Transaction Dialog ───────────────────────────────────────────────────

function EditTransactionDialog({
  transaction,
  onClose,
  onSuccess,
}: {
  transaction: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const updateTx = useUpdateTransaction();
  const { data: portfolios } = useListPortfolios();

  const portfolio = portfolios?.find((p: any) => p.id === transaction.portfolioId);
  const defaultFeeRate = Number(portfolio?.defaultFeeRate) || 0;
  const sellFeeRate = Number(portfolio?.sellFeeRate) || 0;
  const defaultTaxRate = Number(portfolio?.defaultTaxRate) || 0;

  const [txType, setTxType] = useState<string>(transaction.type);
  const isBuy = txType === "BUY";
  const isSell = txType === "SELL";
  const isDividend = ["DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION"].includes(txType);
  const needsQtyPrice = ["BUY", "SELL", "DIVIDEND", "STOCK_SPLIT"].includes(txType);
  const isCashType = ["DEPOSIT", "WITHDRAWAL", "CASH_GAIN", "CASH_EXPENSE", "FEE", "TAX", "MATURITY"].includes(txType);

  const [date, setDate] = useState(transaction.date ?? "");
  const [qty, setQty] = useState(transaction.quantity?.toString() ?? "");
  const [price, setPrice] = useState(transaction.price?.toString() ?? "");
  const [cashAmount, setCashAmount] = useState(transaction.amount?.toString() ?? "");
  const [fee, setFee] = useState(transaction.feeAmount?.toString() ?? "");
  const [tax, setTax] = useState(transaction.taxAmount?.toString() ?? "");
  const [currency, setCurrency] = useState(transaction.currency ?? "USD");
  const [notes, setNotes] = useState(transaction.notes ?? "");

  const grossVal = needsQtyPrice
    ? parseFloat(qty || "0") * parseFloat(price || "0")
    : 0;

  const applicableFeeRate = isSell ? sellFeeRate : defaultFeeRate;
  const autoFee = (isBuy || isSell) && grossVal > 0 ? grossVal * applicableFeeRate / 100 : 0;
  const autoTax = isDividend && grossVal > 0 ? grossVal * defaultTaxRate / 100 : 0;

  const feeVal = fee !== "" ? parseFloat(fee) : autoFee;
  const taxVal = tax !== "" ? parseFloat(tax) : autoTax;

  const displayGross = isCashType ? parseFloat(cashAmount || "0") : (needsQtyPrice ? grossVal : parseFloat(price || "0"));
  const showNetSummary = displayGross > 0;

  const handleSave = () => {
    if (!date) { toast({ title: "Date required", variant: "destructive" }); return; }
    const gross = isCashType ? parseFloat(cashAmount || "0") : (needsQtyPrice ? grossVal : parseFloat(price || "0"));
    if (!isCashType && needsQtyPrice && gross <= 0 && txType !== "STOCK_SPLIT") {
      toast({ title: "Enter quantity and price", variant: "destructive" }); return;
    }
    updateTx.mutate({
      portfolioId: transaction.portfolioId,
      transactionId: transaction.id,
      data: {
        type: txType as any,
        date,
        quantity: qty ? parseFloat(qty) : null,
        price: parseFloat(price || "0") > 0 ? parseFloat(price) : null,
        amount: gross || 0,
        feeAmount: feeVal > 0 ? feeVal : null,
        taxAmount: taxVal > 0 ? taxVal : null,
        currency,
        notes: notes || null,
      } as any,
    }, {
      onSuccess: () => { toast({ title: "Transaction updated" }); onSuccess(); onClose(); },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DragHandle />
        <DialogHeader>
          <DialogTitle>Edit Transaction</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">

          {/* Type + Date — matches Add Transaction layout */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={txType} onValueChange={v => { setTxType(v); setFee(""); setTax(""); }}>
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
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* Symbol chip — read-only, matches Add form's selected-symbol display */}
          {transaction.holdingSymbol && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Stock / Symbol</label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/30">
                <span className="font-mono font-semibold text-sm">{transaction.holdingSymbol}</span>
                {transaction.holdingName && (
                  <span className="text-muted-foreground text-xs ml-1 truncate flex-1">{transaction.holdingName}</span>
                )}
                {transaction.holdingMarket && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{transaction.holdingMarket}</span>
                )}
              </div>
            </div>
          )}

          {/* Qty + Price for trades and dividends */}
          {needsQtyPrice && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {isDividend ? "No. of Shares" : txType === "STOCK_SPLIT" ? "New Shares" : "Quantity"}
                </label>
                <Input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} className="h-9 font-mono" placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {isDividend ? "Price per Share" : "Price / Share"}
                </label>
                <Input type="number" min="0" step="any" value={price} onChange={e => setPrice(e.target.value)} className="h-9 font-mono" placeholder="0.00" />
              </div>
            </div>
          )}

          {/* Amount for cash types and non-qty types */}
          {(isCashType || (!needsQtyPrice && !isCashType)) && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Amount</label>
              <Input
                type="number" min="0" step="any"
                value={isCashType ? cashAmount : price}
                onChange={e => isCashType ? setCashAmount(e.target.value) : setPrice(e.target.value)}
                className="h-9 font-mono"
                placeholder="0.00"
              />
            </div>
          )}

          {/* Fee + Tax — BUY/SELL only, 2-col grid matching Add form */}
          {(isBuy || isSell) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {isSell ? "Sell Fee & Tax" : "Buy Fee"}
                  {applicableFeeRate > 0 && <span className="text-muted-foreground font-normal ml-1">({applicableFeeRate.toFixed(4)}%)</span>}
                </label>
                <Input
                  type="number" min="0" step="0.0001"
                  value={fee}
                  onChange={e => setFee(e.target.value)}
                  className="h-9 font-mono"
                  placeholder={autoFee > 0 ? autoFee.toFixed(4) : "0.0000"}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tax</label>
                <Input
                  type="number" min="0" step="0.0001"
                  value={tax}
                  onChange={e => setTax(e.target.value)}
                  className="h-9 font-mono"
                  placeholder="0.0000"
                />
              </div>
            </div>
          )}

          {/* Dividend Tax — full width, matching Add form */}
          {isDividend && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Dividend Tax
                {defaultTaxRate > 0 && <span className="text-muted-foreground font-normal ml-1">({defaultTaxRate.toFixed(2)}%)</span>}
              </label>
              <Input
                type="number" min="0" step="0.0001"
                value={tax}
                onChange={e => setTax(e.target.value)}
                className="h-9 font-mono"
                placeholder={autoTax > 0 ? autoTax.toFixed(4) : "0.0000"}
              />
            </div>
          )}

          {/* Currency */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Currency</label>
            <CurrencyCombobox value={currency} onChange={setCurrency} />
          </div>

          {/* Summary — before Notes, matching Add form order */}
          {showNetSummary && (
            <TxFormSummary
              type={txType}
              currency={currency}
              gross={displayGross}
              fee={isBuy || isSell ? feeVal : 0}
              tax={taxVal}
            />
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes</label>
            <Input placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} className="h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateTx.isPending}>
            {updateTx.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Transactions Page ────────────────────────────────────────────────────

const TAB_FILTERS: Record<TabId, (type: string) => boolean> = {
  all: () => true,
  trades: (t) => ["BUY", "SELL"].includes(t),
  incomes: (t) => ["DIVIDEND", "CASH_GAIN"].includes(t),
  cash: (t) => ["DEPOSIT", "WITHDRAWAL", "CASH_EXPENSE", "FEE", "TAX"].includes(t),
};

export default function Transactions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: portfolios } = useListPortfolios();
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [page, setPage] = useState(0);
  const [editTx, setEditTx] = useState<any>(null);
  const [viewTx, setViewTx] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Default to first portfolio once loaded
  useEffect(() => {
    if (portfolios?.length && selectedPortfolioId === null) {
      setSelectedPortfolioId(portfolios[0].id);
    }
  }, [portfolios]);

  const activePfId = selectedPortfolioId ?? 0;

  const { data: transactions, isLoading, isError } = useListTransactions(
    activePfId,
    { limit: 2000 },
    { query: { enabled: activePfId > 0, queryKey: getListTransactionsQueryKey(activePfId) } }
  );
  const batchDelete = useBatchDeleteTransactions();
  const deleteTx = useDeleteTransaction();

  const allItems = transactions?.items ?? [];

  const filteredItems = useMemo(() => {
    const fn = TAB_FILTERS[activeTab];
    let items = allItems.filter(t => fn(t.type));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(t =>
        ((t as any).holdingSymbol ?? "").toLowerCase().includes(q) ||
        ((t as any).holdingName ?? "").toLowerCase().includes(q) ||
        (t.notes ?? "").toLowerCase().includes(q)
      );
    }
    if (typeFilter) {
      items = items.filter(t => t.type === typeFilter);
    }
    return items;
  }, [allItems, activeTab, searchQuery, typeFilter]);

  const totalPages = Math.ceil(filteredItems.length / PAGE_SIZE);
  const pagedItems = filteredItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [activeTab, selectedPortfolioId, searchQuery, typeFilter]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey(activePfId) });
    queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey(0) });
    if (activePfId > 0) {
      queryClient.invalidateQueries({ queryKey: getListHoldingsQueryKey(activePfId) });
      queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey(activePfId) });
    }
  };

  const toggleSelect = (id: number) => {
    const s = new Set(selectedIds);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedIds(s);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pagedItems.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(pagedItems.map(t => t.id)));
  };

  const handleBatchDelete = () => {
    if (!confirm(`Delete ${selectedIds.size} transaction${selectedIds.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    const pId = allItems.find(t => selectedIds.has(t.id))?.portfolioId || 0;
    batchDelete.mutate(
      { portfolioId: pId, data: { ids: Array.from(selectedIds) } },
      {
        onSuccess: () => { invalidate(); setSelectedIds(new Set()); toast({ title: "Transactions deleted" }); },
      }
    );
  };

  const handleDeleteSingle = (tx: any) => {
    if (!confirm(`Delete this ${tx.type} transaction? This cannot be undone.`)) return;
    deleteTx.mutate(
      { portfolioId: tx.portfolioId, transactionId: tx.id },
      {
        onSuccess: () => { invalidate(); toast({ title: "Transaction deleted" }); },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  };

  const tabCounts = useMemo(() => ({
    all: allItems.length,
    trades: allItems.filter(t => TAB_FILTERS.trades(t.type)).length,
    incomes: allItems.filter(t => TAB_FILTERS.incomes(t.type)).length,
    cash: allItems.filter(t => TAB_FILTERS.cash(t.type)).length,
  }), [allItems]);

  return (
    <div className="space-y-6 relative pb-20">
      {viewTx && !editTx && (
        <TransactionDetailDialog
          transaction={viewTx}
          onClose={() => setViewTx(null)}
          onEdit={() => { setEditTx(viewTx); setViewTx(null); }}
          onDelete={() => { setViewTx(null); handleDeleteSingle(viewTx); }}
        />
      )}
      {editTx && (
        <EditTransactionDialog
          transaction={editTx}
          onClose={() => setEditTx(null)}
          onSuccess={invalidate}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground">History of all portfolio activities.</p>
        </div>
        {portfolios && (
          <AddTransactionDialog
            portfolios={portfolios as any}
            defaultPortfolioId={activePfId > 0 ? activePfId : undefined}
            onSuccess={invalidate}
          />
        )}
      </div>

      {/* Horizontal portfolio selector */}
      {portfolios && portfolios.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-1 border-b border-border">
          {portfolios.map(p => {
            const isActive = activePfId === p.id;
            const count = isActive ? allItems.length : null;
            return (
              <button
                key={p.id}
                onClick={() => { setSelectedPortfolioId(p.id); setPage(0); setSelectedIds(new Set()); }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground"
                }`}
              >
                {p.name}
                {isActive && count !== null && (
                  <span className="ml-1.5 text-xs opacity-75">({count})</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Search + Type filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search symbol, name, notes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-2.5">
              <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
        <Select
          value={typeFilter || "_all_"}
          onValueChange={v => setTypeFilter(v === "_all_" ? "" : v)}
        >
          <SelectTrigger className="w-[130px] h-9 text-sm">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All Types</SelectItem>
            <SelectItem value="DEPOSIT">Deposit</SelectItem>
            <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
            <SelectItem value="BUY">Buy</SelectItem>
            <SelectItem value="SELL">Sell</SelectItem>
            <SelectItem value="DIVIDEND">Dividend</SelectItem>
            <SelectItem value="CASH_GAIN">Cash Gain</SelectItem>
            <SelectItem value="CASH_EXPENSE">Cash Expense</SelectItem>
            <SelectItem value="FEE">Fee</SelectItem>
            <SelectItem value="TAX">Tax</SelectItem>
          </SelectContent>
        </Select>
        {(searchQuery || typeFilter) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setSearchQuery(""); setTypeFilter(""); }}>
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Type filter tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as TabId)}>
          <TabsList className="h-9">
            <TabsTrigger value="all" className="text-xs px-3">All ({tabCounts.all})</TabsTrigger>
            <TabsTrigger value="trades" className="text-xs px-3">Trades ({tabCounts.trades})</TabsTrigger>
            <TabsTrigger value="incomes" className="text-xs px-3">Incomes ({tabCounts.incomes})</TabsTrigger>
            <TabsTrigger value="cash" className="text-xs px-3">Cash ({tabCounts.cash})</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-xs text-muted-foreground ml-1">
          {filteredItems.length} transaction{filteredItems.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px]">
                  <Checkbox
                    checked={selectedIds.size > 0 && selectedIds.size === pagedItems.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">Net Amount</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={9}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-destructive">
                    Failed to load transactions. Please refresh the page.
                  </TableCell>
                </TableRow>
              ) : pagedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    {activePfId === 0 ? "Select a portfolio to see transactions." : "No transactions found."}
                  </TableCell>
                </TableRow>
              ) : (
                pagedItems.map(t => {
                  let dateDisplay = "—";
                  try {
                    if (t.date) dateDisplay = format(new Date(t.date), 'MMM d, yyyy');
                  } catch { /* invalid date — show fallback */ }
                  const currency = t.currency || "USD";
                  const netAmt = getNetAmount(t);
                  return (
                  <TableRow key={t.id} className={selectedIds.has(t.id) ? "bg-muted/40" : "hover:bg-muted/20"}>
                    <TableCell>
                      <Checkbox checked={selectedIds.has(t.id)} onCheckedChange={() => toggleSelect(t.id)} />
                    </TableCell>
                    <TableCell className="text-sm font-mono whitespace-nowrap">
                      {dateDisplay}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs ${typeTextClass(t.type)}`}>
                        {formatTxType(t.type)}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {t.holdingSymbol ? (
                        <>
                          <span className="font-mono">{t.holdingSymbol}</span>
                          {t.holdingName && t.holdingName !== t.holdingSymbol && (
                            <div className="text-xs text-muted-foreground font-normal">{t.holdingName}</div>
                          )}
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {t.quantity != null ? formatNumber(t.quantity, 2) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {t.price != null ? formatCurrency(t.price, currency) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {t.feeAmount != null ? formatCurrency(t.feeAmount, currency) : <span>—</span>}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-semibold text-sm ${amountClass(t.type)}`}>
                      {isNaN(netAmt) ? "—" : <SensitiveAmount value={netAmt} currency={currency} />}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setViewTx(t)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteSingle(t)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Batch delete bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-popover border border-border shadow-2xl rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="w-px h-4 bg-border" />
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={batchDelete.isPending}>
            <Trash2 className="w-4 h-4 mr-2" /> Delete Selected
          </Button>
        </div>
      )}
    </div>
  );
}

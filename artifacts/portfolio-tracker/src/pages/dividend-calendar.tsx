import { useState, useEffect } from "react";
import { useListDividendEvents, useCreateTransaction, useListPortfolios, useDeleteTransaction, useUpdateTransaction } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay, subMonths, addMonths, setMonth, setYear, getMonth, getYear } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays, List, CheckCircle, Pencil, Trash2, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { TxFormSummary } from "@/components/tx-form-summary";
import { SensitiveAmount } from "@/components/amount";
import { DragHandle, useSwipeToClose } from "@/components/drag-handle";
import { CurrencyCombobox } from "@/components/currency-combobox";

function currencySymbol(code: string): string {
  const map: Record<string, string> = {
    PHP: "₱", USD: "$", GBP: "£", EUR: "€", JPY: "¥",
    HKD: "HK$", SGD: "S$", AUD: "A$", CAD: "C$", CNY: "¥",
    KRW: "₩", INR: "₹", BTC: "₿", ETH: "Ξ",
  };
  return map[(code ?? "").toUpperCase()] ?? code;
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type DivEvent = {
  id: number;
  portfolioId: number;
  holdingId?: number | null;
  symbol: string;
  name?: string | null;
  dividendType: string;
  exDate: string;
  recordDate?: string | null;
  paymentDate?: string | null;
  dividendPerShare?: number | null;
  quantity?: number | null;
  grossAmount?: number | null;
  taxAmount?: number | null;
  totalAmount: number;
  currency: string;
  notes?: string | null;
  isPaid?: boolean; // set by server: true when a matching DIVIDEND transaction exists
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Event Detail Dialog ───────────────────────────────────────────────────────

function DividendDetailDialog({
  event,
  onClose,
  onRefresh,
}: {
  event: DivEvent;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createTx = useCreateTransaction();
  const deleteTx = useDeleteTransaction();
  const updateTx = useUpdateTransaction();
  const { data: portfolios } = useListPortfolios();
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletingTx, setIsDeletingTx] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingTx, setIsEditingTx] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteTx, setConfirmDeleteTx] = useState(false);

  // Edit form state — for dividend events (id > 0)
  const [editNotes, setEditNotes] = useState(event.notes ?? "");
  const [editTotal, setEditTotal] = useState(String(event.totalAmount));
  const [editPayDate, setEditPayDate] = useState(event.paymentDate ?? "");
  const [editPerShare, setEditPerShare] = useState(event.dividendPerShare != null ? String(event.dividendPerShare) : "");

  // Edit form state — for DIVIDEND transactions (id < 0)
  // grossAmount = the stored transaction `amount` (pre-deductions); totalAmount = net
  const [editTxDate, setEditTxDate] = useState(event.exDate ?? "");
  const [editTxFee, setEditTxFee] = useState(() => {
    // Infer fee from: gross - net - tax (all stored separately)
    const gross = event.grossAmount ?? event.totalAmount;
    const tax = event.taxAmount ?? 0;
    const implied = gross - event.totalAmount - tax;
    return implied > 0.0001 ? String(parseFloat(implied.toFixed(6))) : "";
  });
  const [editTxCurrency, setEditTxCurrency] = useState(event.currency ?? "USD");
  const [editTxNotes, setEditTxNotes] = useState(event.notes ?? "");
  const [editTxQty, setEditTxQty] = useState(() => {
    const q = event.quantity;
    return (q != null && q > 0) ? String(q) : "1";
  });
  const [editTxPricePerShare, setEditTxPricePerShare] = useState(() => {
    if (event.dividendPerShare != null && event.dividendPerShare > 0) return String(event.dividendPerShare);
    const gross = event.grossAmount ?? event.totalAmount;
    const qty = (event.quantity != null && event.quantity > 0) ? event.quantity : 1;
    return String(parseFloat((gross / qty).toFixed(8)));
  });
  // Derived values for the edit form summary
  const portfolio = portfolios?.find((p: any) => p.id === event.portfolioId);
  const portfolioTaxRate = Number(portfolio?.defaultTaxRate) || 0;
  const formGross = (parseFloat(editTxQty) || 0) * (parseFloat(editTxPricePerShare) || 0);
  const formTaxAmt = formGross * portfolioTaxRate / 100;
  const formFeeAmt = parseFloat(editTxFee) || 0;

  const handleMarkPaid = async () => {
    setIsMarkingPaid(true);
    try {
      const payDate = event.paymentDate ?? new Date().toISOString().split("T")[0];
      await new Promise<void>((resolve, reject) => {
        createTx.mutate(
          {
            portfolioId: event.portfolioId,
            data: {
              type: "DIVIDEND" as any,
              date: payDate,
              holdingId: event.holdingId ?? null,
              amount: event.totalAmount,
              currency: event.currency,
              notes: `Dividend from ${event.symbol}`,
            },
          },
          {
            onSuccess: () => resolve(),
            onError: (err) => reject(err),
          }
        );
      });
      toast({ title: "Marked as paid", description: `DIVIDEND transaction added to portfolio.` });
      qc.invalidateQueries();
      onClose();
      onRefresh();
    } catch {
      toast({ title: "Failed to mark as paid", variant: "destructive" });
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setConfirmDelete(false);
    try {
      const res = await fetch(
        `${BASE_URL}/api/portfolios/${event.portfolioId}/dividends/${event.id}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) throw new Error();
      toast({ title: "Dividend event deleted" });
      qc.invalidateQueries();
      onClose();
      onRefresh();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteTx = async () => {
    const txId = Math.abs(event.id);
    setIsDeletingTx(true);
    setConfirmDeleteTx(false);
    try {
      await new Promise<void>((resolve, reject) => {
        deleteTx.mutate(
          { portfolioId: event.portfolioId, transactionId: txId },
          { onSuccess: () => resolve(), onError: (err: any) => reject(err) }
        );
      });
      toast({ title: "Dividend transaction deleted" });
      qc.invalidateQueries();
      onClose();
      onRefresh();
    } catch {
      toast({ title: "Failed to delete transaction", variant: "destructive" });
    } finally {
      setIsDeletingTx(false);
    }
  };

  const handleSaveEditTx = async () => {
    const txId = Math.abs(event.id);
    if (formGross <= 0) {
      toast({ title: "Enter valid shares and price per share", variant: "destructive" });
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        updateTx.mutate(
          {
            portfolioId: event.portfolioId,
            transactionId: txId,
            data: {
              amount: formGross,
              taxAmount: formTaxAmt > 0 ? formTaxAmt : null,
              feeAmount: formFeeAmt > 0 ? formFeeAmt : null,
              currency: editTxCurrency || event.currency,
              date: editTxDate || event.exDate,
              quantity: parseFloat(editTxQty) > 0 ? parseFloat(editTxQty) : null,
              price: parseFloat(editTxPricePerShare) > 0 ? parseFloat(editTxPricePerShare) : null,
              notes: editTxNotes || null,
            } as any,
          },
          { onSuccess: () => resolve(), onError: (err: any) => reject(err) }
        );
      });
      toast({ title: "Dividend transaction updated" });
      qc.invalidateQueries();
      setIsEditingTx(false);
      onRefresh();
    } catch (err) {
      console.error("handleSaveEditTx failed", err);
      toast({ title: "Failed to update transaction", description: String((err as any)?.message ?? err), variant: "destructive" });
    }
  };

  const handleSaveEdit = async () => {
    try {
      const res = await fetch(
        `${BASE_URL}/api/portfolios/${event.portfolioId}/dividends/${event.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            totalAmount: parseFloat(editTotal) || event.totalAmount,
            paymentDate: editPayDate || event.paymentDate,
            dividendPerShare: editPerShare ? parseFloat(editPerShare) : event.dividendPerShare,
            notes: editNotes || null,
          }),
        }
      );
      if (!res.ok) throw new Error();
      toast({ title: "Dividend event updated" });
      qc.invalidateQueries();
      setIsEditing(false);
      onRefresh();
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const portfolioName = portfolios?.find(p => p.id === event.portfolioId)?.name ?? `Portfolio #${event.portfolioId}`;

  // Paid if: synthesised from a transaction (negative id) OR server annotated isPaid=true
  // (isPaid=true means a real dividendEvents row has a matching DIVIDEND transaction)
  const isAlreadyPaid = event.id < 0 || event.isPaid === true;

  const swipeHandlers = useSwipeToClose(onClose);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md" {...swipeHandlers}>
        <DragHandle />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditingTx ? (
              <span className="font-semibold">Edit Transaction</span>
            ) : (
              <>
                <span className="font-mono font-bold">{event.symbol}</span>
                <span className="text-sm font-normal text-muted-foreground">{event.dividendType}</span>
                {isAlreadyPaid && (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 font-medium">
                    Paid
                  </span>
                )}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        {isEditingTx ? (
          <div className="space-y-4 py-2">
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</label>
                <div className="h-9 flex items-center text-sm font-medium">Dividend</div>
              </div>
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium">Date</label>
                <Input type="date" value={editTxDate} onChange={e => setEditTxDate(e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stock / Symbol</label>
              <div className="h-9 flex items-center text-sm font-mono bg-muted/50 rounded-md px-3 border border-border/50">{event.symbol}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">No. of Shares</label>
                <Input type="number" step="any" min="0" value={editTxQty} onChange={e => setEditTxQty(e.target.value)} className="h-9 font-mono" placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Price per Share</label>
                <Input type="number" step="any" min="0" value={editTxPricePerShare} onChange={e => setEditTxPricePerShare(e.target.value)} className="h-9 font-mono" placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Dividend Tax
                {portfolioTaxRate > 0
                  ? <span className="text-muted-foreground font-normal ml-1">({portfolioTaxRate.toFixed(2)}% — auto-calculated)</span>
                  : <span className="text-muted-foreground font-normal ml-1">(no default rate set)</span>
                }
              </label>
              <div className="h-9 flex items-center text-sm font-mono bg-muted/50 rounded-md px-3 border border-border/50">
                {formTaxAmt > 0 ? `${editTxCurrency} ${formTaxAmt.toFixed(4)}` : "—"}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Currency</label>
              <CurrencyCombobox value={editTxCurrency} onChange={setEditTxCurrency} />
            </div>
            {formGross > 0 && (
              <TxFormSummary
                type="DIVIDEND"
                currency={editTxCurrency}
                gross={formGross}
                fee={formFeeAmt}
                tax={formTaxAmt}
              />
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Input value={editTxNotes} onChange={e => setEditTxNotes(e.target.value)} className="h-9" placeholder="Optional" />
            </div>
          </div>
        ) : !isEditing ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Portfolio</div>
                <div className="font-medium">{portfolioName}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Date</div>
                <div className="font-mono text-amber-400">{event.exDate ? format(new Date(event.exDate), "MMM d, yyyy") : "—"}</div>
              </div>
              {event.quantity != null && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">No. of Shares</div>
                  <div className="font-mono">{event.quantity.toLocaleString()}</div>
                </div>
              )}
              {event.dividendPerShare != null && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Price per Share</div>
                  <div className="font-mono">{formatCurrency(event.dividendPerShare, event.currency)}</div>
                </div>
              )}
              {event.taxAmount != null && event.taxAmount > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Dividend Tax</div>
                  <div className="font-mono text-destructive">−{formatCurrency(event.taxAmount, event.currency)}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">
                  {event.grossAmount != null && event.grossAmount !== event.totalAmount ? "Net Amount" : "Amount"}
                </div>
                <div className="font-mono font-bold text-gain">{formatCurrency(event.totalAmount, event.currency)}</div>
              </div>
              {event.grossAmount != null && event.grossAmount !== event.totalAmount && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Gross Amount</div>
                  <div className="font-mono text-muted-foreground">{formatCurrency(event.grossAmount, event.currency)}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Currency</div>
                <div className="font-mono">{event.currency}</div>
              </div>
              {event.paymentDate && event.paymentDate !== event.exDate && (
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Payment Date</div>
                  <div className="font-mono text-green-400">{format(new Date(event.paymentDate), "MMM d, yyyy")}</div>
                </div>
              )}
            </div>
            {event.notes && (
              <div className="bg-muted/40 rounded px-3 py-2 text-sm text-muted-foreground">{event.notes}</div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Total Amount</label>
                <Input type="number" step="any" value={editTotal} onChange={e => setEditTotal(e.target.value)} className="h-9 font-mono" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Price per Share</label>
                <Input type="number" step="any" value={editPerShare} onChange={e => setEditPerShare(e.target.value)} className="h-9 font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Payment Date</label>
              <Input type="date" value={editPayDate} onChange={e => setEditPayDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} className="h-9" placeholder="Optional" />
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {isEditingTx ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsEditingTx(false)}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEditTx} disabled={updateTx.isPending}>
                {updateTx.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </>
          ) : !isEditing ? (
            (confirmDelete || confirmDeleteTx) ? (
              <>
                <span className="text-sm text-destructive mr-auto self-center">This cannot be undone.</span>
                <Button
                  variant="outline" size="sm"
                  onClick={() => { setConfirmDelete(false); setConfirmDeleteTx(false); }}
                >
                  <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                </Button>
                <Button
                  variant="destructive" size="sm"
                  onClick={confirmDeleteTx ? handleDeleteTx : handleDelete}
                  disabled={isDeleting || isDeletingTx}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  {(isDeleting || isDeletingTx) ? "Deleting…" : "Yes, Delete"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline" size="sm"
                  onClick={() => event.id < 0 ? setIsEditingTx(true) : setIsEditing(true)}
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => event.id < 0 ? setConfirmDeleteTx(true) : setConfirmDelete(true)}
                  disabled={isDeleting || isDeletingTx}
                  className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  {(isDeleting || isDeletingTx) ? "Deleting…" : "Delete"}
                </Button>
                {isAlreadyPaid ? (
                  <Button variant="outline" size="sm" disabled className="sm:ml-auto cursor-default">
                    <CheckCircle className="w-3.5 h-3.5 mr-1.5 text-green-400" /> Already Paid
                  </Button>
                ) : (
                  <Button size="sm" onClick={handleMarkPaid} disabled={isMarkingPaid} className="sm:ml-auto">
                    <CheckCircle className="w-3.5 h-3.5 mr-1.5" /> {isMarkingPaid ? "Saving…" : "Mark as Paid"}
                  </Button>
                )}
              </>
            )
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)}>
                <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit}>Save Changes</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ─── Calendar View ─────────────────────────────────────────────────────────────

function CalendarView({ events, onEventClick }: { events: DivEvent[]; onEventClick: (e: DivEvent) => void }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const now = new Date();
  const currentYear = getYear(currentMonth);
  const yearRange = Array.from({ length: 11 }, (_, i) => getYear(now) - 5 + i);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPadding = getDay(monthStart);

  const eventsThisMonth = events.filter(e => {
    const d = e.exDate ? new Date(e.exDate) : null;
    const p = e.paymentDate ? new Date(e.paymentDate) : null;
    return (
      (d && d >= monthStart && d <= monthEnd) ||
      (p && p >= monthStart && p <= monthEnd)
    );
  });

  const eventsForDay = (day: Date) => events.filter(e => {
    const exMatch = e.exDate && isSameDay(new Date(e.exDate), day);
    const payMatch = e.paymentDate && isSameDay(new Date(e.paymentDate), day);
    return exMatch || payMatch;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Select value={String(getMonth(currentMonth))} onValueChange={v => setCurrentMonth(m => setMonth(m, parseInt(v)))}>
            <SelectTrigger className="h-8 flex-1 min-w-0 text-sm font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={i} value={String(i)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(currentYear)} onValueChange={v => setCurrentMonth(m => setYear(m, parseInt(v)))}>
            <SelectTrigger className="h-8 w-20 shrink-0 text-sm font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearRange.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs shrink-0" onClick={() => setCurrentMonth(new Date())}>
            Today
          </Button>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Always-visible summary bar so calendar height stays fixed */}
      <div className="bg-muted/40 rounded-lg px-4 py-3 flex flex-wrap gap-4 text-sm min-h-[44px] items-center">
        <span className="text-muted-foreground">
          {eventsThisMonth.length} event{eventsThisMonth.length !== 1 ? "s" : ""} this month
        </span>
        {eventsThisMonth.length > 0 && Object.entries(
          eventsThisMonth.reduce((acc, e) => {
            acc[e.currency] = (acc[e.currency] || 0) + Number(e.totalAmount);
            return acc;
          }, {} as Record<string, number>)
        ).map(([cur, total]) => (
          <span key={cur} className="font-medium text-gain">{formatCurrency(total, cur)}</span>
        ))}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/40 border-b border-border">
          {DAY_LABELS.map(d => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
        </div>

        {(() => {
          // Fix 12: dynamic cell height fills viewport on mobile
          const totalCells = startPadding + days.length;
          const trailCells = (7 - (totalCells % 7)) % 7;
          const numRows = Math.ceil((totalCells + trailCells) / 7);
          const cellStyle = { minHeight: `calc((75svh - 255px) / ${numRows})` };
          return (
        <div className="grid grid-cols-7">
          {Array.from({ length: startPadding }).map((_, i) => (
            <div key={`pad-${i}`} style={cellStyle} className="md:min-h-[64px] border-b border-r border-border bg-muted/10 last-of-type:border-r-0" />
          ))}

          {days.map((day, idx) => {
            const dayEvents = eventsForDay(day);
            const isToday = isSameDay(day, new Date());
            const colPos = (startPadding + idx) % 7;
            const isLastCol = colPos === 6;

            return (
              <div
                key={day.toISOString()}
                style={cellStyle}
                className={`md:min-h-[64px] p-0.5 md:p-1.5 border-b border-border ${!isLastCol ? "border-r" : ""} ${isToday ? "bg-primary/5" : ""}`}
              >
                <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                  isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}>
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map(e => {
                    const isExDate = e.exDate && isSameDay(new Date(e.exDate), day);
                    const amt = Number(e.totalAmount);
                    const amtStr = amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    return (
                      <button
                        key={`${e.id}-${isExDate ? "ex" : "pay"}`}
                        onClick={() => onEventClick(e)}
                        className={`w-full text-left leading-tight px-1 py-0.5 rounded font-medium transition-opacity hover:opacity-80 ${
                          (e.id < 0 || e.isPaid === true)
                            ? "bg-green-500/20 text-green-400"
                            : "bg-amber-500/20 text-amber-400"
                        }`}
                        title={`${e.symbol} — ${isExDate ? "Ex-Date" : "Pay Date"}: ${formatCurrency(amt, e.currency)}`}
                      >
                        <div className="text-[8px] font-semibold truncate leading-tight">{e.symbol}</div>
                        <div className="text-[8px] truncate opacity-80 leading-tight">{currencySymbol(e.currency)}{amtStr}</div>
                      </button>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <div className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}

          {Array.from({ length: (7 - ((startPadding + days.length) % 7)) % 7 }).map((_, i) => (
            <div key={`trail-${i}`} style={cellStyle} className="md:min-h-[64px] border-b border-r border-border bg-muted/10 last-of-type:border-r-0" />
          ))}
        </div>
          );
        })()}
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/30 inline-block" /> Ex-dividend date</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500/30 inline-block" /> Payment date</span>
      </div>
    </div>
  );
}

// ─── Main Dividend Calendar ────────────────────────────────────────────────────

export default function DividendCalendar() {
  const { data: events, isLoading, refetch } = useListDividendEvents({});
  const [selectedEvent, setSelectedEvent] = useState<DivEvent | null>(null);
  const [calTab, setCalTab] = useState<string>(() => {
    try { return localStorage.getItem("folio-div-tab") ?? "calendar"; } catch { return "calendar"; }
  });

  return (
    <div className="space-y-6">
      {selectedEvent && (
        <DividendDetailDialog
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onRefresh={() => refetch()}
        />
      )}

      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dividend Calendar</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">Track upcoming and past dividend payouts.</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs value={calTab} onValueChange={v => { setCalTab(v); try { localStorage.setItem("folio-div-tab", v); } catch {} }}>
          <TabsList>
            <TabsTrigger value="calendar"><CalendarDays className="w-4 h-4 mr-2" />Calendar</TabsTrigger>
            <TabsTrigger value="list"><List className="w-4 h-4 mr-2" />List</TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="mt-4">
            <CalendarView
              events={(events || []) as DivEvent[]}
              onEventClick={setSelectedEvent}
            />
          </TabsContent>

          <TabsContent value="list" className="mt-4">
            {!events?.length ? (
              <div className="text-center py-16 text-muted-foreground">No dividend events found.</div>
            ) : (
              <div
                className="bg-card border border-border rounded-lg"
                style={{ maxHeight: '70vh', overflowY: 'auto' }}
              >
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      {([['Pay Date','20%'],['Stock','14%'],['Shares','14%'],['Per Share','15%'],['Amount','20%'],['Status','17%']] as [string,string][]).map(([col, w]) => (
                        <th
                          key={col}
                          style={{
                            width: w,
                            position: 'sticky',
                            top: 0,
                            zIndex: 20,
                            background: 'hsl(var(--card))',
                            borderBottom: '1px solid hsl(var(--border))',
                            fontSize: 10,
                            fontWeight: 500,
                            color: 'hsl(var(--muted-foreground))',
                            padding: '8px',
                            textAlign: col === 'Pay Date' ? 'left' : (col === 'Shares' || col === 'Per Share' || col === 'Amount') ? 'right' : 'center',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...events]
                      .sort((a, b) => new Date(b.paymentDate ?? b.exDate ?? "").getTime() - new Date(a.paymentDate ?? a.exDate ?? "").getTime())
                      .map(e => {
                        const ev = e as DivEvent;
                        const isPaid = ev.id < 0 || ev.isPaid === true;
                        const tdBase: React.CSSProperties = { padding: '8px', fontSize: 10, borderBottom: '1px solid hsl(var(--border) / 0.4)' };
                        return (
                        <tr
                          key={ev.id}
                          style={{ cursor: 'pointer' }}
                          className="hover:bg-muted/20"
                          onClick={() => setSelectedEvent(ev)}
                        >
                          <td style={{ ...tdBase, textAlign: 'left', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                            {ev.paymentDate ? format(new Date(ev.paymentDate), 'MM/dd/yy') : '-'}
                          </td>
                          <td style={{ ...tdBase, textAlign: 'center' }}>{ev.symbol}</td>
                          <td style={{ ...tdBase, textAlign: 'right', fontFamily: 'monospace' }}>
                            {ev.quantity != null ? Number(ev.quantity).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}
                          </td>
                          <td style={{ ...tdBase, textAlign: 'right', fontFamily: 'monospace' }}>
                            {ev.dividendPerShare != null ? Number(ev.dividendPerShare).toFixed(2) : '-'}
                          </td>
                          <td style={{ ...tdBase, textAlign: 'right', fontFamily: 'monospace', color: 'hsl(142 76% 36%)', whiteSpace: 'nowrap' }}>
                            <SensitiveAmount value={Number(ev.totalAmount)} currency={ev.currency} />
                          </td>
                          <td style={{ ...tdBase, textAlign: 'center' }}>
                            {isPaid
                              ? <span className="px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 text-[10px] font-medium whitespace-nowrap">Paid</span>
                              : <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-medium whitespace-nowrap">Pending</span>
                            }
                          </td>
                        </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

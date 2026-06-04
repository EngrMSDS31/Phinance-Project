import { useState, useEffect, useRef, useMemo } from "react";
import { useListPortfolios, useCreatePortfolio, useDeletePortfolio, useUpdatePortfolio, getListPortfoliosQueryKey, useGetPortfolioSummary, getGetPortfolioSummaryQueryKey, useListHoldings, getListHoldingsQueryKey, useListTransactions, getListTransactionsQueryKey } from "@workspace/api-client-react";
import { computePortfolioMetrics } from "@/lib/portfolioEngine";
import { useFx } from "@/lib/fx-context";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Plus, Trash2, Pencil } from "lucide-react";
import { formatCurrency, getMarketColor } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const CURRENCIES = ["USD", "PHP", "GBP", "EUR", "JPY", "AUD", "CAD", "SGD", "HKD", "CHF", "CNY", "INR"];
const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#f97316", "#06b6d4", "#ec4899", "#84cc16", "#6366f1", "#14b8a6", "#a855f7"];

function PortfolioTotalValue({ portfolioId, baseCurrency }: { portfolioId: number; baseCurrency: string }) {
  const { convert } = useFx();
  const { data: holdings } = useListHoldings(portfolioId, {
    query: { enabled: !!portfolioId, queryKey: getListHoldingsQueryKey(portfolioId) },
  });
  const { data: transactions } = useListTransactions(portfolioId, { limit: 1000 }, {
    query: { enabled: !!portfolioId, queryKey: getListTransactionsQueryKey(portfolioId, { limit: 1000 }) },
  });

  const totalValue = useMemo(() => {
    if (!holdings || !transactions?.items) return null;
    const baseRate = convert(1, baseCurrency) || 1;
    const convertFn = (v: number, fromCurrency: string): number => {
      if (fromCurrency === baseCurrency) return v;
      return convert(v, fromCurrency) / baseRate;
    };
    const txItems = transactions.items as any[];
    const txByHoldingId = new Map<number, any[]>();
    txItems.forEach((tx: any) => {
      if (!tx.holdingId || !["BUY", "SELL", "DIVIDEND"].includes(tx.type)) return;
      if (!txByHoldingId.has(tx.holdingId)) txByHoldingId.set(tx.holdingId, []);
      txByHoldingId.get(tx.holdingId)!.push(tx);
    });
    const holdingEntries = (holdings as any[]).map((h: any) => ({
      symbol: h.symbol,
      currentPrice: parseFloat(String(h.currentPrice ?? 0)) || 0,
      currency: baseCurrency,
      txs: txByHoldingId.get(h.id) ?? [],
    }));
    const depositRecords = txItems
      .filter((tx: any) => tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL")
      .map((tx: any) => ({ type: tx.type as "DEPOSIT" | "WITHDRAWAL", amount: tx.amount ?? "0", currency: baseCurrency }));
    const cashRecords = txItems
      .filter((tx: any) => tx.type === "CASH_GAIN" || tx.type === "CASH_EXPENSE")
      .map((tx: any) => ({ type: tx.type as "CASH_GAIN" | "CASH_EXPENSE", amount: tx.amount ?? "0", currency: baseCurrency }));
    return computePortfolioMetrics(holdingEntries, depositRecords, convertFn, cashRecords).totalPortfolioValue;
  }, [holdings, transactions, baseCurrency, convert]);

  if (totalValue == null) return <div className="text-lg font-bold text-muted-foreground animate-pulse">—</div>;
  return <div className="text-lg font-bold">{formatCurrency(totalValue, baseCurrency)}</div>;
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  baseCurrency: z.string().min(1, "Base currency is required"),
  type: z.enum(["PSE", "LSE", "US", "CRYPTO", "CUSTOM", "BONDS", "FUNDS", "MIXED"]),
  defaultFeeRate: z.coerce.number().min(0).max(100).default(0),
  sellFeeRate: z.coerce.number().min(0).max(100).default(0),
  defaultTaxRate: z.coerce.number().min(0).max(100).default(0),
  color: z.string().nullish(),
});

const editSchema = z.object({
  name: z.string().min(1, "Name is required"),
  baseCurrency: z.string().min(1, "Base currency is required"),
  type: z.enum(["PSE", "LSE", "US", "CRYPTO", "CUSTOM", "BONDS", "FUNDS", "MIXED"]),
  defaultFeeRate: z.coerce.number().min(0).max(100),
  sellFeeRate: z.coerce.number().min(0).max(100),
  defaultTaxRate: z.coerce.number().min(0).max(100),
  notes: z.string().optional(),
  color: z.string().nullish(),
});

type EditValues = z.infer<typeof editSchema>;

function EditPortfolioDialog({ portfolio, onClose }: { portfolio: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updatePortfolio = useUpdatePortfolio();

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: portfolio.name,
      baseCurrency: portfolio.baseCurrency,
      type: portfolio.type,
      defaultFeeRate: parseFloat(portfolio.defaultFeeRate ?? "0"),
      sellFeeRate: parseFloat(portfolio.sellFeeRate ?? "0"),
      defaultTaxRate: parseFloat(portfolio.defaultTaxRate ?? "0"),
      notes: portfolio.notes ?? "",
      color: portfolio.color ?? null,
    },
  });

  const onSubmit = (values: EditValues) => {
    updatePortfolio.mutate(
      { portfolioId: portfolio.id, data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPortfoliosQueryKey() });
          toast({ title: "Portfolio updated" });
          onClose();
        },
        onError: () => toast({ title: "Failed to update portfolio", variant: "destructive" }),
      }
    );
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Edit Portfolio</DialogTitle>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Portfolio Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. US Tech Growth" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="baseCurrency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Base Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {CURRENCIES.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Market Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="US">US Equities</SelectItem>
                      <SelectItem value="PSE">Philippine Stocks</SelectItem>
                      <SelectItem value="LSE">London Stock Exchange</SelectItem>
                      <SelectItem value="CRYPTO">Cryptocurrency</SelectItem>
                      <SelectItem value="BONDS">Bonds</SelectItem>
                      <SelectItem value="FUNDS">Funds</SelectItem>
                      <SelectItem value="CUSTOM">Custom Assets</SelectItem>
                      <SelectItem value="MIXED">Mixed</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fee &amp; Tax Settings</p>
            <FormField
              control={form.control}
              name="defaultFeeRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Buy Fee (%)</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" max="100" step="0.0001" placeholder="0.0000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sellFeeRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sell Fee &amp; Tax (%)</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" max="100" step="0.0001" placeholder="0.0000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="defaultTaxRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dividend Tax (%)</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" max="100" step="0.0001" placeholder="0.0000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes / Description</FormLabel>
                <FormControl>
                  <Textarea placeholder="Optional notes about this portfolio..." rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="color"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Color</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {PALETTE.map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`w-5 h-5 rounded-full border-2 transition-all ${field.value === c ? "border-foreground scale-110" : "border-transparent opacity-70 hover:opacity-100 hover:scale-105"}`}
                        style={{ backgroundColor: c }}
                        onClick={() => field.onChange(c)}
                      />
                    ))}
                    {field.value && (
                      <button type="button" onClick={() => field.onChange(null)} className="text-xs text-muted-foreground hover:text-foreground ml-1">
                        Clear
                      </button>
                    )}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={updatePortfolio.isPending}>
              {updatePortfolio.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}

export default function Portfolios() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: portfolios, isLoading } = useListPortfolios();

  useEffect(() => {
    try { sessionStorage.removeItem("folio_last_pf_id"); } catch {}
  }, []);
  const deletePortfolio = useDeletePortfolio();
  const createPortfolio = useCreatePortfolio();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPortfolio, setEditingPortfolio] = useState<any | null>(null);

  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      baseCurrency: "USD",
      type: "US",
      defaultFeeRate: 0,
      sellFeeRate: 0,
      defaultTaxRate: 0,
    },
  });

  const watchedType = form.watch("type");
  useEffect(() => {
    const currencyByType: Record<string, string> = {
      PSE: "PHP",
      LSE: "GBP",
      US: "USD",
      CRYPTO: "USD",
      CUSTOM: "USD",
      BONDS: "USD",
      FUNDS: "USD",
      MIXED: "USD",
    };
    const expected = currencyByType[watchedType];
    if (expected) form.setValue("baseCurrency", expected);
  }, [watchedType]);

  const [openSwipeId, setOpenSwipeId] = useState<number | null>(null);
  const touchStartRef = useRef<{ x: number; id: number } | null>(null);
  const touchDeltaRef = useRef<number>(0);

  useEffect(() => {
    if (openSwipeId === null) return;
    const handler = (e: PointerEvent) => {
      const el = (e.target as Element).closest("[data-swipe-card]");
      if (!el || Number(el.getAttribute("data-swipe-card")) !== openSwipeId) {
        setOpenSwipeId(null);
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [openSwipeId]);

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (confirm("Are you sure you want to delete this portfolio?")) {
      deletePortfolio.mutate(
        { portfolioId: id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPortfoliosQueryKey() });
            toast({ title: "Portfolio deleted" });
          },
        }
      );
    }
  };

  const handleDeleteById = (id: number) => {
    if (confirm("Are you sure you want to delete this portfolio?")) {
      deletePortfolio.mutate(
        { portfolioId: id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPortfoliosQueryKey() });
            toast({ title: "Portfolio deleted" });
          },
        }
      );
    }
  };

  const onSubmit = (values: z.infer<typeof createSchema>) => {
    createPortfolio.mutate(
      { data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPortfoliosQueryKey() });
          setIsCreateOpen(false);
          form.reset();
          toast({ title: "Portfolio created" });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Portfolios</h1>
          <p className="text-xs md:text-sm text-muted-foreground">Manage your investment accounts.</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="h-8 text-xs px-3">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Portfolio
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Portfolio</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. US Tech Growth" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="baseCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Base Currency</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a currency" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CURRENCIES.map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Market Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select market type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="US">US Equities</SelectItem>
                          <SelectItem value="PSE">Philippine Stocks</SelectItem>
                          <SelectItem value="LSE">London Stock Exchange</SelectItem>
                          <SelectItem value="CRYPTO">Cryptocurrency</SelectItem>
                          <SelectItem value="BONDS">Bonds</SelectItem>
                          <SelectItem value="FUNDS">Funds</SelectItem>
                          <SelectItem value="CUSTOM">Custom Assets</SelectItem>
                          <SelectItem value="MIXED">Mixed</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fee &amp; Tax Settings</p>
                  <FormField
                    control={form.control}
                    name="defaultFeeRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Buy Fee (%)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" max="100" step="0.0001" placeholder="0.0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sellFeeRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sell Fee &amp; Tax (%)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" max="100" step="0.0001" placeholder="0.0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="defaultTaxRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Dividend Tax (%)</FormLabel>
                        <FormControl>
                          <Input type="number" min="0" max="100" step="0.0001" placeholder="0.0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {PALETTE.map(c => (
                            <button
                              key={c}
                              type="button"
                              className={`w-5 h-5 rounded-full border-2 transition-all ${field.value === c ? "border-foreground scale-110" : "border-transparent opacity-70 hover:opacity-100 hover:scale-105"}`}
                              style={{ backgroundColor: c }}
                              onClick={() => field.onChange(c)}
                            />
                          ))}
                          {field.value && (
                            <button type="button" onClick={() => field.onChange(null)} className="text-xs text-muted-foreground hover:text-foreground ml-1">
                              Clear
                            </button>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={createPortfolio.isPending}>
                    {createPortfolio.isPending ? "Creating..." : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {portfolios?.map(p => (
            <div
              key={p.id}
              data-swipe-card={p.id}
              className="relative overflow-hidden rounded-lg"
            >
              {/* Action buttons revealed behind the card on swipe */}
              <div className="absolute right-0 top-0 bottom-0 flex items-stretch">
                <button
                  className="w-12 flex flex-col items-center justify-center gap-0.5 bg-primary/25 hover:bg-primary/40 text-primary text-[10px] font-medium transition-colors"
                  onClick={() => { setEditingPortfolio(p); setOpenSwipeId(null); }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
                <button
                  className="w-12 flex flex-col items-center justify-center gap-0.5 bg-destructive/25 hover:bg-destructive/40 text-destructive text-[10px] font-medium transition-colors"
                  onClick={() => { setOpenSwipeId(null); handleDeleteById(p.id); }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
              {/* Card slides left on swipe to expose action buttons */}
              <div
                style={{
                  transform: openSwipeId === p.id ? "translateX(-96px)" : "translateX(0)",
                  transition: "transform 0.2s ease",
                }}
                onTouchStart={e => {
                  touchStartRef.current = { x: e.touches[0].clientX, id: p.id };
                  touchDeltaRef.current = 0;
                }}
                onTouchMove={e => {
                  if (touchStartRef.current?.id === p.id)
                    touchDeltaRef.current = e.touches[0].clientX - touchStartRef.current.x;
                }}
                onTouchEnd={() => {
                  if (touchDeltaRef.current < -40) setOpenSwipeId(p.id);
                  else if (touchDeltaRef.current > 40) setOpenSwipeId(null);
                  touchStartRef.current = null;
                  touchDeltaRef.current = 0;
                }}
              >
                <Link href={`/portfolios/${p.id}`}>
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full flex flex-col relative overflow-hidden">
                    {p.color && (
                      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: p.color }} />
                    )}
                    <CardContent className="flex-1 pl-4 pt-3 pb-3 pr-3">
                      <div className="flex justify-between items-start mb-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {p.color && <span className="w-2 h-2 rounded-full flex-shrink-0 inline-block" style={{ backgroundColor: p.color }} />}
                            <h3 className="text-sm font-semibold leading-tight truncate">{p.name}</h3>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{p.type} · {p.baseCurrency}</p>
                        </div>
                        <Badge className={`${getMarketColor(p.type)} text-[10px] shrink-0`} variant="outline">{p.type}</Badge>
                      </div>
                      <PortfolioTotalValue portfolioId={p.id} baseCurrency={p.baseCurrency} />
                      {p.notes && (
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{p.notes}</p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              </div>
            </div>
          ))}
          {portfolios?.length === 0 && (
            <div className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-xl">
              <h3 className="text-lg font-medium">No portfolios yet</h3>
              <p className="text-muted-foreground mb-4">Create your first portfolio to start tracking your investments.</p>
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Create Portfolio
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Edit Portfolio Dialog */}
      <Dialog open={!!editingPortfolio} onOpenChange={open => { if (!open) setEditingPortfolio(null); }}>
        {editingPortfolio && (
          <EditPortfolioDialog
            portfolio={editingPortfolio}
            onClose={() => setEditingPortfolio(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

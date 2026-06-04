import { useState, useEffect, useRef } from "react";
import { useListAlerts, useCreateAlert, useDeleteAlert, useSearchSymbols, getListAlertsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const alertSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  market: z.enum(["PSE", "LSE", "US", "CRYPTO", "CUSTOM"]),
  condition: z.enum(["GTE", "LTE", "EQ", "CROSS_UP", "CROSS_DOWN"]),
  targetPrice: z.coerce.number().positive(),
  currency: z.string().optional(),
});

export default function Alerts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: alerts, isLoading } = useListAlerts();
  const createAlert = useCreateAlert();
  const deleteAlert = useDeleteAlert();

  const [isOpen, setIsOpen] = useState(false);

  // Symbol search state
  const [symbolQuery, setSymbolQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchMarket, setSearchMarket] = useState("US");
  const [selectedAlertSymbol, setSelectedAlertSymbol] = useState<{ symbol: string; name: string; market: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(symbolQuery), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [symbolQuery]);

  const { data: searchResults, isFetching: isSearching } = useSearchSymbols(
    { q: debouncedQuery || "_", market: searchMarket as any },
    { query: { enabled: debouncedQuery.length >= 1 } as any }
  );

  const form = useForm<z.infer<typeof alertSchema>>({
    resolver: zodResolver(alertSchema),
    defaultValues: { symbol: "", name: "", market: "US", condition: "GTE", targetPrice: 0, currency: "USD" },
  });

  const handleSelectAlertSymbol = (r: any) => {
    setSelectedAlertSymbol({ symbol: r.symbol, name: r.name || r.symbol, market: r.market || searchMarket });
    form.setValue("symbol", r.symbol);
    form.setValue("name", r.name || r.symbol);
    form.setValue("market", (r.market || searchMarket) as any);
    setSymbolQuery("");
    setDebouncedQuery("");
  };

  const onSubmit = (values: z.infer<typeof alertSchema>) => {
    createAlert.mutate({ data: values }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        setIsOpen(false);
        form.reset();
        setSelectedAlertSymbol(null);
        toast({ title: "Alert created" });
      }
    });
  };

  const handleRemove = (id: number) => {
    deleteAlert.mutate({ alertId: id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
        toast({ title: "Alert removed" });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Price Alerts</h1>
          <p className="text-muted-foreground">Manage your notifications for market movements.</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" /> New Alert
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Price Alert</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Symbol search */}
              <div>
                <div className="text-sm font-medium mb-1.5">Market</div>
                <Select value={searchMarket} onValueChange={v => { setSearchMarket(v); setSelectedAlertSymbol(null); setSymbolQuery(""); form.setValue("market", v as any); }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">US</SelectItem>
                    <SelectItem value="PSE">PSE</SelectItem>
                    <SelectItem value="LSE">LSE</SelectItem>
                    <SelectItem value="CRYPTO">CRYPTO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="relative">
                <div className="text-sm font-medium mb-1.5">Search Symbol</div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    value={symbolQuery}
                    onChange={e => { setSymbolQuery(e.target.value); setSelectedAlertSymbol(null); }}
                    placeholder="Type symbol or company name..."
                    className="pl-9 pr-8"
                    autoComplete="off"
                  />
                  {symbolQuery && (
                    <button className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => { setSymbolQuery(""); setDebouncedQuery(""); }}>
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {debouncedQuery.length >= 1 && !selectedAlertSymbol && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                    {isSearching ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
                    ) : (searchResults as any[])?.length ? (
                      (searchResults as any[]).slice(0, 10).map((r: any, i: number) => (
                        <button key={`${r.symbol}-${i}`} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left transition-colors" onClick={() => handleSelectAlertSymbol(r)}>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono font-semibold text-sm">{r.symbol}</div>
                            <div className="text-xs text-muted-foreground truncate">{r.name}</div>
                          </div>
                          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded shrink-0">{r.market || searchMarket}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No results found.</div>
                    )}
                  </div>
                )}
              </div>
              {selectedAlertSymbol && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono font-semibold text-sm">{selectedAlertSymbol.symbol}</div>
                    <div className="text-xs text-muted-foreground truncate">{selectedAlertSymbol.name} · {selectedAlertSymbol.market}</div>
                  </div>
                  <button onClick={() => { setSelectedAlertSymbol(null); form.setValue("symbol", ""); }} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              {/* Alert condition and price */}
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                  <FormField control={form.control} name="condition" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Condition</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="GTE">Price &ge; Target</SelectItem>
                          <SelectItem value="LTE">Price &le; Target</SelectItem>
                          <SelectItem value="CROSS_UP">Crosses Above</SelectItem>
                          <SelectItem value="CROSS_DOWN">Crosses Below</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="targetPrice" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Price</FormLabel>
                      <FormControl><Input type="number" step="any" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <DialogFooter>
                    <Button type="submit" disabled={createAlert.isPending || !selectedAlertSymbol}>
                      {createAlert.isPending ? "Creating..." : "Create Alert"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border border-border shadow-sm rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead className="text-right">Target Price</TableHead>
              <TableHead className="text-right">Current Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6}><Skeleton className="h-20 w-full" /></TableCell></TableRow>
            ) : !alerts?.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No alerts configured.</TableCell></TableRow>
            ) : (
              alerts.map(a => (
                <TableRow key={a.id}>
                  <TableCell className="font-bold">{a.symbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{a.condition}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(a.targetPrice, a.currency || 'USD')}</TableCell>
                  <TableCell className="text-right font-mono">{a.currentPrice ? formatCurrency(a.currentPrice, a.currency || 'USD') : '-'}</TableCell>
                  <TableCell>
                    <Badge className={
                      a.status === 'FIRED' ? 'bg-amber-500 text-white' :
                      a.status === 'PENDING' ? 'bg-blue-500 text-white' :
                      'bg-gray-500 text-white'
                    }>{a.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleRemove(a.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

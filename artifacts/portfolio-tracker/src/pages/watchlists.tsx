import {
  useListWatchlists,
  useListWatchlistItems,
  useCreateWatchlist,
  useAddWatchlistItem,
  useRemoveWatchlistItem,
  useDeleteWatchlist,
  useSearchSymbols,
  getListWatchlistsQueryKey,
  getListWatchlistItemsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatPercent, cnValue } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, MoreVertical, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const wlSchema = z.object({
  name: z.string().min(1),
  market: z.enum(["PSE", "LSE", "US", "CRYPTO", "MIXED"]),
});

const itemSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  market: z.enum(["PSE", "LSE", "US", "CRYPTO", "CUSTOM"]),
  currency: z.string().optional(),
});

export default function Watchlists() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: watchlists, isLoading: loadingLists } = useListWatchlists();
  const [activeList, setActiveList] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const selectedListId = activeList || (watchlists?.[0]?.id ?? 0);
  const selectedWatchlist = watchlists?.find(w => w.id === selectedListId);

  const { data: items, isLoading: loadingItems } = useListWatchlistItems(selectedListId, {
    query: { enabled: selectedListId !== 0, queryKey: getListWatchlistItemsQueryKey(selectedListId) },
  });

  const createWatchlist = useCreateWatchlist();
  const addItem = useAddWatchlistItem();
  const removeItem = useRemoveWatchlistItem();
  const deleteWatchlist = useDeleteWatchlist();

  const [isWlOpen, setIsWlOpen] = useState(false);
  const [isItemOpen, setIsItemOpen] = useState(false);

  // Symbol search state for Add Symbol dialog
  const [symbolQuery, setSymbolQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchMarket, setSearchMarket] = useState("US");
  const [selectedWlSymbol, setSelectedWlSymbol] = useState<{ symbol: string; name: string; market: string } | null>(null);
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

  const wlForm = useForm<z.infer<typeof wlSchema>>({
    resolver: zodResolver(wlSchema),
    defaultValues: { name: "", market: "US" },
  });

  const onWlSubmit = (values: z.infer<typeof wlSchema>) => {
    createWatchlist.mutate({ data: values }, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListWatchlistsQueryKey() });
        setActiveList(data.id);
        setIsWlOpen(false);
        wlForm.reset();
        toast({ title: "Watchlist created" });
      },
    });
  };

  const handleSelectWlSymbol = (r: any) => {
    setSelectedWlSymbol({ symbol: r.symbol, name: r.name || r.symbol, market: r.market || searchMarket });
    setSymbolQuery("");
    setDebouncedQuery("");
  };

  const handleAddWlSymbol = () => {
    if (!selectedWlSymbol || selectedListId === 0) return;
    addItem.mutate({
      watchlistId: selectedListId,
      data: {
        symbol: selectedWlSymbol.symbol,
        name: selectedWlSymbol.name,
        market: selectedWlSymbol.market as any,
        currency: "USD",
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWatchlistItemsQueryKey(selectedListId) });
        queryClient.invalidateQueries({ queryKey: getListWatchlistsQueryKey() });
        setIsItemOpen(false);
        setSelectedWlSymbol(null);
        setSymbolQuery("");
        toast({ title: "Symbol added" });
      },
    });
  };

  const handleRemoveItem = (itemId: number) => {
    if (confirm("Remove this symbol from the watchlist?")) {
      removeItem.mutate({ watchlistId: selectedListId, itemId }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWatchlistItemsQueryKey(selectedListId) });
          queryClient.invalidateQueries({ queryKey: getListWatchlistsQueryKey() });
          toast({ title: "Symbol removed" });
        },
      });
    }
  };

  const handleDeleteWatchlist = (id: number) => {
    setDeleteConfirmId(id);
  };

  const confirmDeleteWatchlist = () => {
    if (!deleteConfirmId) return;
    deleteWatchlist.mutate({ watchlistId: deleteConfirmId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWatchlistsQueryKey() });
        if (activeList === deleteConfirmId) setActiveList(null);
        setDeleteConfirmId(null);
        toast({ title: "Watchlist deleted" });
      },
      onError: () => {
        toast({ title: "Failed to delete watchlist", variant: "destructive" });
        setDeleteConfirmId(null);
      },
    });
  };

  const watchlistToDelete = watchlists?.find(w => w.id === deleteConfirmId);

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-100px)]">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Watchlists</h1>
          <p className="text-muted-foreground">Track potential investments across markets.</p>
        </div>
        <Dialog open={isWlOpen} onOpenChange={setIsWlOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <Plus className="w-4 h-4 mr-2" /> New List
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Watchlist</DialogTitle></DialogHeader>
            <Form {...wlForm}>
              <form onSubmit={wlForm.handleSubmit(onWlSubmit)} className="space-y-4">
                <FormField control={wlForm.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={wlForm.control} name="market" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Market</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="US">US</SelectItem>
                        <SelectItem value="PSE">PSE</SelectItem>
                        <SelectItem value="LSE">LSE</SelectItem>
                        <SelectItem value="CRYPTO">CRYPTO</SelectItem>
                        <SelectItem value="MIXED">MIXED</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <DialogFooter>
                  <Button type="submit" disabled={createWatchlist.isPending}>Create</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(v) => { if (!v) setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Watchlist</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-semibold text-foreground">"{watchlistToDelete?.name}"</span>?
            This will remove the watchlist and all {watchlistToDelete?.itemCount ?? 0} symbols in it. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteWatchlist} disabled={deleteWatchlist.isPending}>
              {deleteWatchlist.isPending ? "Deleting..." : "Delete Watchlist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0">
        {/* Watchlist sidebar */}
        <div className="w-full md:w-64 flex flex-col gap-2 overflow-y-auto shrink-0">
          {loadingLists ? <Skeleton className="h-64 w-full" /> : (
            watchlists?.length === 0 ? (
              <p className="text-sm text-muted-foreground p-2">No watchlists yet. Create one to get started.</p>
            ) : (
              watchlists?.map(wl => (
                <div
                  key={wl.id}
                  onClick={() => setActiveList(wl.id)}
                  className={`p-3 rounded-lg cursor-pointer border transition-colors group relative ${
                    selectedListId === wl.id
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-card border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{wl.name}</div>
                      <div className="text-xs text-muted-foreground">{wl.market} • {wl.itemCount} items</div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mr-1"
                          onClick={e => e.stopPropagation()}
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive focus:bg-destructive/10"
                          onClick={(e) => { e.stopPropagation(); handleDeleteWatchlist(wl.id); }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Watchlist
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))
            )
          )}
        </div>

        {/* Items pane */}
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between items-center bg-muted/30">
            <h2 className="font-semibold text-lg">{watchlists?.find(w => w.id === selectedListId)?.name || 'Watchlist'}</h2>
            <Dialog open={isItemOpen} onOpenChange={setIsItemOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={selectedListId === 0}>
                  <Plus className="w-4 h-4 mr-2" /> Add Symbol
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Symbol</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-medium mb-1.5">Market</div>
                    <Select value={searchMarket} onValueChange={v => { setSearchMarket(v); setSelectedWlSymbol(null); setSymbolQuery(""); }}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="US">US</SelectItem>
                        <SelectItem value="PSE">PSE</SelectItem>
                        <SelectItem value="LSE">LSE</SelectItem>
                        <SelectItem value="CRYPTO">CRYPTO</SelectItem>
                        <SelectItem value="CUSTOM">CUSTOM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative">
                    <div className="text-sm font-medium mb-1.5">Search Symbol</div>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
                      <Input
                        value={symbolQuery}
                        onChange={e => { setSymbolQuery(e.target.value); setSelectedWlSymbol(null); }}
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
                    {debouncedQuery.length >= 1 && !selectedWlSymbol && (
                      <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                        {isSearching ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
                        ) : (searchResults as any[])?.length ? (
                          (searchResults as any[]).slice(0, 10).map((r: any, i: number) => (
                            <button
                              key={`${r.symbol}-${i}`}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left transition-colors"
                              onClick={() => handleSelectWlSymbol(r)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-mono font-semibold text-sm">{r.symbol}</div>
                                <div className="text-xs text-muted-foreground truncate">{r.name}</div>
                              </div>
                              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{r.market || searchMarket}</span>
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-2 text-sm text-muted-foreground">No results found.</div>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedWlSymbol && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-semibold text-sm">{selectedWlSymbol.symbol}</div>
                        <div className="text-xs text-muted-foreground truncate">{selectedWlSymbol.name}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{selectedWlSymbol.market}</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedWlSymbol(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" onClick={handleAddWlSymbol} disabled={addItem.isPending} className="h-7 text-xs">
                          {addItem.isPending ? "Adding..." : "Add"}
                        </Button>
                      </div>
                    </div>
                  )}
                  {!selectedWlSymbol && (
                    <p className="text-xs text-muted-foreground">Search for a symbol above, then click to add it to your watchlist.</p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingItems ? (
                  <TableRow><TableCell colSpan={5}><Skeleton className="h-20 w-full" /></TableCell></TableRow>
                ) : items?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      List is empty. Add symbols using the button above.
                    </TableCell>
                  </TableRow>
                ) : (
                  items?.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-bold">{item.symbol}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.name}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(item.currentPrice, item.currency || 'USD')}</TableCell>
                      <TableCell className={`text-right font-mono text-sm ${cnValue(item.priceChange || 0)}`}>
                        {(item.priceChange || 0) >= 0 ? "+" : ""}{formatCurrency(item.priceChange || 0, item.currency || 'USD')}
                        <span className="text-xs ml-1 opacity-80">({formatPercent(item.priceChangePct || 0)})</span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveItem(item.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}

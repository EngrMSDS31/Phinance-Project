import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cnValue } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format } from "date-fns";
import { useFx } from "@/lib/fx-context";

interface RealizedEvent {
  portfolioId: number;
  portfolioName: string;
  holdingId: number | null;
  symbol: string;
  saleDate: string;
  qty: number;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
  holdingDays: number;
  termType: "SHORT" | "LONG";
  currency: string;
}

interface DividendEvent {
  portfolioId: number;
  portfolioName: string;
  holdingId: number | null;
  symbol: string;
  date: string;
  amount: number;
  currency: string;
}

interface TaxReportData {
  year: number;
  summary: {
    totalRealizedGain: number;
    shortTermGain: number;
    longTermGain: number;
    totalDividends: number;
    totalTaxableIncome: number;
    realizedCount: number;
    dividendCount: number;
  };
  realizedEvents: RealizedEvent[];
  dividendEvents: DividendEvent[];
  portfolios: Array<{ id: number; name: string }>;
  availableYears: number[];
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function fetchTaxReport(year: number, portfolioId: string): Promise<TaxReportData> {
  const params = new URLSearchParams({ year: String(year) });
  if (portfolioId !== "all") params.set("portfolioId", portfolioId);
  const res = await fetch(`${BASE_URL}/api/tax-report?${params}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch tax report");
  return res.json();
}

function TermBadge({ term }: { term: "SHORT" | "LONG" }) {
  if (term === "LONG") return (
    <Badge variant="outline" className="border-blue-600 text-blue-400 text-xs">Long-term</Badge>
  );
  return (
    <Badge variant="outline" className="border-amber-600 text-amber-400 text-xs">Short-term</Badge>
  );
}

function GainCell({ value, label }: { value: number; label: string }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <div className={`flex items-center justify-end gap-1.5 font-mono font-semibold ${cnValue(value)}`}>
      <Icon className="w-3.5 h-3.5" />
      {value >= 0 ? "+" : ""}{label}
    </div>
  );
}

function downloadCsv(rows: (string | number)[][], filename: string) {
  const content = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TaxReport() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [portfolioId, setPortfolioId] = useState("all");

  const { fxFormat, displayCurrency, convert } = useFx();

  const { data, isLoading, isError } = useQuery<TaxReportData>({
    queryKey: ["tax-report", year, portfolioId],
    queryFn: () => fetchTaxReport(year, portfolioId),
    staleTime: 5 * 60 * 1000,
  });

  const years = data?.availableYears ?? Array.from({ length: 6 }, (_, i) => currentYear - i);
  const portfolios = data?.portfolios ?? [];
  const s = data?.summary;

  const exportRealized = () => {
    if (!data?.realizedEvents.length) return;
    const header = ["Portfolio", "Symbol", "Sale Date", "Qty", "Proceeds", "Cost Basis", "Gain/Loss", "Days Held", "Term", "Currency", `In ${displayCurrency}`];
    const rows = data.realizedEvents.map(e => [
      e.portfolioName, e.symbol, e.saleDate,
      e.qty.toFixed(6), e.proceeds.toFixed(2), e.costBasis.toFixed(2),
      e.gainLoss.toFixed(2), e.holdingDays, e.termType, e.currency,
      convert(e.gainLoss, e.currency).toFixed(2),
    ]);
    downloadCsv([header, ...rows], `folio-tax-${year}-realized.csv`);
  };

  const exportDividends = () => {
    if (!data?.dividendEvents.length) return;
    const header = ["Portfolio", "Symbol", "Date", "Amount", "Currency", `In ${displayCurrency}`];
    const rows = data.dividendEvents.map(e => [
      e.portfolioName, e.symbol, e.date,
      e.amount.toFixed(2), e.currency,
      convert(e.amount, e.currency).toFixed(2),
    ]);
    downloadCsv([header, ...rows], `folio-tax-${year}-dividends.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tax Report</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Realized gains, losses, and dividends — FIFO cost basis method
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs font-mono">{displayCurrency}</Badge>

          <Select value={String(year)} onValueChange={v => setYear(parseInt(v))}>
            <SelectTrigger className="w-24 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={portfolioId} onValueChange={setPortfolioId}>
            <SelectTrigger className="w-44 h-9">
              <SelectValue placeholder="All Portfolios" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Portfolios</SelectItem>
              {portfolios.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { title: "Total Realized G/L", value: s?.totalRealizedGain ?? 0, sub: `${s?.realizedCount ?? 0} sale events`, highlight: undefined as any },
          { title: "Short-term Gains", value: s?.shortTermGain ?? 0, sub: "Held < 1 year", highlight: (s?.shortTermGain ?? 0) >= 0 ? "gain" : "loss" },
          { title: "Long-term Gains", value: s?.longTermGain ?? 0, sub: "Held >= 1 year", highlight: (s?.longTermGain ?? 0) >= 0 ? "gain" : "loss" },
          { title: "Dividends Received", value: s?.totalDividends ?? 0, sub: `${s?.dividendCount ?? 0} payments`, highlight: "amber" },
        ].map(({ title, value, sub, highlight }) => (
          <Card key={title}>
            <CardContent className="pt-5">
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">{title}</div>
              {isLoading ? <Skeleton className="h-8 w-24" /> : (
                <>
                  <div className={`text-2xl font-bold font-mono tracking-tight ${
                    highlight === "gain" ? "text-gain" :
                    highlight === "loss" ? "text-loss" :
                    highlight === "amber" ? "text-amber-400" :
                    cnValue(value)
                  }`}>
                    {fxFormat(value, "USD")}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{sub}</div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Taxable income banner */}
      {!isLoading && s && (s.totalRealizedGain !== 0 || s.totalDividends !== 0) && (
        <div className="rounded-lg border border-border bg-muted/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              Estimated Taxable Income ({year}) — shown in {displayCurrency}
            </div>
            <div className={`text-2xl font-bold font-mono ${cnValue(s.totalTaxableIncome)}`}>
              {s.totalTaxableIncome >= 0 ? "+" : ""}{fxFormat(Math.abs(s.totalTaxableIncome), "USD")}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Realized gains + dividends. Consult a tax professional for your jurisdiction.
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportRealized} disabled={!data?.realizedEvents.length}>
              <Download className="w-3.5 h-3.5" /> Gains CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportDividends} disabled={!data?.dividendEvents.length}>
              <Download className="w-3.5 h-3.5" /> Dividends CSV
            </Button>
          </div>
        </div>
      )}

      {/* Detail tabs */}
      <Tabs defaultValue="realized">
        <TabsList>
          <TabsTrigger value="realized">
            Realized Gains/Losses
            {s?.realizedCount ? <Badge variant="secondary" className="ml-2 text-xs">{s.realizedCount}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="dividends">
            Dividends
            {s?.dividendCount ? <Badge variant="secondary" className="ml-2 text-xs">{s.dividendCount}</Badge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="realized" className="mt-4">
          {isLoading ? <Skeleton className="h-64 w-full" /> :
            isError ? <div className="text-center py-12 text-muted-foreground text-sm">Failed to load report data.</div> :
            !data?.realizedEvents.length ? (
              <div className="rounded-lg border border-border bg-card text-center py-16 text-muted-foreground text-sm">
                No realized gains or losses recorded for {year}.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {["Portfolio", "Symbol", "Sale Date", "Qty", "Proceeds", "Cost Basis", `Gain / Loss (${displayCurrency})`, "Days", "Term"].map(h => (
                        <th key={h} className={`px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider ${h === "Symbol" || h === "Portfolio" ? "text-left" : "text-right"} last:text-center`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.realizedEvents.map((e, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{e.portfolioName}</td>
                        <td className="px-4 py-3 font-semibold">{e.symbol}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{format(new Date(e.saleDate), "MMM d, yyyy")}</td>
                        <td className="px-4 py-3 text-right font-mono">{e.qty.toFixed(4)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fxFormat(e.proceeds, e.currency)}</td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">{fxFormat(e.costBasis, e.currency)}</td>
                        <td className="px-4 py-3 text-right">
                          <GainCell value={e.gainLoss} label={fxFormat(Math.abs(convert(e.gainLoss, e.currency)), displayCurrency)} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{e.holdingDays}d</td>
                        <td className="px-4 py-3 text-center"><TermBadge term={e.termType} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-border bg-muted/30">
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Realized ({displayCurrency})</td>
                      <td className="px-4 py-3 text-right">
                        <GainCell value={s?.totalRealizedGain ?? 0} label={fxFormat(Math.abs(convert(s?.totalRealizedGain ?? 0, "USD")), displayCurrency)} />
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </TabsContent>

        <TabsContent value="dividends" className="mt-4">
          {isLoading ? <Skeleton className="h-64 w-full" /> :
            isError ? <div className="text-center py-12 text-muted-foreground text-sm">Failed to load report data.</div> :
            !data?.dividendEvents.length ? (
              <div className="rounded-lg border border-border bg-card text-center py-16 text-muted-foreground text-sm">
                No dividend income recorded for {year}.
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {["Portfolio", "Symbol", "Date", `Amount (${displayCurrency})`, "Orig. Currency"].map(h => (
                        <th key={h} className={`px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider ${h === "Symbol" || h === "Portfolio" ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.dividendEvents.map((e, i) => (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{e.portfolioName}</td>
                        <td className="px-4 py-3 font-semibold">{e.symbol}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{format(new Date(e.date), "MMM d, yyyy")}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-400 font-semibold">{fxFormat(e.amount, e.currency)}</td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">{e.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-border bg-muted/30">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-xs text-muted-foreground font-medium uppercase tracking-wider">Total ({displayCurrency})</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-amber-400">
                        {fxFormat(s?.totalDividends ?? 0, "USD")}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground pb-4">
        Cost basis computed using FIFO (first-in, first-out). Short-term = held under 365 days. Long-term = held 365+ days. For informational purposes only — not tax advice.
      </p>
    </div>
  );
}

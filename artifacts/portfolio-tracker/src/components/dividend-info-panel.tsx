import { useState, useEffect } from "react";
import { format } from "date-fns";
import { RefreshCw, TrendingUp, Calendar, DollarSign, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export interface DividendInfo {
  symbol: string;
  name: string | null;
  currency: string;
  dividendRate: number | null;
  dividendYield: number | null;
  exDividendDate: string | null;
  lastDividendValue: number | null;
  lastDividendDate: string | null;
  history: Array<{ date: string; amount: number }>;
}

interface Props {
  symbol: string;
  market: string;
  onAddToCalendar?: (info: DividendInfo) => void;
}

export function DividendInfoPanel({ symbol, market, onAddToCalendar }: Props) {
  const [info, setInfo] = useState<DividendInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!symbol || !market) return;
    setLoading(true);
    setInfo(null);
    fetch(
      `${BASE_URL}/api/prices/dividend-info?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}`,
      { credentials: "include" }
    )
      .then(r => r.ok ? r.json() : null)
      .then(data => { setInfo(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [symbol, market]);

  const hasDividends = info && (info.dividendRate || info.dividendYield || info.history.length > 0);

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" />
          Dividend Info
          {loading && <RefreshCw className="w-3 h-3 animate-spin opacity-60" />}
          {!loading && hasDividends && (
            <span className="px-1.5 py-0.5 bg-green-500/15 text-green-400 rounded text-[10px] font-medium">
              {info!.dividendYield ? `${(info!.dividendYield * 100).toFixed(2)}% yield` : `${info!.history.length} payouts`}
            </span>
          )}
          {!loading && info && !hasDividends && (
            <span className="text-muted-foreground/60 font-normal">No data</span>
          )}
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border">
          {loading && (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Fetching dividend data from Yahoo Finance…
            </div>
          )}

          {!loading && info && !hasDividends && (
            <p className="text-xs text-muted-foreground py-2">
              No dividend data on record for <span className="font-mono font-medium">{symbol}</span>. 
              This stock may not pay dividends or data is unavailable.
            </p>
          )}

          {!loading && hasDividends && info && (
            <>
              {/* Key metrics row */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                {info.dividendRate != null && (
                  <div className="bg-muted/40 rounded p-2">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                      <DollarSign className="w-3 h-3" /> Annual Rate
                    </div>
                    <div className="text-xs font-bold font-mono">{info.currency} {info.dividendRate.toFixed(4)}</div>
                  </div>
                )}
                {info.dividendYield != null && (
                  <div className="bg-muted/40 rounded p-2">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                      <TrendingUp className="w-3 h-3" /> Yield
                    </div>
                    <div className="text-xs font-bold text-gain">{(info.dividendYield * 100).toFixed(2)}%</div>
                  </div>
                )}
                {info.exDividendDate && (
                  <div className="bg-muted/40 rounded p-2">
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                      <Calendar className="w-3 h-3" /> Ex-Date
                    </div>
                    <div className="text-xs font-bold text-amber-400">
                      {format(new Date(info.exDividendDate), "MMM d, yyyy")}
                    </div>
                  </div>
                )}
              </div>

              {/* History table */}
              {info.history.length > 0 && (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
                    Recent Payouts ({info.history.length})
                  </div>
                  <div className="rounded border border-border overflow-hidden">
                    <div className="grid grid-cols-2 bg-muted/40 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                      <span>Date</span>
                      <span className="text-right">Per Share</span>
                    </div>
                    {info.history.slice(0, 5).map((h, i) => (
                      <div key={i} className="grid grid-cols-2 px-2.5 py-1.5 text-xs border-t border-border hover:bg-muted/20">
                        <span className="text-muted-foreground font-mono">
                          {format(new Date(h.date), "MMM d, yyyy")}
                        </span>
                        <span className="text-right font-mono font-semibold text-gain">
                          {info.currency} {h.amount.toFixed(4)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add to calendar */}
              {onAddToCalendar && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs border-dashed"
                  onClick={() => onAddToCalendar(info!)}
                >
                  <Plus className="w-3 h-3 mr-1.5" />
                  Add to Dividend Calendar
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

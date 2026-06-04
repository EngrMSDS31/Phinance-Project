import { useState } from "react";
import { RefreshCw, Pencil, RotateCcw, ChevronDown, ChevronUp, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFx } from "@/lib/fx-context";

const PRIORITY_CURRENCIES = ["USD", "PHP", "GBP", "EUR", "JPY", "SGD", "HKD", "AUD", "CAD"];

function formatRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(2);
  if (rate >= 1) return rate.toFixed(4);
  if (rate >= 0.01) return rate.toFixed(4);
  return rate.toFixed(6);
}

export function FxRateWidget() {
  const {
    rates, fetchedAt, isLoading, overrides,
    setRateOverride, resetRateOverride, resetAllOverrides,
    refreshRates, displayCurrency,
  } = useFx();

  const [collapsed, setCollapsed] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const rateAge = fetchedAt
    ? Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60_000)
    : null;

  const availablePairs = rates
    ? PRIORITY_CURRENCIES
        .filter(c => c !== displayCurrency && rates[c] != null)
        .map(c => ({ currency: c, serverRate: rates[c] }))
    : [];

  const customOnlyPairs = Object.keys(overrides)
    .filter(c => c !== displayCurrency && !availablePairs.find(p => p.currency === c))
    .map(c => ({ currency: c, serverRate: overrides[c] }));

  const displayPairs = [...availablePairs, ...customOnlyPairs];

  const startEdit = (currency: string, serverRate: number) => {
    setEditingCurrency(currency);
    const effective = overrides[currency] ?? serverRate;
    setEditValue(formatRate(effective));
  };

  const commitEdit = (currency: string) => {
    const val = parseFloat(editValue);
    if (!isNaN(val) && val > 0) setRateOverride(currency, val);
    setEditingCurrency(null);
  };

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <Card className="border-border/60">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center gap-3">
          <CardTitle className="text-sm font-semibold tracking-wide">FX Rates</CardTitle>
          {rateAge !== null && !isLoading && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {rateAge === 0 ? "just now" : `${rateAge}m ago`}
            </span>
          )}
          {isLoading && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
          <div className="ml-auto flex items-center gap-2">
            {hasOverrides && (
              <Button
                variant="ghost" size="sm"
                onClick={resetAllOverrides}
                className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-2"
              >
                Reset all
              </Button>
            )}
            <Button
              variant="ghost" size="sm"
              onClick={refreshRates}
              disabled={isLoading}
              className="h-6 text-[11px] text-muted-foreground hover:text-foreground px-2 gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <button
              onClick={() => setCollapsed(c => !c)}
              className="text-muted-foreground hover:text-foreground p-0.5"
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="px-4 pb-4 pt-0">
          {displayPairs.length === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground">No rates loaded. Change your display currency in the top bar.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {displayPairs.map(({ currency, serverRate }) => {
              const isOverridden = overrides[currency] != null;
              const effectiveRate = overrides[currency] ?? serverRate;
              const isEditing = editingCurrency === currency;

              return (
                <div
                  key={currency}
                  className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/30 border border-border/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] font-mono font-semibold text-foreground/80">
                        {currency}/{displayCurrency}
                      </span>
                      <span
                        className={`text-[9px] px-1 py-0.5 rounded font-semibold tracking-wide ${
                          isOverridden
                            ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                            : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        }`}
                      >
                        {isOverridden ? "CUSTOM" : "LIVE"}
                      </span>
                    </div>

                    {isEditing ? (
                      <input
                        type="number"
                        step="any"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") commitEdit(currency);
                          if (e.key === "Escape") setEditingCurrency(null);
                        }}
                        onBlur={() => commitEdit(currency)}
                        autoFocus
                        className="w-full text-xs font-mono bg-background border border-primary rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    ) : (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-mono font-semibold">{formatRate(effectiveRate)}</span>
                        {isOverridden && (
                          <span className="text-[10px] text-muted-foreground line-through">{formatRate(serverRate)}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
                    <button
                      onClick={() => isEditing ? setEditingCurrency(null) : startEdit(currency, serverRate)}
                      className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                      title={isEditing ? "Cancel" : "Override rate"}
                    >
                      {isEditing ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                    </button>
                    {isOverridden && (
                      <button
                        onClick={() => resetRateOverride(currency)}
                        className="text-muted-foreground hover:text-amber-400 transition-colors p-0.5"
                        title="Reset to live rate"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {hasOverrides && (
            <p className="text-[11px] text-muted-foreground mt-2.5">
              Custom rates apply to all currency conversions on this page. Other pages use live server rates.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

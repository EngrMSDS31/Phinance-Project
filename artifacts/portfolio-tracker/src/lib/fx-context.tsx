import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const SUPPORTED_CURRENCIES = [
  { code: "USD", label: "USD — US Dollar",         symbol: "$"  },
  { code: "EUR", label: "EUR — Euro",               symbol: "€"  },
  { code: "GBP", label: "GBP — British Pound",      symbol: "£"  },
  { code: "PHP", label: "PHP — Philippine Peso",    symbol: "₱"  },
  { code: "JPY", label: "JPY — Japanese Yen",       symbol: "¥"  },
  { code: "AUD", label: "AUD — Australian Dollar",  symbol: "A$" },
  { code: "CAD", label: "CAD — Canadian Dollar",    symbol: "C$" },
  { code: "SGD", label: "SGD — Singapore Dollar",   symbol: "S$" },
  { code: "HKD", label: "HKD — Hong Kong Dollar",   symbol: "HK$"},
  { code: "CHF", label: "CHF — Swiss Franc",        symbol: "CHF"},
  { code: "CNY", label: "CNY — Chinese Yuan",       symbol: "¥"  },
  { code: "INR", label: "INR — Indian Rupee",       symbol: "₹"  },
] as const;

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]["code"];

interface FxRateData {
  base: string;
  rates: Record<string, number>;
  fetchedAt: string;
}

interface FxContextValue {
  displayCurrency: CurrencyCode;
  setDisplayCurrency: (c: CurrencyCode) => void;
  /** Convert amount from fromCurrency → displayCurrency */
  convert: (amount: number, fromCurrency: string) => number;
  /** Format amount as display currency string */
  fxFormat: (amount: number, fromCurrency?: string) => string;
  rates: Record<string, number> | null;
  fetchedAt: string | null;
  isLoading: boolean;
  /** User-set dashboard override rates (fromCurrency → displayCurrency multiplier) */
  overrides: Record<string, number>;
  setRateOverride: (currency: string, rate: number) => void;
  resetRateOverride: (currency: string) => void;
  resetAllOverrides: () => void;
  refreshRates: () => void;
}

const FxContext = createContext<FxContextValue>({
  displayCurrency: "USD",
  setDisplayCurrency: () => {},
  convert: (a) => a,
  fxFormat: (a) => String(a),
  rates: null,
  fetchedAt: null,
  isLoading: false,
  overrides: {},
  setRateOverride: () => {},
  resetRateOverride: () => {},
  resetAllOverrides: () => {},
  refreshRates: () => {},
});

const LS_KEY = "folio_display_currency";
const LS_OVERRIDES_KEY = "dashboard_fx_overrides";

async function fetchFxRates(base: string): Promise<FxRateData> {
  const res = await fetch(`/api/fx-rates?base=${base}`, { credentials: "include" });
  if (!res.ok) throw new Error("FX fetch failed");
  return res.json();
}

function loadOverrides(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOverrides(o: Record<string, number>) {
  localStorage.setItem(LS_OVERRIDES_KEY, JSON.stringify(o));
}

export function FxProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [displayCurrency, setDisplayCurrencyState] = useState<CurrencyCode>(() => {
    const saved = localStorage.getItem(LS_KEY);
    return (saved as CurrencyCode) ?? "USD";
  });
  const [overrides, setOverrides] = useState<Record<string, number>>(loadOverrides);

  const setDisplayCurrency = useCallback((c: CurrencyCode) => {
    localStorage.setItem(LS_KEY, c);
    setDisplayCurrencyState(c);
  }, []);

  const { data, isLoading } = useQuery<FxRateData>({
    queryKey: ["fx-rates", displayCurrency],
    queryFn: () => fetchFxRates(displayCurrency),
    staleTime: 15 * 60 * 1000,
    retry: 2,
  });

  const refreshRates = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["fx-rates", displayCurrency] });
  }, [qc, displayCurrency]);

  const setRateOverride = useCallback((currency: string, rate: number) => {
    setOverrides(prev => {
      const next = { ...prev, [currency]: rate };
      saveOverrides(next);
      return next;
    });
  }, []);

  const resetRateOverride = useCallback((currency: string) => {
    setOverrides(prev => {
      const next = { ...prev };
      delete next[currency];
      saveOverrides(next);
      return next;
    });
  }, []);

  const resetAllOverrides = useCallback(() => {
    setOverrides({});
    saveOverrides({});
  }, []);

  // rates[X] = how many displayCurrency units equal 1 unit of X
  const rates = data?.rates ?? null;

  // convert() checks user overrides first, falls back to server rates
  const convert = useCallback((amount: number, fromCurrency: string): number => {
    if (fromCurrency === displayCurrency) return amount;
    const rate = overrides[fromCurrency] ?? rates?.[fromCurrency] ?? 1;
    return amount * rate;
  }, [rates, overrides, displayCurrency]);

  const fxFormat = useCallback((amount: number, fromCurrency: string = displayCurrency): string => {
    const converted = convert(amount, fromCurrency);
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: displayCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(converted);
    } catch {
      return `${displayCurrency} ${converted.toFixed(2)}`;
    }
  }, [convert, displayCurrency]);

  return (
    <FxContext.Provider value={{
      displayCurrency,
      setDisplayCurrency,
      convert,
      fxFormat,
      rates,
      fetchedAt: data?.fetchedAt ?? null,
      isLoading,
      overrides,
      setRateOverride,
      resetRateOverride,
      resetAllOverrides,
      refreshRates,
    }}>
      {children}
    </FxContext.Provider>
  );
}

export function useFx() {
  return useContext(FxContext);
}

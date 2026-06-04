import yahooFinance from "yahoo-finance2";
import { logger } from "./logger";

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "PHP", "JPY", "AUD", "CAD", "SGD", "HKD", "CHF", "CNY", "INR"] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

// Yahoo Finance tickers for 1 UNIT of currency → USD
const YF_TICKERS: Record<string, string> = {
  GBP: "GBPUSD=X",
  EUR: "EURUSD=X",
  PHP: "PHPUSD=X",
  JPY: "JPYUSD=X",
  AUD: "AUDUSD=X",
  CAD: "CADUSD=X",
  SGD: "SGDUSD=X",
  HKD: "HKDUSD=X",
  CHF: "CHFUSD=X",
  CNY: "CNYUSD=X",
  INR: "INRUSD=X",
};

// Hardcoded fallback rates (approx, updated periodically) — 1 unit → USD
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 1.09,
  GBP: 1.27,
  PHP: 0.0175,
  JPY: 0.0067,
  AUD: 0.65,
  CAD: 0.73,
  SGD: 0.74,
  HKD: 0.128,
  CHF: 1.11,
  CNY: 0.138,
  INR: 0.012,
};

// Rates: how many USD is 1 unit of currency
// e.g. { GBP: 1.27, PHP: 0.0175, EUR: 1.09, USD: 1 }
interface FxCache {
  ratesInUsd: Record<string, number>;
  fetchedAt: number;
}

let cache: FxCache | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function fetchRatesInUsd(): Promise<Record<string, number>> {
  const tickers = Object.values(YF_TICKERS);
  // Start with fallback rates so we always have a valid baseline
  const rates: Record<string, number> = { ...FALLBACK_RATES };

  try {
    const results = await Promise.allSettled(
      tickers.map(ticker => (yahooFinance.quote as any)(ticker, {}, { validateResult: false }))
    );

    for (const [currency, ticker] of Object.entries(YF_TICKERS)) {
      const idx = tickers.indexOf(ticker);
      const result = results[idx];
      if (result.status === "fulfilled" && result.value) {
        const price = (result.value as any).regularMarketPrice ?? (result.value as any).price;
        if (price && price > 0) {
          rates[currency] = price;
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "FX rate fetch failed — using fallback rates");
  }

  return rates;
}

export async function getFxRates(): Promise<{ ratesInUsd: Record<string, number>; fetchedAt: number }> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  const ratesInUsd = await fetchRatesInUsd();
  cache = { ratesInUsd, fetchedAt: now };
  return cache;
}

/**
 * Convert an amount from one currency to another using USD as intermediary.
 * e.g. convert(100, "GBP", "PHP", rates) → value in PHP
 */
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  ratesInUsd: Record<string, number>
): number {
  if (from === to) return amount;
  const fromRate = ratesInUsd[from] ?? FALLBACK_RATES[from] ?? 1;  // 1 FROM = fromRate USD
  const toRate = ratesInUsd[to] ?? FALLBACK_RATES[to] ?? 1;        // 1 TO   = toRate USD
  return (amount * fromRate) / toRate;
}

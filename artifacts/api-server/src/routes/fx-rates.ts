import { Router } from "express";
import { getFxRates, convertCurrency, SUPPORTED_CURRENCIES } from "../lib/fx";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

// GET /api/fx-rates?base=USD
router.get("/", async (req, res) => {
  try {
    const base = ((req.query.base as string) || "USD").toUpperCase();
    const { ratesInUsd, fetchedAt } = await getFxRates();

    // Convert all rates so they are expressed in terms of the requested base
    // i.e. how many BASE units equal 1 unit of currency X
    const rates: Record<string, number> = {};
    for (const currency of SUPPORTED_CURRENCIES) {
      const rateInUsd = ratesInUsd[currency] ?? 1;
      // 1 currency = rateInUsd USD → in base: rateInUsd / baseInUsd
      rates[currency] = convertCurrency(1, currency, base, ratesInUsd);
    }

    res.json({
      base,
      rates,                   // 1 unit of KEY = rates[KEY] BASE
      fetchedAt: new Date(fetchedAt).toISOString(),
      staleAfterMs: 15 * 60 * 1000,
      supportedCurrencies: SUPPORTED_CURRENCIES,
    });
  } catch (err) {
    req.log.error({ err }, "getFxRates failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

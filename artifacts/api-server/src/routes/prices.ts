import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { fetchPrices, searchSymbols, fetchDividendInfo, fetchChartData, fetchQuoteDetail, clearPriceCacheForSymbols } from "../lib/prices";
import { searchPseStocks } from "../lib/pse-stocks";

const router = Router();
router.use(requireAuth);

// GET /api/prices?symbols=AAPL:US,BTC:CRYPTO,TEL:PSE
router.get("/", async (req, res) => {
  try {
    const symbolsParam = req.query.symbols as string;
    if (!symbolsParam) { res.status(400).json({ error: "symbols parameter required" }); return; }

    const symbolMarkets = symbolsParam.split(",").map(s => {
      const [symbol, market] = s.trim().split(":");
      return { symbol: symbol.toUpperCase(), market: market ?? "US" };
    }).filter(s => s.symbol);

    const results = await fetchPrices(symbolMarkets);
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "getPrices failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/prices/search?q=apple&market=US
router.get("/search", async (req, res) => {
  try {
    const q = req.query.q as string;
    const market = req.query.market as string | undefined;
    if (!q) { res.status(400).json({ error: "q parameter required" }); return; }
    const results = await searchSymbols(q, market);
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "searchSymbols failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/prices/refresh  — bust cache for given symbols and re-fetch immediately
router.post("/refresh", async (req, res) => {
  try {
    const symbols = req.body?.symbols as Array<{ symbol: string; market: string }> | undefined;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      res.status(400).json({ error: "symbols array required" }); return;
    }
    await clearPriceCacheForSymbols(symbols);
    const results = await fetchPrices(symbols);
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "refreshPrices failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/prices/pse-stocks?q=bdo   — instant local PSE stock list, no external API
router.get("/pse-stocks", async (req, res) => {
  try {
    const q = (req.query.q as string) ?? "";
    const results = searchPseStocks(q).map(s => ({
      symbol: s.symbol,
      name: s.name,
      market: "PSE",
      currency: "PHP",
      exchange: "PSE",
    }));
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "getPseStocks failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/prices/dividend-info?symbol=BDO&market=PSE
router.get("/dividend-info", async (req, res) => {
  try {
    const symbol = (req.query.symbol as string)?.toUpperCase();
    const market = (req.query.market as string) ?? "US";
    if (!symbol) { res.status(400).json({ error: "symbol parameter required" }); return; }
    const result = await fetchDividendInfo(symbol, market);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "getDividendInfo failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/prices/chart?symbol=AAPL&market=US&period1=2024-01-01&interval=1d
router.get("/chart", async (req, res) => {
  try {
    const symbol   = (req.query.symbol as string)?.toUpperCase();
    const market   = (req.query.market as string) ?? "US";
    const period1  = (req.query.period1 as string) ?? new Date(Date.now() - 365 * 86400000).toISOString().split("T")[0];
    const interval = (req.query.interval as string) ?? "1d";
    if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }
    const quotes = await fetchChartData(symbol, market, period1, interval);
    res.json({ symbol, quotes });
  } catch (err) {
    req.log.error({ err }, "getChart failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/prices/quote-detail?symbol=AAPL&market=US
router.get("/quote-detail", async (req, res) => {
  try {
    const symbol = (req.query.symbol as string)?.toUpperCase();
    const market = (req.query.market as string) ?? "US";
    if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }
    const result = await fetchQuoteDetail(symbol, market);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "getQuoteDetail failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

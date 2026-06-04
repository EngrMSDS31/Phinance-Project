import { useState } from "react";

const SYMBOL_TO_DOMAIN: Record<string, string> = {
  AAPL: "apple.com", MSFT: "microsoft.com", GOOGL: "google.com",
  GOOG: "google.com", AMZN: "amazon.com", META: "meta.com",
  TSLA: "tesla.com", NFLX: "netflix.com", AMD: "amd.com",
  INTC: "intel.com", NVDA: "nvidia.com", ORCL: "oracle.com",
  CRM: "salesforce.com", ADBE: "adobe.com", PYPL: "paypal.com",
  V: "visa.com", MA: "mastercard.com", JPM: "jpmorganchase.com",
  BAC: "bankofamerica.com", WFC: "wellsfargo.com", GS: "goldmansachs.com",
  VOO: "vanguard.com", VTI: "vanguard.com", VGT: "vanguard.com",
  SPY: "ssga.com", QQQ: "invesco.com", IVV: "ishares.com",
  ARKK: "ark-invest.com", ARKG: "ark-invest.com",
  BDO: "bdo.com.ph", BPI: "bpi.com.ph", MER: "meralco.com.ph",
  GLO: "globe.com.ph", TEL: "pldt.com.ph", JFC: "jollibee.com",
  ALI: "ayalaland.com.ph", AC: "ayala.com.ph", SM: "sminvestments.com.ph",
  GMA7: "gmanews.tv", FGEN: "firstgen.com.ph", MBT: "metrobank.com.ph",
  DMC: "dmcinet.com", SCC: "semirara.com.ph", PGOLD: "puregold.com.ph",
  ICB: "icbankph.com", RLC: "robinsonsland.com.ph", AGI: "alliance.com.ph",
  BTC: "bitcoin.org", ETH: "ethereum.org",
};

const LOGO_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#f97316", "#06b6d4", "#ec4899", "#84cc16", "#6366f1",
];

function getInitials(symbol: string): string {
  const clean = symbol.replace(/\.[A-Z]+$/, "").replace(/[^A-Za-z]/g, "");
  return clean.slice(0, 2).toUpperCase();
}

function symbolColor(symbol: string): string {
  let hash = 0;
  for (const ch of symbol) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return LOGO_COLORS[Math.abs(hash) % LOGO_COLORS.length];
}

export function StockLogo({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const baseSymbol = symbol.replace(/\.[A-Z]+$/, "").toUpperCase();
  const domain = SYMBOL_TO_DOMAIN[baseSymbol];
  const [failed, setFailed] = useState(!domain);
  const initials = getInitials(symbol);
  const bg = symbolColor(symbol);
  const fontSize = Math.round(size * 0.375);

  if (failed || !domain) {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: "50%",
          background: bg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize, fontWeight: 700, color: "#fff", letterSpacing: "0.02em",
          userSelect: "none",
        }}
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: "#fff", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <img
        src={`https://logo.clearbit.com/${domain}`}
        alt={symbol}
        width={size}
        height={size}
        style={{ objectFit: "contain" }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

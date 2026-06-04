type TxFormSummaryProps = {
  type: string;
  currency: string;
  gross: number;
  fee: number;
  tax: number;
};

const DIVIDEND_TYPES = new Set(["DIVIDEND", "COUPON_INTEREST", "STAKING_REWARD", "DISTRIBUTION"]);

export function TxFormSummary({ type, currency, gross, fee, tax }: TxFormSummaryProps) {
  if (gross <= 0) return null;

  const isBuy = type === "BUY";
  const isSell = type === "SELL";
  const isDividend = DIVIDEND_TYPES.has(type);

  if (!isBuy && !isSell && !isDividend) return null;

  const net = isBuy
    ? gross + fee + tax
    : Math.max(0, gross - fee - tax);

  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;

  return (
    <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-muted-foreground">{isDividend ? "Gross Dividend" : "Gross Amount"}</span>
        <span className="font-mono">{fmt(gross)}</span>
      </div>

      {isBuy && fee > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">+ Buy Fee</span>
          <span className="font-mono text-muted-foreground">+{fmt(fee)}</span>
        </div>
      )}
      {isBuy && tax > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">+ Tax</span>
          <span className="font-mono text-muted-foreground">+{fmt(tax)}</span>
        </div>
      )}

      {isSell && fee > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-destructive">− Sell Fee</span>
          <span className="font-mono text-destructive">−{fmt(fee)}</span>
        </div>
      )}
      {isSell && tax > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-destructive">− Tax</span>
          <span className="font-mono text-destructive">−{fmt(tax)}</span>
        </div>
      )}

      {isDividend && tax > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-destructive">− Withholding Tax</span>
          <span className="font-mono text-destructive">−{fmt(tax)}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-1.5 border-t border-border/60">
        <span className="font-semibold">{isDividend ? "Net Received" : "Net Amount"}</span>
        <span className="font-mono font-semibold text-gain">{fmt(net)}</span>
      </div>
    </div>
  );
}

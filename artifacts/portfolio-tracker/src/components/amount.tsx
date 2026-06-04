import { usePrivacy } from "@/lib/privacy-context";
import { formatCurrency } from "@/lib/format";

interface SensitiveAmountProps {
  value: number;
  currency?: string;
  className?: string;
}

export function SensitiveAmount({ value, currency = "USD", className }: SensitiveAmountProps) {
  const { showAmounts } = usePrivacy();
  if (!showAmounts) {
    return <span className={`select-none tracking-widest text-muted-foreground ${className ?? ""}`}>•••••</span>;
  }
  return <span className={className}>{formatCurrency(value, currency)}</span>;
}

interface SensitiveTextProps {
  children: React.ReactNode;
  className?: string;
  maskWidth?: string;
}

export function SensitiveText({ children, className, maskWidth = "3em" }: SensitiveTextProps) {
  const { showAmounts } = usePrivacy();
  if (!showAmounts) {
    return (
      <span
        className={`inline-block select-none tracking-widest text-muted-foreground ${className ?? ""}`}
        style={{ minWidth: maskWidth }}
      >
        ••••
      </span>
    );
  }
  return <span className={className}>{children}</span>;
}

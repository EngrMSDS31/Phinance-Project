import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";

export const CURRENCIES = [
  "AED","AUD","BDT","BRL","BTC","CAD","CHF","CLP","CNY","COP",
  "DKK","ETH","EUR","GBP","GHS","HKD","IDR","INR","JPY","KES",
  "KRW","MXN","MYR","NGN","NOK","NZD","PEN","PHP","PKR","QAR",
  "RUB","SAR","SEK","SGD","THB","TRY","TWD","USD","USDC","USDT",
  "VND","XRP","ZAR",
];

export function CurrencyCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = CURRENCIES.filter(c => c.toLowerCase().includes(query.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between h-9 font-mono text-left font-normal">
          {value || <span className="text-muted-foreground font-sans text-sm">Select currency…</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Not found.</CommandEmpty>
            <CommandGroup>
              {filtered.map(c => (
                <CommandItem key={c} value={c} onSelect={() => { onChange(c); setOpen(false); setQuery(""); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === c ? "opacity-100" : "opacity-0"}`} />
                  {c}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

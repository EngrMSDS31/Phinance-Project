import { Link, useLocation } from "wouter";
import { UserButton, useUser } from "@clerk/react";
import { dark } from "@clerk/themes";
import { useState } from "react";
import {
  LayoutDashboard, ArrowRightLeft, LineChart, BellRing,
  CalendarDays, Settings, FileSpreadsheet, StickyNote, CalendarClock,
  Crosshair, Moon, Sun, Monitor, RefreshCw, BarChart2, MoreHorizontal,
  MessageSquare, ArrowLeftRight, Eye, EyeOff, Check, Briefcase,
} from "lucide-react";
import { usePrivacy } from "@/lib/privacy-context";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFx, SUPPORTED_CURRENCIES } from "@/lib/fx-context";
import { FxRateWidget } from "@/components/fx-rate-widget";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 pb-[76px] md:pb-6 md:p-6 lg:p-8 relative">
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}

function Sidebar() {
  const [location] = useLocation();

  const portfolioHref = (() => { try { const id = sessionStorage.getItem("folio_last_pf_id"); return id ? `/portfolios/${id}` : "/portfolios"; } catch { return "/portfolios"; } })();

  const navItems = [
    { href: "/dashboard",         label: "Dashboard",      icon: LayoutDashboard },
    { href: portfolioHref,        label: "Portfolios",     icon: Briefcase },
    { href: "/transactions",      label: "Transactions",   icon: ArrowRightLeft },
    { href: "/analytics",         label: "Analytics",      icon: BarChart2 },
    { href: "/watchlists",        label: "Watchlists",     icon: LineChart },
    { href: "/alerts",            label: "Alerts",         icon: BellRing },
    { href: "/dividend-calendar", label: "Dividends",      icon: CalendarDays },
    { href: "/csv",               label: "Import/Export",  icon: FileSpreadsheet },
    { href: "/notes",             label: "Notes",          icon: StickyNote },
    { href: "/recurring",         label: "Inv. Plans",     icon: CalendarClock },
    { href: "/sizer",             label: "Position Sizer", icon: Crosshair },
    { href: "/settings",          label: "Settings",       icon: Settings },
    { href: "/feedback",          label: "Feedback",       icon: MessageSquare },
  ];

  return (
    <aside className="w-64 border-r border-border bg-card flex-col hidden md:flex">
      <div className="h-16 flex items-center px-6 border-b border-border">
        <div className="flex items-center gap-2">
          <img src="/phinance-logo.png" alt="Phinance" className="h-8 w-auto" style={{ filter: "brightness(0) invert(1)" }} />
        </div>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-3 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors
                ${isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border">
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-1">PRO PLAN</div>
          <div className="text-sm font-medium">All Markets Unlocked</div>
        </div>
      </div>
    </aside>
  );
}

function MobileBottomNav() {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: summary } = useGetDashboardSummary();

  const mobilePortfolioHref = (() => { try { const id = sessionStorage.getItem("folio_last_pf_id"); return id ? `/portfolios/${id}` : "/portfolios"; } catch { return "/portfolios"; } })();

  const mainItems = [
    { href: "/dashboard",           label: "Dashboard", Icon: LayoutDashboard },
    { href: "/analytics",           label: "Analytics", Icon: BarChart2 },
    { href: "/dividend-calendar",   label: "Calendar",  Icon: CalendarDays },
    { href: mobilePortfolioHref,    label: "Portfolio", Icon: Briefcase },
  ];

  const moreItems = [
    { href: "/watchlists",  label: "Watchlists",     icon: LineChart },
    { href: "/alerts",      label: "Alerts",         icon: BellRing },
    { href: "/csv",         label: "Import/Export",  icon: FileSpreadsheet },
    { href: "/notes",       label: "Notes",          icon: StickyNote },
    { href: "/recurring",   label: "Inv. Plans",     icon: CalendarClock },
    { href: "/sizer",       label: "Position Sizer", icon: Crosshair },
    { href: "/settings",    label: "Settings",       icon: Settings },
    { href: "/feedback",    label: "Feedback",       icon: MessageSquare },
  ];

  const moreActive = moreItems.some(i => location.startsWith(i.href));

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 h-[60px] bg-card border-t border-border flex md:hidden z-50">
        {mainItems.map(({ href, label, Icon }) => {
          const isActive = location.startsWith(href);
          return (
            <Link key={href} href={href} className="flex-1 flex flex-col items-center justify-center gap-0.5 relative">
              {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full" />}
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : "text-muted-foreground"}`} strokeWidth={isActive ? 2.5 : 1.75} />
              <span className={`text-[9px] font-medium leading-none ${isActive ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-0.5 relative">
          {moreActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full" />}
          <div className="relative">
            <MoreHorizontal className={`w-5 h-5 ${moreActive ? "text-primary" : "text-muted-foreground"}`} strokeWidth={moreActive ? 2.5 : 1.75} />
            {summary?.unreadNotifications ? <span className="absolute -top-1 -right-1 w-2 h-2 bg-destructive rounded-full" /> : null}
          </div>
          <span className={`text-[9px] font-medium leading-none ${moreActive ? "text-primary" : "text-muted-foreground"}`}>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="md:hidden rounded-t-2xl pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-left text-sm font-semibold">More</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-4 gap-3">
            {moreItems.map(({ href, label, icon: Icon }) => {
              const isActive = location.startsWith(href);
              return (
                <Link
                  key={href} href={href} onClick={() => setMoreOpen(false)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-colors ${
                    isActive
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="w-5 h-5" strokeWidth={1.75} />
                  <span className="text-[10px] font-medium text-center leading-tight">{label}</span>
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Topbar() {
  const { user } = useUser();
  const { data: summary } = useGetDashboardSummary();
  const { displayCurrency, setDisplayCurrency, fetchedAt, isLoading, rates } = useFx();
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() =>
    (localStorage.getItem("folio_theme") ?? "dark") as "system" | "light" | "dark"
  );
  const [fxOpen, setFxOpen] = useState(false);
  const { showAmounts, toggleShowAmounts } = usePrivacy();

  const changeTheme = (t: "system" | "light" | "dark") => {
    setTheme(t);
    localStorage.setItem("folio_theme", t);
    const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  };
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const rateAge = fetchedAt
    ? Math.round((Date.now() - new Date(fetchedAt).getTime()) / 60_000)
    : null;

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
      <div className="flex items-center gap-4">
        {/* Mobile wordmark */}
        <div className="flex items-center gap-2 md:hidden">
          <img src="/phinance-logo.png" alt="Phinance" className="h-8 w-auto" style={{ filter: "brightness(0) invert(1)" }} />
        </div>
        <div className="text-sm text-muted-foreground font-mono hidden sm:block">
          {new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
        </div>
        {rates && !isLoading && (
          <div className="hidden xl:flex items-center gap-3 border-l border-border pl-4">
            {(["PHP", "GBP", "EUR", "USD", "JPY"] as const)
              .filter(c => c !== displayCurrency && (rates as any)[c] != null)
              .slice(0, 3)
              .map(c => {
                const r = (rates as any)[c] as number;
                const fmt = r >= 100 ? r.toFixed(0) : r >= 1 ? r.toFixed(2) : r.toFixed(4);
                return (
                  <span key={c} className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                    {c} <span className="text-foreground/80">{fmt}</span>
                  </span>
                );
              })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {/* FX currency selector */}
        <div className="flex items-center gap-1.5">
          {isLoading && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
          {!isLoading && rateAge !== null && (
            <span className="text-xs text-muted-foreground hidden lg:block">
              FX {rateAge === 0 ? "now" : `${rateAge}m ago`}
            </span>
          )}
          <Select value={displayCurrency} onValueChange={(v) => setDisplayCurrency(v as typeof displayCurrency)}>
            <SelectTrigger className="h-7 w-[88px] text-xs font-mono border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_CURRENCIES.map(c => (
                <SelectItem key={c.code} value={c.code} className="text-xs font-mono">
                  {c.code} {c.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* FIX 2: Mobile-only FX override button */}
        <button
          onClick={() => setFxOpen(true)}
          className="md:hidden flex items-center gap-1 h-8 px-2 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="FX Rate Overrides"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </button>

        <div className="h-5 w-px bg-border hidden md:block" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title={theme.charAt(0).toUpperCase() + theme.slice(1)}
              className="h-7 w-7 flex items-center justify-center rounded bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              {theme === "system" && <Monitor className="h-3.5 w-3.5" />}
              {theme === "light" && <Sun className="h-3.5 w-3.5" />}
              {theme === "dark" && <Moon className="h-3.5 w-3.5" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem onClick={() => changeTheme("system")} className="flex items-center gap-2">
              <Monitor className="h-3.5 w-3.5" />
              <span className="flex-1">System</span>
              {theme === "system" && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => changeTheme("light")} className="flex items-center gap-2">
              <Sun className="h-3.5 w-3.5" />
              <span className="flex-1">Light</span>
              {theme === "light" && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => changeTheme("dark")} className="flex items-center gap-2">
              <Moon className="h-3.5 w-3.5" />
              <span className="flex-1">Dark</span>
              {theme === "dark" && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={toggleShowAmounts}
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
          title={showAmounts ? "Hide amounts" : "Show amounts"}
        >
          {showAmounts ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>

        <Link href="/alerts" className="relative p-2 text-muted-foreground hover:text-foreground transition-colors hidden md:block">
          <BellRing className="w-5 h-5" />
          {summary?.unreadNotifications ? <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" /> : null}
        </Link>

        <div className="h-6 w-px bg-border mx-1 hidden md:block" />

        <div className="flex items-center gap-3 pl-1">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-sm font-medium leading-none">{user?.fullName || user?.primaryEmailAddress?.emailAddress}</span>
          </div>
          <UserButton
            key={isDark ? "dark" : "light"}
            appearance={{
              baseTheme: isDark ? dark : undefined,
              elements: { userButtonAvatarBox: "w-8 h-8" },
            }}
          />
        </div>
      </div>

      {/* FX Rates Sheet (mobile) */}
      <Sheet open={fxOpen} onOpenChange={setFxOpen}>
        <SheetContent side="bottom" className="md:hidden rounded-t-2xl pb-8 max-h-[85vh] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-left text-sm font-semibold">FX Rate Overrides</SheetTitle>
          </SheetHeader>
          <FxRateWidget />
        </SheetContent>
      </Sheet>
    </header>
  );
}

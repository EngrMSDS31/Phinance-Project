import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, ClerkLoading } from "@clerk/react";
import { dark } from "@clerk/themes";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Layout } from "@/components/layout";
import { FxProvider } from "@/lib/fx-context";
import { PrivacyProvider } from "@/lib/privacy-context";
import Dashboard from "@/pages/dashboard";
import Portfolios from "@/pages/portfolios";
import PortfolioDetail from "@/pages/portfolio-detail";
import Transactions from "@/pages/transactions";
import Watchlists from "@/pages/watchlists";
import Alerts from "@/pages/alerts";
import DividendCalendar from "@/pages/dividend-calendar";
import CsvImportExport from "@/pages/csv";
import Settings from "@/pages/settings";
import TaxReport from "@/pages/tax-report";
import Feedback from "@/pages/feedback";
import Notes from "@/pages/notes";
import Recurring from "@/pages/recurring";
import Sizer from "@/pages/sizer";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const CLERK_COMMON_OPTIONS = {
  logoPlacement: "inside" as const,
  logoLinkUrl: basePath || "/",
};
const CLERK_COMMON_VARS = {
  colorPrimary: "hsl(217.2, 91.2%, 59.8%)",
  colorDanger: "hsl(0, 62.8%, 50%)",
  fontFamily: "Inter, sans-serif",
  borderRadius: "0.375rem",
};

const darkClerkAppearance = {
  baseTheme: dark,
  options: CLERK_COMMON_OPTIONS,
  variables: {
    ...CLERK_COMMON_VARS,
    colorBackground: "hsl(222, 47%, 5%)",
    colorInputBackground: "hsl(217.2, 32.6%, 17.5%)",
    colorText: "#f0f4ff",
    colorTextSecondary: "#94a3b8",
    colorInputText: "#f0f4ff",
    colorNeutral: "#f0f4ff",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "rounded-xl overflow-hidden shadow-2xl border border-white/10",
    card: { backgroundColor: "hsl(222,47%,7%)", boxShadow: "none" },
    footer: { backgroundColor: "hsl(222,47%,7%)", borderTop: "1px solid rgba(255,255,255,0.08)" },
    formButtonPrimary: { backgroundColor: "hsl(217.2,91.2%,59.8%)", color: "white" },
    formFieldInput: { backgroundColor: "hsl(217.2,32.6%,15%)", color: "#f0f4ff", borderColor: "rgba(255,255,255,0.15)" },
    formFieldLabel: { color: "#94a3b8" },
    socialButtonsBlockButton: { border: "1px solid rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.04)", color: "#f0f4ff" },
    socialButtonsBlockButtonText: { color: "#f0f4ff" },
    dividerLine: { backgroundColor: "rgba(255,255,255,0.08)" },
    dividerText: { color: "#64748b" },
    headerTitle: { color: "#f0f4ff", fontWeight: "600" },
    headerSubtitle: { color: "#94a3b8" },
    identityPreviewText: { color: "#f0f4ff" },
    formHeaderTitle: { color: "#f0f4ff" },
    footerActionText: { color: "#94a3b8" },
    footerActionLink: { color: "hsl(217.2,91.2%,59.8%)" },
    alternativeMethodsBlockButton: { color: "#f0f4ff", borderColor: "rgba(255,255,255,0.15)" },
    otpCodeFieldInput: { color: "#f0f4ff", backgroundColor: "hsl(217.2,32.6%,15%)", borderColor: "rgba(255,255,255,0.15)" },
  },
};

const lightClerkAppearance = {
  options: CLERK_COMMON_OPTIONS,
  variables: {
    ...CLERK_COMMON_VARS,
    colorBackground: "hsl(0, 0%, 100%)",
    colorInputBackground: "hsl(210, 40%, 98%)",
    colorText: "hsl(222.2, 47.4%, 11.2%)",
    colorTextSecondary: "hsl(215.4, 16.3%, 46.9%)",
    colorInputText: "hsl(222.2, 47.4%, 11.2%)",
    colorNeutral: "hsl(222.2, 47.4%, 11.2%)",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "rounded-xl overflow-hidden shadow-lg border border-border",
    card: { backgroundColor: "hsl(0,0%,100%)", boxShadow: "none" },
    footer: { backgroundColor: "hsl(210,40%,98%)", borderTop: "1px solid hsl(214.3,31.8%,91.4%)" },
    formButtonPrimary: { backgroundColor: "hsl(217.2,91.2%,59.8%)", color: "white" },
    formFieldInput: { backgroundColor: "white", color: "hsl(222.2,47.4%,11.2%)", borderColor: "hsl(214.3,31.8%,91.4%)" },
    formFieldLabel: { color: "hsl(215.4,16.3%,46.9%)" },
    socialButtonsBlockButton: { border: "1px solid hsl(214.3,31.8%,91.4%)", backgroundColor: "white", color: "hsl(222.2,47.4%,11.2%)" },
    socialButtonsBlockButtonText: { color: "hsl(222.2,47.4%,11.2%)" },
    dividerLine: { backgroundColor: "hsl(214.3,31.8%,91.4%)" },
    dividerText: { color: "hsl(215.4,16.3%,46.9%)" },
    headerTitle: { color: "hsl(222.2,47.4%,11.2%)", fontWeight: "600" },
    headerSubtitle: { color: "hsl(215.4,16.3%,46.9%)" },
    identityPreviewText: { color: "hsl(222.2,47.4%,11.2%)" },
    formHeaderTitle: { color: "hsl(222.2,47.4%,11.2%)" },
    footerActionText: { color: "hsl(215.4,16.3%,46.9%)" },
    footerActionLink: { color: "hsl(217.2,91.2%,59.8%)" },
    alternativeMethodsBlockButton: { color: "hsl(222.2,47.4%,11.2%)", borderColor: "hsl(214.3,31.8%,91.4%)" },
    otpCodeFieldInput: { color: "hsl(222.2,47.4%,11.2%)", backgroundColor: "white", borderColor: "hsl(214.3,31.8%,91.4%)" },
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function LandingPage() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background text-foreground px-6">
      <div className="max-w-md text-center space-y-8">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 text-primary font-mono text-sm tracking-widest uppercase opacity-70">
            Portfolio Tracker
          </div>
          <div className="flex justify-center">
            <img src="/phinance-logo.png" alt="Phinance" className="h-14 w-auto" style={{ filter: "brightness(0) invert(1)" }} />
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-foreground">Phinance</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            A unified command center for multi-market investors. Track PSE, LSE, US stocks, crypto, and custom holdings — all in one place.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => setLocation("/sign-in")}
            className="px-8 py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
            data-testid="button-sign-in"
          >
            Sign In
          </button>
          <button
            onClick={() => setLocation("/sign-up")}
            className="px-8 py-3 rounded-lg border border-border text-foreground font-semibold hover:bg-muted/50 transition-colors"
            data-testid="button-sign-up"
          >
            Create Account
          </button>
        </div>
        <p className="text-xs text-muted-foreground/60">
          Real-time prices. Multi-currency. Dividend calendar. Price alerts.
        </p>
      </div>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <ClerkLoading>
        <div className="flex min-h-[100dvh] items-center justify-center bg-background">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </ClerkLoading>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ProtectedRoutes() {
  return (
    <>
      <ClerkLoading>
        <div className="flex min-h-[100dvh] items-center justify-center bg-background">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </ClerkLoading>
      <Show when="signed-in">
        <PrivacyProvider>
        <FxProvider>
        <Layout>
          <Switch>
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/portfolios" component={Portfolios} />
            <Route path="/portfolios/:id" component={PortfolioDetail} />
            <Route path="/transactions" component={Transactions} />
            <Route path="/watchlists" component={Watchlists} />
            <Route path="/alerts" component={Alerts} />
            <Route path="/dividend-calendar" component={DividendCalendar} />
            <Route path="/csv" component={CsvImportExport} />
            <Route path="/tax-report" component={TaxReport} />
            <Route path="/notes" component={Notes} />
            <Route path="/recurring" component={Recurring} />
            <Route path="/sizer" component={Sizer} />
            <Route path="/analytics" component={Analytics} />
            <Route path="/settings" component={Settings} />
            <Route path="/feedback" component={Feedback} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
        </FxProvider>
        </PrivacyProvider>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={isDark ? darkClerkAppearance : lightClerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/*" component={ProtectedRoutes} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  useEffect(() => {
    const saved = (localStorage.getItem("folio_theme") ?? "dark") as "system" | "light" | "dark";
    const apply = () => {
      const dark = saved === "dark" || (saved === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    if (saved !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;

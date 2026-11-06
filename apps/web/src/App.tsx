import { useEffect, useRef, useState } from "react";
import { api, type AppConfig } from "./api";
import { ConfigProvider } from "./hooks";
import DemoDrawer from "./components/DemoDrawer";
import { NAV, SiteFooter, SiteHeader } from "./components/Shell";
import { btn, Card } from "./components/ui";
import HistoryScreen from "./screens/HistoryScreen";
import LandingScreen from "./screens/LandingScreen";
import LedgerScreen from "./screens/LedgerScreen";
import MandateScreen from "./screens/MandateScreen";
import ResearchScreen from "./screens/ResearchScreen";

const PAGES: readonly string[] = NAV.map((n) => n.key);

/** Hash routes: #/ (landing), #/mandate, #/research, #/research/<runId>, #/ledger, #/history. */
function useRoute(): { page: string; arg?: string } {
  const read = () => {
    const [page = "", arg] = window.location.hash.replace(/^#\/?/, "").split("/");
    return { page: PAGES.includes(page) ? page : "home", arg };
  };
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export default function App() {
  const { page, arg } = useRoute();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.config().then(async c => { setConfig(c); if(c.demoMode) await api.session(); else await api.currentSession(); setSignedIn(true); })
      .catch((e) => setError(e instanceof Error ? e.message : "cannot reach the server"))
      .finally(() => setChecked(true));
  }, []);

  // New page starts at the top; the first render keeps the browser's own scroll restore.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    window.scrollTo(0, 0);
  }, [page]);

  const isHome = page === "home";
  // Outside demo mode a failed session check just means "not signed in", not a server problem.
  const serverDown = error && (!config || config.demoMode);

  let content;
  if (!checked) content = <p role="status" className="animate-pulse py-24 text-center text-sm text-zinc-500">Connecting…</p>;
  else if (serverDown) content = <Card><p role="alert" className="text-rose-300">Could not reach the server: {error}</p></Card>;
  else if (!config || !signedIn) content = (
    <Card className="mx-auto max-w-md text-center">
      <h1 className="text-xl font-semibold text-zinc-50">Access is invite-only.</h1>
      <p className="mt-2 text-sm text-zinc-400">Sign in with an invited account to set up a mandate.</p>
      <a href="/api/auth/login" className={`${btn("primary")} mt-6`}>Sign in</a>
    </Card>
  );
  else content = (
    <ConfigProvider value={config}>
      {page === "mandate" && <MandateScreen />}
      {page === "research" && <ResearchScreen runId={arg} />}
      {page === "ledger" && <LedgerScreen />}
      {page === "history" && <HistoryScreen />}
    </ConfigProvider>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(240,185,85,0.06),transparent)]" />
      <SiteHeader page={page} onSignOut={signedIn && config && !config.demoMode ? () => void api.logout().then(() => setSignedIn(false)) : undefined} />
      <main key={page} className="flex-1 animate-page-in">
        {isHome ? <LandingScreen /> : <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-10 sm:px-6 sm:pt-14">{content}</div>}
      </main>
      <SiteFooter />
      {config?.demoMode && signedIn && !isHome && <DemoDrawer />}
    </div>
  );
}

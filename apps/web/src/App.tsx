import { useEffect, useState } from "react";
import { api, type AppConfig } from "./api";
import { ConfigProvider } from "./hooks";
import DemoDrawer from "./components/DemoDrawer";
import HistoryScreen from "./screens/HistoryScreen";
import LedgerScreen from "./screens/LedgerScreen";
import MandateScreen from "./screens/MandateScreen";
import ResearchScreen from "./screens/ResearchScreen";

const NAV = [
  { key: "mandate", label: "Mandate" }, { key: "research", label: "Research" },
  { key: "ledger", label: "Ledger" }, { key: "history", label: "History" },
] as const;

/** Hash routes: #/mandate, #/research, #/research/<runId>, #/ledger, #/history. */
function useRoute(): { page: string; arg?: string } {
  const read = () => {
    const [page, arg] = window.location.hash.replace(/^#\/?/, "").split("/");
    return { page: page || "mandate", arg };
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.session().then(() => api.config()).then(setConfig).catch((e) => setError(e instanceof Error ? e.message : "cannot reach the server"));
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-2 py-4">
        <h1 className="text-xl font-bold">Tollbooth</h1>
        <nav aria-label="Main" className="flex gap-1">
          {NAV.map((n) => (
            <a key={n.key} href={`#/${n.key}`} aria-current={page === n.key ? "page" : undefined}
              className={`rounded px-3 py-2 text-sm no-underline ${page === n.key ? "bg-sky-700 text-white" : "text-slate-300 hover:bg-slate-800"}`}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <p className="mb-4 text-xs text-slate-400">
        Spending limits are enforced by our backend and an isolated signer. In this demo the operator holds the agent key.
      </p>
      {error && <p role="alert" className="mb-4 text-rose-300">Could not reach the server: {error}</p>}
      {config && (
        <ConfigProvider value={config}>
          <main>
            {page === "mandate" && <MandateScreen />}
            {page === "research" && <ResearchScreen runId={arg} />}
            {page === "ledger" && <LedgerScreen />}
            {page === "history" && <HistoryScreen />}
          </main>
          {config.demoMode && <DemoDrawer />}
        </ConfigProvider>
      )}
    </div>
  );
}

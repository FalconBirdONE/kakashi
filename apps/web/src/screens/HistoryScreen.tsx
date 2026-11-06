import { useState } from "react";
import { api, type HistoryItem } from "../api";
import { Arrow, Badge, btn, Button, Card, ErrorText, fmtTime, PageHeader, usdc, type Tone } from "../components/ui";
import { usePoll } from "../hooks";

const TONE: Record<string, Tone> = { DONE: "green", PARTIAL: "yellow", FAILED: "red" };

export default function HistoryScreen() {
  const [runs, setRuns] = useState<HistoryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  usePoll(async () => {
    try { setRuns((await api.runs()).runs); } catch (e) { setErr(e instanceof Error ? e.message : "failed to load history"); }
  }, 3000);

  async function again(id: string) {
    setBusy(id); setErr(null);
    try {
      const { runId } = await api.rerun(id);
      window.location.hash = `#/research/${runId}`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not start the run");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Your runs" title="History">
        Every question you have asked and what it cost. Open a run to see its receipts, or run it again for fresh data.
      </PageHeader>
      {err && <div className="mb-4"><ErrorText>{err}</ErrorText></div>}
      {!runs && !err && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />)}</div>}
      {runs?.length === 0 && (
        <Card className="text-center">
          <div className="py-6">
            <p className="text-zinc-300">No questions yet.</p>
            <a href="#/research" className={`${btn("primary")} mt-5`}>Ask your first question <Arrow /></a>
          </div>
        </Card>
      )}
      <ul className="space-y-3">
        {runs?.map((r, i) => (
          <li key={r.id} className="animate-page-in" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
            <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors duration-300 hover:border-white/[0.14] hover:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge tone={TONE[r.state] ?? "blue"}>{r.state}</Badge>
                  <span className="text-xs text-zinc-500">{fmtTime(r.startedAt)}</span>
                </div>
                <p className="mt-2 break-words font-medium text-zinc-100">{r.question}</p>
                <p className="mt-1 text-xs text-zinc-500">Data spend: <span className="font-mono text-zinc-300">{usdc(r.dataSpendAtomic)}</span></p>
              </div>
              <div className="flex shrink-0 gap-2">
                <a href={`#/research/${r.id}`} className={btn("ghost")}>Open</a>
                <Button onClick={() => void again(r.id)} disabled={busy === r.id}>Run again</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

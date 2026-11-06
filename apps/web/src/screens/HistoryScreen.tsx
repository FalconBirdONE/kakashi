import { useState } from "react";
import { api, type HistoryItem } from "../api";
import { Badge, Button, Card, ErrorText, fmtTime, usdc, type Tone } from "../components/ui";
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
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">History</h2>
      {err && <ErrorText>{err}</ErrorText>}
      {runs?.length === 0 && <Card><p className="text-sm text-slate-300">No questions yet. Ask one on the <a href="#/research">Research</a> page.</p></Card>}
      <ul className="space-y-3">
        {runs?.map((r) => (
          <li key={r.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium">{r.question}</p>
                <Badge tone={TONE[r.state] ?? "blue"}>{r.state}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-400">{fmtTime(r.startedAt)} · Data spend: {usdc(r.dataSpendAtomic)}</p>
              <div className="mt-3 flex gap-2">
                <a href={`#/research/${r.id}`} className="rounded border border-slate-600 px-3 py-2 text-sm no-underline hover:bg-slate-800">Open</a>
                <Button onClick={() => void again(r.id)} disabled={busy === r.id}>Run again</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

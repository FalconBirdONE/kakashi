import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type RunViewWithAudit } from "../api";
import { useRunEvents } from "../useRunEvents";
import { usePoll } from "../hooks";
import { Button, Card, ErrorText, inputCls, Label } from "../components/ui";
import PurchaseCard from "../components/PurchaseCard";
import PlanSection from "../components/timeline/PlanSection";
import QuotesSection from "../components/timeline/QuotesSection";
import DecisionsSection from "../components/timeline/DecisionsSection";
import AnswerSection from "../components/timeline/AnswerSection";
import RunStateBadge from "../components/timeline/RunStateBadge";

const ENDED = ["DONE", "PARTIAL", "FAILED"];
const MOVING = ["AWAITING_APPROVAL", "RESERVED", "SIGNED", "SUBMITTED", "UNKNOWN"];

export default function ResearchScreen({ runId }: { runId?: string }) {
  const [question, setQuestion] = useState("");
  const [view, setView] = useState<RunViewWithAudit | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    if (!runId) return;
    try { setView(await api.run(runId)); } catch (e) { setError({ code: "LOAD", message: e instanceof Error ? e.message : "Could not load the run" }); }
  }, [runId]);

  useEffect(() => { setView(null); setError(null); void load(); }, [load]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useRunEvents(runId, () => { clearTimeout(timer.current); timer.current = setTimeout(() => void load(), 100); });
  const active = !!runId && (!view || !ENDED.includes(view.run.state) || view.purchases.some((p) => MOVING.includes(p.state)));
  usePoll(load, 3000, active);

  async function start() {
    setBusy(true); setError(null);
    try { const { runId: id } = await api.startRun(question.trim()); window.location.hash = `#/research/${id}`; }
    catch (e) { setError(e instanceof ApiError ? { code: e.code, message: e.message } : { code: "ERROR", message: "Could not start the run" }); }
    finally { setBusy(false); }
  }

  const errorEl = error && (error.code === "NO_ACTIVE_MANDATE"
    ? <p role="alert" className="text-sm text-rose-300">You need an active mandate before researching. <a className="underline" href="#/mandate">Set up a mandate</a></p>
    : <ErrorText>{error.message}</ErrorText>);

  return (
    <div className="space-y-4">
      {!runId && (
        <Card title="Ask a question">
          <form onSubmit={(e) => { e.preventDefault(); void start(); }} className="space-y-3">
            <label className="block"><Label>Your question</Label>
              <textarea className={inputCls} rows={3} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || !question.trim()}>Run</Button>
              <span className="text-xs text-slate-400">{question.length}/500</span>
            </div>
          </form>
        </Card>
      )}
      {errorEl}
      {view && (
        <>
          <Card><h1 className="text-lg font-semibold text-slate-100">{view.run.question}</h1><div className="mt-2"><RunStateBadge run={view.run} /></div></Card>
          <PlanSection plan={view.run.plan} />
          <QuotesSection quotes={view.quotes} />
          <DecisionsSection view={view} />
          <Card title="Purchases">
            {(() => {
              const shown = view.purchases.filter((p) => p.state !== "AGENT_SKIPPED" && p.state !== "POLICY_REJECTED");
              return shown.length === 0 ? <p className="text-sm text-slate-400">Nothing bought yet.</p> : (
                <div className="space-y-3">{shown.map((p) => (
                  <div key={p.id} id={`purchase-${p.id}`}><PurchaseCard purchase={p} view={view} onChanged={() => void load()} /></div>
                ))}</div>);
            })()}
          </Card>
          <AnswerSection answer={view.run.answer} />
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type RunViewWithAudit } from "../api";
import { useRunEvents } from "../useRunEvents";
import { usePoll } from "../hooks";
import { Arrow, btn, Button, Card, ErrorText, inputCls, Label, Muted, PageHeader } from "../components/ui";
import PurchaseCard from "../components/PurchaseCard";
import PlanSection from "../components/timeline/PlanSection";
import QuotesSection from "../components/timeline/QuotesSection";
import DecisionsSection from "../components/timeline/DecisionsSection";
import AnswerSection from "../components/timeline/AnswerSection";
import RunStateBadge from "../components/timeline/RunStateBadge";
import { SponsorTag } from "../components/Brand";

const ENDED = ["DONE", "PARTIAL", "FAILED"];
const MOVING = ["AWAITING_APPROVAL", "RESERVED", "SIGNED", "SUBMITTED", "UNKNOWN"];
const LIVE_ORDER = ["PLANNING", "QUOTING", "DECIDING", "PURCHASING", "SYNTHESIZING"];
const EXAMPLES = [
  "Should I put 20 USDC into SAUCE (0.0.731861)?",
  "I'm about to put 2,000 USDC into 0.0.731861. Is it safe?",
  "Is the supply of DOVU (0.0.624505) concentrated? Planning 300 USD.",
  "Quick check before a 5 USD trade of 0.0.4696266",
];
const HAS_TOKEN = /0\.0\.\d+|\b(SAUCE|USDC|DOVU|GRELF)\b/i;
const EYEBROW = "Step 2 of 3 · Research";

type StepState = "done" | "active" | "idle";

/** One stage of the run on the vertical rail. Live runs light up stage by stage; ended runs mark stages that produced something. */
/** `by` names who does this stage, so the sponsor behind each step is visible in the run. */
function Step({ n, title, by, state, last, children }: { n: number; title: string; by?: ReactNode; state: StepState; last?: boolean; children: ReactNode }) {
  const marker = {
    done: "bg-gold-400/15 text-gold-300 ring-gold-400/35",
    active: "bg-sky-400/10 text-sky-300 ring-sky-400/40",
    idle: "bg-ink text-zinc-500 ring-white/10",
  }[state];
  return (
    <li className={`relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 sm:gap-x-6 ${last ? "" : "pb-10"}`}>
      {!last && <span aria-hidden="true" className={`absolute bottom-1 left-[13.5px] top-9 w-px transition-colors duration-700 ${state === "done" ? "bg-gold-400/30" : "bg-white/[0.08]"}`} />}
      <span aria-hidden="true" className={`relative flex size-7 items-center justify-center rounded-full font-mono text-xs ring-1 ring-inset transition-colors duration-500 ${marker}`}>
        {state === "done" ? (
          <svg viewBox="0 0 16 16" className="size-3.5 animate-pop"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : state === "active" ? (
          <><span className="absolute inset-0 animate-ping rounded-full ring-1 ring-sky-400/40" /><span className="size-2 rounded-full bg-sky-400" /></>
        ) : n}
      </span>
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
          <h2 className={`text-[15px] font-semibold ${state === "idle" ? "text-zinc-400" : "text-zinc-100"}`}>{title}</h2>
          {by && <span className="flex flex-wrap gap-1.5">{by}</span>}
        </div>
        <div className="mt-3">{children}</div>
      </section>
    </li>
  );
}

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
    ? <p role="alert" className="text-sm text-rose-300">You need an active mandate before researching. <a className="text-link" href="#/mandate">Set up a mandate</a></p>
    : <ErrorText>{error.message}</ErrorText>);

  const missingToken = !!question.trim() && !HAS_TOKEN.test(question);

  if (!runId) return (
    <div>
      <PageHeader eyebrow={EYEBROW} title="Check a token before you buy.">
        Name the Hedera token and your trade size. The agent buys only the checks the trade justifies, inside your mandate, and answers BUY, CAUTION or AVOID with receipts.
      </PageHeader>
      <Card className="max-w-3xl">
        <form onSubmit={(e) => { e.preventDefault(); void start(); }}>
          <label className="block"><Label>Your question</Label>
            <textarea className={`${inputCls} resize-none`} rows={4} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)} /></label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">Try:</span>
            {EXAMPLES.map((q) => (
              <button key={q} type="button" onClick={() => setQuestion(q)}
                className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 text-left text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100">
                {q}
              </button>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <span className="font-mono text-xs text-zinc-500">{question.length}/500</span>
            {missingToken && <span className="text-xs text-amber-200">Add the token ID, for example 0.0.731861</span>}
            <Button type="submit" disabled={busy || !question.trim() || missingToken}>Run <Arrow /></Button>
          </div>
        </form>
      </Card>
      {errorEl && <div className="mt-4 max-w-3xl">{errorEl}</div>}
    </div>
  );

  const shown = view?.purchases.filter((p) => p.state !== "AGENT_SKIPPED" && p.state !== "POLICY_REJECTED") ?? [];
  const steps: StepState[] = (() => {
    if (!view) return ["idle", "idle", "idle", "idle", "idle"];
    const has = [!!view.run.plan, view.quotes.length > 0, view.purchases.some((p) => p.decision), shown.length > 0, !!view.run.answer];
    const at = LIVE_ORDER.indexOf(view.run.state);
    return has.map((h, i) => (at < 0 ? (h ? "done" : "idle") : i < at ? "done" : i === at ? "active" : "idle"));
  })();
  const ended = !!view && ENDED.includes(view.run.state);

  return (
    <div>
      <a href="#/research" className="group inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-100">
        <span aria-hidden="true" className="transition-transform duration-300 group-hover:-translate-x-0.5">←</span>New question
      </a>
      <p className="mt-6 text-xs font-medium uppercase tracking-[0.16em] text-gold-400">{EYEBROW}</p>
      {view ? (
        <>
          <h1 className="mt-2 max-w-3xl text-balance text-2xl font-semibold tracking-[-0.02em] text-zinc-50 sm:text-3xl">{view.run.question}</h1>
          <div className="mt-4"><RunStateBadge run={view.run} /></div>
        </>
      ) : !error && <div className="mt-3 h-9 max-w-xl animate-pulse rounded-lg bg-white/[0.04]" />}
      {errorEl && <div className="mt-4">{errorEl}</div>}

      {view && (
        <ol className="mt-10">
          <Step n={1} title="Plan" by={<SponsorTag id="0g">0G sealed inference</SponsorTag>} state={steps[0]!}><PlanSection plan={view.run.plan} /></Step>
          <Step n={2} title="Quotes" by={<SponsorTag id="hedera">x402 on Hedera</SponsorTag>} state={steps[1]!}><QuotesSection quotes={view.quotes} /></Step>
          <Step n={3} title="Decisions" by={<SponsorTag id="0g">0G sealed inference</SponsorTag>} state={steps[2]!}><DecisionsSection view={view} /></Step>
          <Step n={4} title="Purchases" by={<><SponsorTag id="hedera">USDC on Hedera</SponsorTag><SponsorTag id="world">World ID step-up</SponsorTag></>} state={steps[3]!}>
            {shown.length === 0 ? <Muted>Nothing bought yet.</Muted> : (
              <div className="space-y-4">{shown.map((p) => (
                <div key={p.id} id={`purchase-${p.id}`} className="scroll-mt-24"><PurchaseCard purchase={p} view={view} onChanged={() => void load()} /></div>
              ))}</div>
            )}
          </Step>
          <Step n={5} title="Answer" by={<SponsorTag id="0g">0G, no tools</SponsorTag>} state={steps[4]!} last><AnswerSection answer={view.run.answer} /></Step>
        </ol>
      )}

      {ended && (
        <Card className="mt-12 animate-page-in">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-100">Check the receipts</h2>
              <p className="mt-1 text-sm text-zinc-400">Every purchase is in the ledger with its Hedera transaction and its 0G request.</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <a href="#/ledger" className={btn("primary")}>Open ledger <Arrow /></a>
              <a href="#/research" className={btn("ghost")}>Ask another</a>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

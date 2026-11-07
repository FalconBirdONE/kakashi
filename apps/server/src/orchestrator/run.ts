import type {
  BrainError, InferenceKind, Need, PlanOutput, PolicyResult, Quote, RunState, RunView, SynthesisOutput, Traced,
} from "@kakashi/contracts";
import { HttpError } from "../errors.js";
import type { OrchContext } from "./context.js";
import { executePurchase } from "./purchase.js";
import { ACTIVE_PURCHASE, UNRESOLVED_PURCHASE, budgetLeft, countActive } from "./util.js";

const MAX_INFERENCE_CALLS = 4;
const MAX_DECIDE_ROUNDS = 2;

class RunAbort extends Error {}

export type RunHandle = { runId: string; done: Promise<void> };

/** Creates the run synchronously, then walks the SPEC §8.3 pipeline in the background. */
export function runResearch(ctx: OrchContext, userId: string, question: string): RunHandle {
  const { trust } = ctx.deps;
  if (!trust.getActiveMandate(userId)) throw new HttpError(409, "NO_ACTIVE_MANDATE", "activate a mandate before running research");
  const run = trust.createRun(userId, question);
  ctx.runs.set(run.id, { userId, question });
  const done = ctx.track(drive(ctx, run.id, userId, question).catch((e) => {
    console.error("[orchestrator] run crashed:", e instanceof Error ? e.message : e);
    try { finish(ctx, run.id, "FAILED", "INTERNAL_ERROR"); } catch { /* run store unavailable */ }
  }));
  return { runId: run.id, done };
}

type Candidate = { quote: Quote; policy: PolicyResult };

async function drive(ctx: OrchContext, runId: string, userId: string, question: string): Promise<void> {
  const { rails, brain, trust } = ctx.deps;
  const emit = (kind: string, entityId = runId) => ctx.bus.emit({ runId, kind, entityId });
  const setState = (s: RunState) => { trust.updateRun(runId, { state: s }); emit("run.state"); };

  const mandate0 = trust.getActiveMandate(userId);
  if (!mandate0) return finish(ctx, runId, "FAILED", "MANDATE_INACTIVE");

  // Run deadline: stops new work. A payment that is already signed is never abandoned.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), mandate0.maxRunDurationSeconds * 1000);
  timer.unref();
  const aborted = new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(new RunAbort())));
  aborted.catch(() => {});
  const guard = <T,>(p: Promise<T>) => Promise.race([p, aborted]);
  const checkTime = () => { if (ac.signal.aborted) throw new RunAbort(); };

  let inferenceCalls = 0;
  const brainCall = async <T,>(kind: InferenceKind, fn: (accounting?: import("@kakashi/contracts").InferenceAccounting) => Promise<Traced<T>>):
    Promise<{ ok: true; value: T; callId: string } | { ok: false; error: BrainError }> => {
    if (inferenceCalls >= MAX_INFERENCE_CALLS) return { ok: false, error: "BUDGET_EXCEEDED" };
    inferenceCalls++;
    let r: Traced<T>;
    const recorded:string[]=[];
    const accounting: import("@kakashi/contracts").InferenceAccounting | undefined = trust.persistence ? {
      reserve: key => trust.persistence!.reserveInference(runId,key,process.env.INFERENCE_MAX_REQUEST_COST??'0.01',process.env.INFERENCE_LIMIT??'0.1'),
      record: t => {recorded.push(trust.recordInference({...t,runId,kind}).id);emit('inference',recorded.at(-1)!);},
    } : undefined;
    try {
      r = await guard(fn(accounting));
    } catch (e) {
      if (e instanceof RunAbort) throw e;
      return { ok: false, error: "ZG_UNAVAILABLE" };
    }
    let callId = recorded.at(-1) ?? "";
    if (r.trace && !recorded.length) { // only record a trace the brain actually returned; never fabricate one
      const t = r.trace;
      callId = trust.recordInference({
        runId, kind, model: t.model, trustTier: t.trustTier, zgRequestId: t.zgRequestId, provider: t.provider,
        teeVerified: t.teeVerified, totalCost: t.totalCost, latencyMs: t.latencyMs, inputHash: t.inputHash, outputHash: t.outputHash,
        ok: r.ok, ...(r.ok ? {} : { error: r.error }),
      }).id;
      emit("inference", callId);
    }
    return r.ok ? { ok: true, value: r.value, callId } : { ok: false, error: r.error };
  };

  let failure: string | undefined;
  let answer: SynthesisOutput | undefined;
  let plan: PlanOutput | undefined;
  const gaps: string[] = [];

  try {
    // ---- PLANNING ----
    setState("PLANNING");
    const allowed = new Set(mandate0.allowedMerchantIds);
    const catalog = (await guard(rails.getCatalog())).filter((c) => allowed.has(c.id));
    const preferences = trust.getPreferences(userId)?.text;
    const p = await brainCall("PLAN", accounting => brain.plan({
      accounting,
      question, preferences, catalog, budgetRemainingAtomic: budgetLeft(mandate0),
      perPaymentCapAtomic: mandate0.perPaymentCapAtomic, assetDecimals: mandate0.assetDecimals,
    }));
    if (!p.ok) return finish(ctx, runId, "FAILED", `PLAN_${p.error}`);
    const planned = (plan = p.value);
    trust.updateRun(runId, { plan: planned });
    emit("plan");

    // ---- QUOTING: every allowed merchant, concurrently (quotes are free) ----
    checkTime();
    setState("QUOTING");
    const query = { tokenId: planned.query.tokenId };
    const fetched = await guard(Promise.all(catalog.map(async (c) => {
      try { return { id: c.id, res: await rails.fetchQuote(c.id, query) }; }
      catch { return { id: c.id, res: { ok: false as const, error: "NETWORK" as const } }; }
    })));
    const candidates: Candidate[] = [];
    for (const f of fetched) {
      if (!f.res.ok) { gaps.push(`no quote from ${f.id} (${f.res.error})`); continue; }
      const quote = trust.recordQuote(runId, f.res.quote);
      const policy = trust.precheck(quote.id);
      ctx.policy.set(quote.id, policy);
      candidates.push({ quote, policy });
      emit("quote", quote.id);
    }
    // Policy-rejected quotes stay visible in the run view but are never shown to the brain.
    const eligible = candidates.filter((c) => c.policy.allowed);
    const byId = new Map(eligible.map((c) => [c.quote.id, c]));
    const catalogById = new Map(catalog.map((c) => [c.id, c]));
    const proposed = new Set<string>();

    // ---- DECIDING + PURCHASING (at most 2 rounds) ----
    for (let round = 1; round <= MAX_DECIDE_ROUNDS; round++) {
      checkTime();
      const m = trust.getActiveMandate(userId);
      const view = trust.getRunView(runId);
      const remaining = m ? m.maxPurchasesPerRun - countActive(view) : 0;
      const open = eligible.filter((c) => !proposed.has(c.quote.id));
      if (!m || remaining <= 0 || open.length === 0 || uncoveredNeeds(view, planned.needs).length === 0) break;

      setState("DECIDING");
      const dec = await brainCall("DECIDE", accounting => brain.decide({
        accounting,
        question, preferences, needs: planned.needs,
        quotes: open.map(({ quote: q }) => {
          const meta = catalogById.get(q.merchantId)!; // registry metadata plus normalized quote fields only
          return {
            quoteId: q.id, merchantId: q.merchantId, amountAtomic: q.amountAtomic, capabilities: meta.capabilities,
            coverage: meta.coverage, freshnessSeconds: meta.freshnessSeconds, referencePrice: meta.referencePriceAtomic,
          };
        }),
        alreadyBought: alreadyBought(view),
        budgetRemainingAtomic: budgetLeft(m), purchasesRemaining: remaining, round: round as 1 | 2,
      }));
      if (!dec.ok) { failure = `DECIDE_${dec.error}`; break; } // no new purchases after a brain failure

      setState("PURCHASING");
      for (const { quoteId, ...decision } of dec.value.decisions) {
        const c = byId.get(quoteId);
        if (!c || proposed.has(quoteId)) continue; // ignore anything the brain was not offered, and repeats
        checkTime();
        proposed.add(quoteId);
        const purchase = trust.proposePurchase(quoteId, { ...decision, inferenceCallId: dec.callId });
        ctx.purchases.set(purchase.id, { runId, userId });
        emit("purchase", purchase.id);
        if (decision.action === "SKIP") { trust.transition(purchase.id, "AGENT_SKIPPED"); emit("purchase", purchase.id); continue; }
        const auth = trust.authorize(purchase.id);
        emit("purchase", purchase.id);
        if (auth.kind === "PERMIT") await executePurchase(ctx, purchase.id, auth.permit);
        // NEEDS_APPROVAL: stays AWAITING_APPROVAL until /api/purchases/:id/approve. REJECTED: nothing more.
      }
      if (dec.value.stop) break;
    }
  } catch (e) {
    if (!(e instanceof RunAbort)) throw e;
    failure = "RUN_TIME_EXCEEDED";
  }

  // ---- SYNTHESIZING (skipped after a brain failure or timeout: we never fake a decision) ----
  if (!failure && plan) {
    try {
      setState("SYNTHESIZING");
      const view = trust.getRunView(runId);
      const merchantOf = (qid: string) => view.quotes.find((q) => q.id === qid)?.merchantId ?? "unknown";
      const evidence = view.purchases
        .filter((p) => ctx.evidence.has(p.id) && p.delivery !== "NOT_RECEIVED")
        .map((p) => ({
          purchaseId: p.id, merchantId: merchantOf(p.quoteId), valid: p.delivery !== "RECEIVED_INVALID",
          issues: p.deliveryIssues ?? [], data: ctx.evidence.get(p.id),
        }));
      gaps.push(...computeGaps(view, plan.needs));
      const s = await brainCall("SYNTHESIZE", accounting => brain.synthesize({
        accounting,
        question, preferences: trust.getPreferences(userId)?.text, evidence, gaps,
      }));
      if (s.ok) { answer = s.value; trust.updateRun(runId, { answer }); emit("answer"); }
      else failure = `SYNTHESIZE_${s.error}`;
    } catch (e) {
      if (!(e instanceof RunAbort)) throw e;
      failure = "RUN_TIME_EXCEEDED";
    }
  }
  clearTimeout(timer);

  // ---- final state ----
  const view = trust.getRunView(runId);
  const spentAny = view.purchases.some((p) => ACTIVE_PURCHASE.includes(p.state));
  const clean = !failure && answer !== undefined && plan !== undefined
    && !view.purchases.some((p) => UNRESOLVED_PURCHASE.includes(p.state) || p.delivery === "RECEIVED_INVALID")
    && uncoveredNeeds(view, plan.needs).length === 0;
  finish(ctx, runId, clean ? "DONE" : answer || spentAny ? "PARTIAL" : "FAILED", failure);
}

function finish(ctx: OrchContext, runId: string, state: RunState, failureReason?: string): void {
  ctx.deps.trust.updateRun(runId, { state, finishedAt: new Date().toISOString(), ...(failureReason ? { failureReason } : {}) });
  ctx.bus.emit({ runId, kind: "run.state", entityId: runId });
}

const validDelivery = (d: string) => d === "RECEIVED_VALID" || d === "RECOVERED";

function uncoveredNeeds(view: RunView, needs: Need[]): Need[] {
  return needs.filter((n) => !view.purchases.some((p) =>
    p.decision?.needId === n.needId && ACTIVE_PURCHASE.includes(p.state) && p.delivery !== "RECEIVED_INVALID"));
}

function alreadyBought(view: RunView) {
  return view.purchases.filter((p) => p.state === "CONFIRMED").map((p) => ({
    merchantId: view.quotes.find((q) => q.id === p.quoteId)?.merchantId ?? "unknown",
    needId: p.decision?.needId ?? "", valid: validDelivery(p.delivery),
  }));
}

function computeGaps(view: RunView, needs: Need[]): string[] {
  const g: string[] = [];
  for (const n of needs) {
    const ok = view.purchases.some((p) => p.decision?.needId === n.needId && p.state === "CONFIRMED" && validDelivery(p.delivery));
    if (!ok) g.push(`no valid evidence for: ${n.description}`);
  }
  for (const p of view.purchases) {
    if (p.state === "AWAITING_APPROVAL") g.push(`purchase ${p.id} is awaiting approval`);
    if (p.state === "UNKNOWN" || p.state === "SUBMITTED") g.push(`payment for ${p.id} is pending reconciliation`);
    if (p.delivery === "RECEIVED_INVALID") g.push(`data from ${p.id} failed validation: ${(p.deliveryIssues ?? []).join("; ")}`);
  }
  return g;
}

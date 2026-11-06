import {
  planOutputSchema, synthesisOutputSchema, decideOutputSchema,
} from "@tollbooth/contracts";
import type { Brain, DecideInput, DecideOutput, DecisionItem } from "@tollbooth/contracts";
import { callStructured } from "./client.js";
import type { ClientDeps } from "./client.js";
import * as planPrompt from "./prompts/plan.js";
import * as decidePrompt from "./prompts/decide.js";
import * as synthPrompt from "./prompts/synthesize.js";

export function createFunctions(env: Record<string, string | undefined> = process.env, deps: ClientDeps = {}): Brain {
  const d = { ...deps, env };
  return {
    plan: (i) => callStructured({
      kind: "PLAN", system: planPrompt.SYSTEM, user: planPrompt.buildPlanUser(i), schema: planOutputSchema(i.catalog.map((c) => c.id)), maxTokens: 600,
    }, d),

    async decide(i) {
      // The orchestrator must not call decide with nothing to decide on; fail without spending an inference call.
      const ids = i.quotes.map((q) => q.quoteId);
      if (ids.length === 0) return { ok: false, error: "SCHEMA_INVALID" };
      const r = await callStructured({
        kind: "DECIDE", system: decidePrompt.SYSTEM, user: decidePrompt.buildDecideUser(i),
        schema: decideOutputSchema(ids, i.needs.map((n) => n.needId)), maxTokens: 900,
      }, d);
      return r.ok ? { ...r, value: postCheckDecisions(i, r.value) } : r;
    },

    async synthesize(i) {
      const r = await callStructured({
        kind: "SYNTHESIZE", system: synthPrompt.SYSTEM, user: synthPrompt.buildSynthesizeUser(i),
        schema: synthesisOutputSchema(i.evidence.map((e) => e.purchaseId)), maxTokens: 900,
      }, d);
      return r; // citations are schema-restricted to the evidence purchaseIds; an unknown one fails validation and gets one repair
    },
  };
}

/** Defence in depth only; trust enforces the real limits. Pure. */
export function postCheckDecisions(i: DecideInput, out: DecideOutput): DecideOutput {
  const price = new Map(i.quotes.map((q) => [q.quoteId, BigInt(q.amountAtomic)]));
  const seen = new Set<string>();
  const decisions: DecisionItem[] = out.decisions.filter((d) => {
    if (!price.has(d.quoteId) || seen.has(d.quoteId)) return false;
    seen.add(d.quoteId);
    return true;
  });

  const buys = decisions.filter((d) => d.action === "BUY");
  const total = buys.reduce((s, d) => s + price.get(d.quoteId)!, 0n);
  const budget = BigInt(i.budgetRemainingAtomic);
  if (total <= budget && buys.length <= i.purchasesRemaining) return { decisions, stop: out.stop };

  // usefulness is scaled to an integer (1e6) so value/price comparison is exact bigint cross-multiplication.
  const u = (d: DecisionItem) => BigInt(Math.round(d.expectedUsefulness * 1e6));
  const ranked = buys
    .map((d, idx) => ({ d, idx }))
    .sort((a, b) => {
      const l = u(a.d) * price.get(b.d.quoteId)!, r = u(b.d) * price.get(a.d.quoteId)!;
      return l > r ? -1 : l < r ? 1 : a.idx - b.idx;
    });
  const kept = new Set<DecisionItem>();
  let run = 0n;
  for (const { d } of ranked) {
    const p = price.get(d.quoteId)!;
    if (kept.size < i.purchasesRemaining && run + p <= budget) { kept.add(d); run += p; }
  }
  return {
    decisions: decisions.map((d) =>
      d.action === "BUY" && !kept.has(d) ? { ...d, action: "SKIP", reasonCode: "TOO_EXPENSIVE_FOR_VALUE" } : d),
    stop: out.stop,
  };
}

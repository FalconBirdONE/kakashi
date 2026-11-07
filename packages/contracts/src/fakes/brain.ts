import type { Brain, Traced } from "../interfaces.js";
import type { BrainError } from "../errors.js";
import type { InferenceTrace } from "../entities.js";
import { canonicalJson, sha256Hex } from "../hash.js";
import { cmpA } from "../money.js";

export type FakeBrain = Brain & { failNext(error: BrainError): void };

export function createFakeBrain(): FakeBrain {
  let n = 0;
  let pendingFail: BrainError | null = null;

  const trace = (i: unknown, o: unknown): InferenceTrace => ({
    model: "fake-model", trustTier: "private", zgRequestId: `fake-${++n}`, provider: "fake-provider",
    teeVerified: true, totalCost: "0", latencyMs: 1, inputHash: sha256Hex(canonicalJson(i)), outputHash: sha256Hex(canonicalJson(o)),
  });
  const run = <I, O>(i: I, f: () => O): Traced<O> => {
    if (pendingFail) {
      const error = pendingFail; pendingFail = null;
      return { ok: false, error };
    }
    const value = f();
    return { ok: true, value, trace: trace(i, value) };
  };

  return {
    failNext: (e) => void (pendingFail = e),

    async plan(i) {
      return run(i, () => ({
        needs: [{ needId: "need-1", description: i.question.slice(0, 200) || "token risk", priority: 1 as const }],
        query: { tokenId: "0.0.731861", tradeUsd: 100 },
      }));
    },

    // Rule-based: buy the cheapest quote that fills each unmet need, within budget and purchase limits.
    async decide(i) {
      return run(i, () => {
        const sorted = [...i.quotes].sort((a, b) => cmpA(a.amountAtomic, b.amountAtomic));
        const unmet = i.needs.filter((nd) => !i.alreadyBought.some((b) => b.needId === nd.needId && b.valid));
        let left = i.budgetRemainingAtomic;
        let slots = i.purchasesRemaining;
        const bought = new Set<string>();
        const chosen = new Map<string, string>(); // quoteId -> needId
        for (const nd of unmet) {
          const q = sorted.find((x) => !chosen.has(x.quoteId) && !bought.has(x.merchantId) && cmpA(x.amountAtomic, left) <= 0);
          if (q && slots > 0) {
            chosen.set(q.quoteId, nd.needId);
            bought.add(q.merchantId);
            left = (BigInt(left) - BigInt(q.amountAtomic)).toString();
            slots--;
          }
        }
        const firstNeed = i.needs[0]?.needId ?? "need-1";
        return {
          decisions: i.quotes.map((q) => {
            const need = chosen.get(q.quoteId);
            return need
              ? { quoteId: q.quoteId, action: "BUY" as const, reasonCode: "FILLS_NEED" as const, needId: need, expectedUsefulness: 0.8, rationale: "cheapest quote that fills the need" }
              : { quoteId: q.quoteId, action: "SKIP" as const, reasonCode: "REDUNDANT" as const, needId: firstNeed, expectedUsefulness: 0.1, rationale: "not the cheapest fill" };
          }),
          stop: true,
        };
      });
    },

    // Echoes evidence; never acts on embedded text, but reports it.
    async synthesize(i) {
      return run(i, () => {
        const valid = i.evidence.filter((e) => e.valid);
        const suspicious = i.evidence
          .filter((e) => /ignore (your|all|previous)/i.test(JSON.stringify(e.data)))
          .map((e) => `instruction-like text in ${e.purchaseId}`);
        return {
          answer: valid.length ? `Based on ${valid.length} purchase(s): ${valid.map((e) => e.merchantId).join(", ")}.` : "No valid evidence was obtained.",
          confidence: valid.length ? ("medium" as const) : ("low" as const),
          citations: valid.map((e) => e.purchaseId),
          disagreements: [],
          gaps: i.gaps,
          suspiciousContent: suspicious,
        };
      });
    },
  };
}

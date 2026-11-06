import { sha256Hex } from "../hash";
import type { Brain, InferenceTrace } from "../types";

const trace = (kind: string, i: unknown, o: unknown): InferenceTrace => ({
  model: "fake-model", trustTier: "private", zgRequestId: `fake-${kind}-${sha256Hex(i).slice(0, 8)}`,
  provider: "fake", teeVerified: true, totalCost: "0", latencyMs: 1, inputHash: sha256Hex(i), outputHash: sha256Hex(o),
});

/** Deterministic: buys the cheapest eligible quote, skips the rest. */
export function createFakeBrain(): Brain {
  return {
    async plan(i) {
      const v = {
        needs: [{ needId: "n1", description: "Forecast for the question's place and dates", priority: 1 as const }],
        query: { lat: 19.07, lon: 72.87, startDate: "2026-11-07", endDate: "2026-11-13" },
      };
      return { ok: true, value: v, trace: trace("plan", i, v) };
    },
    async decide(i) {
      const sorted = [...i.quotes].sort((a, b) => Number(BigInt(a.amountAtomic) - BigInt(b.amountAtomic)));
      const v = {
        decisions: sorted.map((q, idx) => ({
          quoteId: q.quoteId, action: (idx === 0 && i.purchasesRemaining > 0 ? "BUY" : "SKIP") as "BUY" | "SKIP",
          reasonCode: (idx === 0 ? "FILLS_NEED" : "REDUNDANT") as "FILLS_NEED" | "REDUNDANT",
          needId: "n1", expectedUsefulness: idx === 0 ? 0.8 : 0.1, rationale: "fake brain: cheapest first",
        })),
        stop: true,
      };
      return { ok: true, value: v, trace: trace("decide", i, v) };
    },
    async synthesize(i) {
      const v = {
        answer: `Fake answer from ${i.evidence.length} source(s).`, confidence: "medium" as const,
        citations: i.evidence.map((e) => e.purchaseId), disagreements: [], gaps: i.gaps, suspiciousContent: [],
      };
      return { ok: true, value: v, trace: trace("synth", i, v) };
    },
  };
}

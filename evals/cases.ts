import { MERCHANT_REGISTRY, type DecideInput } from "../packages/contracts/src";

type Quote = DecideInput["quotes"][number];

/** Quotes as policy would pass them: registry merchants minus the adversarial gouger (policy rejects it before the AI sees it). */
export const quotes: Quote[] = MERCHANT_REGISTRY.filter((m) => m.demoRole === "normal").map((m) => ({
  quoteId: `qte_eval_${m.id}`, merchantId: m.id, amountAtomic: m.priceAtomic, capabilities: m.capabilities,
  coverage: m.coverage, freshnessSeconds: m.freshnessSeconds, referencePrice: m.referencePriceAtomic,
}));

export type EvalCase = {
  id: number;
  question: string;
  budgetAtomic: string;
  /** Accepted BUY merchant sets (SPEC §9.2 item 6). A run is correct if its BUY set equals any one of these. */
  accepted: string[][];
  note?: string;
};

const DEFAULT_BUDGET = "200000"; // demo mandate: 0.20 USDC

export const cases: EvalCase[] = [
  { id: 1, question: "Will it rain in Mumbai this week?", budgetAtomic: DEFAULT_BUDGET, accepted: [["quickcast"]] },
  { id: 2, question: "Is 6–8 am tomorrow good for a run in Bandra?", budgetAtomic: DEFAULT_BUDGET, accepted: [["hourlypro"]] },
  { id: 3, question: "Forecasts say dry but it looks cloudy, is it raining in Andheri right now?", budgetAtomic: DEFAULT_BUDGET,
    accepted: [["groundtruth"]] },
  { id: 4, question: "Plan an outdoor shoot Saturday 4–6 pm in Colaba", budgetAtomic: DEFAULT_BUDGET,
    accepted: [["hourlypro"], ["hourlypro", "quickcast"]], note: "HourlyPro, plus QuickCast if budget allows" },
  { id: 5, question: "Rough weekly outlook, keep it cheap", budgetAtomic: DEFAULT_BUDGET, accepted: [["quickcast"]] },
  // 20000 fits QuickCast (10000) but not HourlyPro (50000) or GroundTruth (30000).
  { id: 6, question: "Is 6–8 am tomorrow good for a run in Bandra?", budgetAtomic: "20000", accepted: [["quickcast"]],
    note: "budget only fits QuickCast; the final answer should note the gap (synthesis, not scored here)" },
];

/** Order-insensitive set equality on merchant ids. */
export const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
export const isAccepted = (buys: string[], c: EvalCase) => c.accepted.some((s) => sameSet(buys, s));

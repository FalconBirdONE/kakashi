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
  { id: 1, question: "Should I put 20 USDC into SAUCE (0.0.731861)?", budgetAtomic: DEFAULT_BUDGET, accepted: [["quickcast"]] },
  { id: 2, question: "I'm about to put 2,000 USDC into 0.0.731861. Is it safe?", budgetAtomic: DEFAULT_BUDGET,
    accepted: [["quickcast", "groundtruth", "hourlypro"]] },
  { id: 3, question: "Is the supply of DOVU (0.0.624505) concentrated in a few wallets? Planning 300 USD.", budgetAtomic: DEFAULT_BUDGET,
    accepted: [["groundtruth"], ["groundtruth", "quickcast"]] },
  { id: 4, question: "Is the team dumping GRELF (0.0.1159074)? I hold 1,000 USD of it.", budgetAtomic: DEFAULT_BUDGET,
    accepted: [["hourlypro"], ["hourlypro", "quickcast"]] },
  { id: 5, question: "Quick sanity check before a 5 USD trade of 0.0.4696266, keep it cheap", budgetAtomic: DEFAULT_BUDGET, accepted: [["quickcast"]] },
  // 20000 fits quickcast (10000) but not hourlypro (50000) or groundtruth (30000).
  { id: 6, question: "I'm about to put 5,000 USDC into 0.0.731861.", budgetAtomic: "20000", accepted: [["quickcast"]],
    note: "the budget only fits KeyScan; the final answer should note the gap (synthesis, not scored here)" },
];

/** Order-insensitive set equality on merchant ids. */
export const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
export const isAccepted = (buys: string[], c: EvalCase) => c.accepted.some((s) => sameSet(buys, s));

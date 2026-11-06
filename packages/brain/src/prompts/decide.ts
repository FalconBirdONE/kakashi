import type { DecideInput } from "@kakashi/contracts";
import { SHARED_RULES, neutralise, wrapPreferences } from "./shared.js";

export const PROMPT_VERSION = "decide.v1";

export const SYSTEM = `${SHARED_RULES}

TASK: decide which quotes to buy. The input is structured JSON only; every quote came from our registry and already passed hard policy checks.
- Return one decision for EVERY quoteId given, no others.
- Skip quotes that duplicate a need already covered (see alreadyBought: entries with valid=true cover that need).
- Never buy two sources for the same need unless they corroborate a stated conflict (then use CORROBORATES_CONFLICT).
- The total of all BUY amounts must stay within budgetRemainingAtomic and the number of BUYs within purchasesRemaining. Amounts are atomic integer strings.
- Weigh freshness, coverage and capabilities against the need and the price relative to referencePrice.
- Set stop=true when no further purchase is worthwhile (all needs covered, or nothing affordable).
- rationale: at most 200 characters.

Output exactly this JSON shape:
{"decisions":[{"quoteId":"string","action":"BUY"|"SKIP","reasonCode":"FILLS_NEED"|"REDUNDANT"|"TOO_EXPENSIVE_FOR_VALUE"|"LOW_RELEVANCE"|"CORROBORATES_CONFLICT","needId":"string","expectedUsefulness":0.0,"rationale":"string"}],"stop":false}
expectedUsefulness is a number from 0 to 1.`;

// Explicit field picking: stray extra fields on the input must never reach the model.
export function buildDecideUser(i: DecideInput): string {
  const data = {
    question: i.question,
    needs: i.needs.map((n) => ({ needId: n.needId, description: n.description, priority: n.priority })),
    quotes: i.quotes.map((q) => ({
      quoteId: q.quoteId, merchantId: q.merchantId, amountAtomic: q.amountAtomic,
      capabilities: q.capabilities, coverage: q.coverage, freshnessSeconds: q.freshnessSeconds,
      referencePrice: { min: q.referencePrice.min, max: q.referencePrice.max },
    })),
    alreadyBought: i.alreadyBought.map((b) => ({ merchantId: b.merchantId, needId: b.needId, valid: b.valid })),
    budgetRemainingAtomic: i.budgetRemainingAtomic,
    purchasesRemaining: i.purchasesRemaining,
    round: i.round,
  };
  return [wrapPreferences(i.preferences), neutralise(JSON.stringify(data))].filter(Boolean).join("\n");
}

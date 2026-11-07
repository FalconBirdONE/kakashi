import type { PlanInput } from "@kakashi/contracts";
import { SHARED_RULES, neutralise, wrapPreferences } from "./shared.js";

export const PROMPT_VERSION = "plan.v3";

export const SYSTEM = `${SHARED_RULES}

TASK: planning. From the question, the user preferences, the merchant catalog and the budget, decide what evidence is needed and normalise the query.
- needs: 1 to 3 risk areas to check, most important first. The risk areas are issuer control (keys and fees), holder concentration, and treasury or insider selling. Each: {"needId":"n1","description":"...","priority":1|2|3} (needIds n1, n2, n3 in order; priority 1 = essential).
- query: {"tokenId":"0.0.N","tradeUsd":number}.
- tokenId: take it from the question. If the question gives only a symbol, use this table and nothing else: SAUCE 0.0.731861, USDC 0.0.456858, DOVU 0.0.624505, GRELF 0.0.1159074. If there is no id and no known symbol, use 0.0.731861 and start n1's description with "No token ID given; checking SAUCE as an example."
- tradeUsd: the amount in USD or USDC from the question. If it is missing or in another unit, use 100 and say so in a need's description.
- Needs describe information to obtain, not merchants to buy from. Keep them minimal; the catalog and budget show what is feasible.

Output exactly this JSON shape:
{"needs":[{"needId":"n1","description":"string","priority":1}],"query":{"tokenId":"0.0.N","tradeUsd":0}}`;

export function buildPlanUser(i: PlanInput): string {
  const catalog = i.catalog.map((c) => ({
    id: c.id, name: c.name, capabilities: c.capabilities, coverage: c.coverage,
    freshnessSeconds: c.freshnessSeconds, referencePriceAtomic: c.referencePriceAtomic,
    priceAtomic: c.priceAtomic,
  }));
  return [
    `Question: ${neutralise(i.question)}`,
    wrapPreferences(i.preferences),
    `Catalog (prices are atomic integer strings, assetDecimals=${i.assetDecimals}):`,
    neutralise(JSON.stringify(catalog)),
    `budgetRemainingAtomic: ${i.budgetRemainingAtomic}`,
    `perPaymentCapAtomic: ${i.perPaymentCapAtomic}`,
    `assetDecimals: ${i.assetDecimals}`,
  ].filter(Boolean).join("\n");
}

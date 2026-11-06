import type { PlanInput } from "@tollbooth/contracts";
import { SHARED_RULES, neutralise, wrapPreferences } from "./shared";

export const PROMPT_VERSION = "plan.v1";

export const SYSTEM = `${SHARED_RULES}

TASK: planning. From the question, the user preferences, the merchant catalog and the budget, decide what evidence is needed and normalise the query.
- needs: 1 to 3 evidence needs, most important first. Each: {"needId":"n1","description":"...","priority":1|2|3} (needIds n1, n2, n3 in order; priority 1 = essential).
- query: {"lat":number,"lon":number,"startDate":"yyyy-mm-dd","endDate":"yyyy-mm-dd"} (ISO dates, startDate <= endDate).
- Use the city or neighbourhood named in the question. If none is named, default to Mumbai (lat 19.076, lon 72.8777) and say so in a need's description.
- Needs describe information to obtain, not merchants to buy from. Keep them minimal; the catalog and budget show what is feasible.

Output exactly this JSON shape:
{"needs":[{"needId":"n1","description":"string","priority":1}],"query":{"lat":0,"lon":0,"startDate":"yyyy-mm-dd","endDate":"yyyy-mm-dd"}}`;

export function buildPlanUser(i: PlanInput): string {
  const catalog = i.catalog.map((c) => ({
    id: c.id, name: c.name, capabilities: c.capabilities, coverage: c.coverage,
    freshnessSeconds: c.freshnessSeconds, referencePriceAtomic: c.referencePriceAtomic,
    ...(c.livePriceAtomic !== undefined ? { livePriceAtomic: c.livePriceAtomic } : {}),
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

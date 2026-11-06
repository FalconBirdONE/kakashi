// Manual end-to-end: plan -> decide -> synthesize against the real 0G Router, with sample quotes from the registry.
// Run: cd packages/brain && npx tsx --env-file-if-exists=../../.env scripts/manual.ts
// Needs ZG_API_KEY and ZG_MODEL (model chosen by scripts/spike.ts). Prints request ids only, never the key.
import { MERCHANT_REGISTRY } from "@tollbooth/contracts";
import { createBrain } from "../src";

if (!process.env.ZG_API_KEY || !process.env.ZG_MODEL) { console.error("Set ZG_API_KEY and ZG_MODEL first."); process.exit(2); }
const brain = createBrain();
const question = "Is 6-8 am tomorrow good for a run in Bandra?";
const catalog = MERCHANT_REGISTRY.map(({ payToEnv: _p, ...m }) => m);

const plan = await brain.plan({ question, catalog, budgetRemainingAtomic: "200000", perPaymentCapAtomic: "100000", assetDecimals: 6 });
if (!plan.ok) { console.error("plan failed:", plan.error); process.exit(1); }
console.log("PLAN", plan.trace.zgRequestId, plan.trace.teeVerified, JSON.stringify(plan.value.needs));

const quotes = MERCHANT_REGISTRY.map((m, n) => ({ quoteId: `qte_sample${n}`, merchantId: m.id, amountAtomic: m.priceAtomic,
  capabilities: m.capabilities, coverage: m.coverage, freshnessSeconds: m.freshnessSeconds, referencePrice: m.referencePriceAtomic }));
const dec = await brain.decide({ question, needs: plan.value.needs, quotes, alreadyBought: [], budgetRemainingAtomic: "200000", purchasesRemaining: 3, round: 1 });
if (!dec.ok) { console.error("decide failed:", dec.error); process.exit(1); }
console.log("DECIDE", dec.trace.zgRequestId, dec.trace.teeVerified, JSON.stringify(dec.value.decisions.map((d) => [d.quoteId, d.action, d.reasonCode])));

const buys = dec.value.decisions.filter((d) => d.action === "BUY");
const evidence = buys.map((d, n) => ({ purchaseId: `pur_sample${n}`, merchantId: quotes.find((q) => q.quoteId === d.quoteId)!.merchantId,
  valid: true, issues: [], data: { location: "Bandra", window: "tomorrow 06:00-08:00", note: "sample data: dry, 26C, wind 8 km/h" } }));
const syn = await brain.synthesize({ question, evidence, gaps: [] });
if (!syn.ok) { console.error("synthesize failed:", syn.error); process.exit(1); }
console.log("SYNTHESIZE", syn.trace.zgRequestId, syn.trace.teeVerified, syn.value.confidence);
console.log("\nrequest ids:", [plan, dec, syn].map((r) => r.trace.zgRequestId).join(" "));

// Eval: does 0G pick the right evidence to buy, and does it beat a "cheapest first" rule?
// Real run:  npx tsx --env-file-if-exists=.env evals/run.ts           (needs ZG_API_KEY, ZG_MODEL)
// Dry run:   EVAL_DRY=1 npx tsx evals/run.ts                          (fake brain; proves the harness only, NOT evidence)
import { MERCHANTS, createFakeBrain, type Brain } from "../packages/contracts/src";
import { createBrain } from "../packages/brain/src";
import { cases, isAccepted, quotes } from "./cases";

const dry = process.env.EVAL_DRY === "1";
if (!dry && (!process.env.ZG_API_KEY || !process.env.ZG_MODEL)) {
  console.error("Set ZG_API_KEY and ZG_MODEL (or EVAL_DRY=1 for a harness-only dry run).");
  process.exit(2);
}
const brain: Brain = dry ? createFakeBrain() : createBrain();
const catalog = MERCHANTS.map(({ payToEnv: _p, priceAtomic, ...m }) => ({ ...m, livePriceAtomic: priceAtomic }));

/** Baseline: cheapest-first, one purchase per need (it has no idea which merchant covers which need), within budget. */
function baseline(needCount: number, budget: bigint): string[] {
  const out: string[] = [];
  let spent = 0n;
  for (const q of [...quotes].sort((a, b) => Number(BigInt(a.amountAtomic) - BigInt(b.amountAtomic)))) {
    if (out.length >= needCount) break;
    if (spent + BigInt(q.amountAtomic) <= budget) { out.push(q.merchantId); spent += BigInt(q.amountAtomic); }
  }
  return out;
}

const ids: string[] = [];
let cost = 0, aiScore = 0, baseScore = 0;
const rows: string[][] = [];
const fmt = (s: string[]) => (s.length ? s.join("+") : "(none)");

for (const c of cases) {
  const budget = BigInt(c.budgetAtomic), cap = (budget < 100000n ? budget : 100000n).toString();
  let ai: string[] | string, needs = 0, baseBuys: string[] | null = null;
  const plan = await brain.plan({ question: c.question, catalog, budgetRemainingAtomic: c.budgetAtomic, perPaymentCapAtomic: cap, assetDecimals: 6 });
  if (plan.trace) { ids.push(`${c.id}:plan:${plan.trace.zgRequestId}`); cost += Number(plan.trace.totalCost) || 0; }
  if (!plan.ok) ai = `plan failed: ${plan.error}`;
  else {
    needs = plan.value.needs.length;
    baseBuys = baseline(needs, budget);
    const eligible = quotes.filter((q) => BigInt(q.amountAtomic) <= BigInt(cap));
    const dec = await brain.decide({ question: c.question, needs: plan.value.needs, quotes: eligible, alreadyBought: [],
      budgetRemainingAtomic: c.budgetAtomic, purchasesRemaining: 3, round: 1 });
    if (dec.trace) { ids.push(`${c.id}:decide:${dec.trace.zgRequestId}`); cost += Number(dec.trace.totalCost) || 0; }
    ai = dec.ok
      ? dec.value.decisions.filter((d) => d.action === "BUY").map((d) => eligible.find((q) => q.quoteId === d.quoteId)!.merchantId)
      : `decide failed: ${dec.error}`;
  }
  const aiOk = Array.isArray(ai) && isAccepted(ai, c), baseOk = baseBuys !== null && isAccepted(baseBuys, c);
  aiScore += aiOk ? 1 : 0; baseScore += baseOk ? 1 : 0;
  rows.push([String(c.id), c.question.slice(0, 44), c.accepted.map(fmt).join(" | "), Array.isArray(ai) ? fmt(ai) : ai,
    aiOk ? "PASS" : "FAIL", baseBuys ? fmt(baseBuys) : "n/a", baseOk ? "PASS" : "FAIL", String(needs)]);
}

console.log(dry ? "** DRY RUN: fake brain, harness check only, not evidence **" : `model: ${process.env.ZG_MODEL}  trust: ${process.env.ZG_TRUST_MODE ?? "private"}`);
console.log(["#", "question", "accepted", "0G buys", "0G", "baseline buys", "base", "needs"].join("\t"));
for (const r of rows) console.log(r.join("\t"));
console.log(`\n0G: ${aiScore}/${cases.length}   baseline: ${baseScore}/${cases.length}   (target: 0G >= 5/6 and > baseline)`);
console.log(`0G inference cost (billing.total_cost, summed as reported): ${cost}`);
console.log("request ids:\n  " + (ids.join("\n  ") || "(none)"));

// Real testnet end-to-end checks R1 (paid request), R4 (dropped response, recovered, paid once) and R7 (audit).
// Needs the merchants service (DEMO_MODE=true) and the signer running with the same ASSET_MODE and PERMIT_SECRET.
// Usage (from scripts/hedera): PERMIT_SECRET=<signer's secret> ./node_modules/.bin/tsx e2e.ts
import { mintPermit, newId, type Quote } from "@kakashi/contracts";
import { createRails } from "../../packages/rails/src/index.js";
import { loadEnv, mirrorGet, need } from "./env.js";

const env = loadEnv();
const secret = need(env, "PERMIT_SECRET");
const rails = createRails(env as NodeJS.ProcessEnv, { log: (m) => console.log(`  [rails] ${m}`) });
const merchantsUrl = env.MERCHANTS_URL ?? "http://127.0.0.1:4200";
const hashscan = (tx: string) => `https://hashscan.io/testnet/transaction/${tx}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { id: string; ok: boolean; detail: string }[] = [];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function until<T>(what: string, fn: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v !== null) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(2_000);
  }
}

// A unique query per run, so the merchant's 10-minute idempotency cache never answers for an earlier run.
const query = (tag: string) => ({ tokenId: "0.0.731861", run: `${tag}-${Date.now()}` });

async function quoteAndSign(merchantId: string, q: Record<string, string>) {
  const res = await rails.fetchQuote(merchantId, q);
  assert(res.ok, `fetchQuote failed: ${!res.ok && res.error}`);
  const quote = { ...res.quote, id: newId("qte_"), runId: newId("run_") } as Quote;
  const issued = new Date();
  const permit = mintPermit({
    permitId: newId("pmt_"), purchaseId: newId("pur_"), mandateId: newId("mdt_"), mandateVersion: 1,
    network: quote.network, assetId: quote.assetId, amountAtomic: quote.amountAtomic, payTo: quote.payTo,
    feePayer: quote.feePayer, quoteHash: quote.quoteHash,
    issuedAt: new Date(issued.getTime() - 1000).toISOString(), expiresAt: new Date(issued.getTime() + 60_000).toISOString(),
  }, secret);
  const signed = await rails.signPayment(permit, quote.rawRequirements);
  assert(signed.ok, `signPayment failed: ${!signed.ok && signed.error}`);
  return { quote, signed };
}

const settled = (quote: Quote, tx: string) =>
  until(`mirror SUCCESS for ${tx}`, async () => {
    const r = await rails.checkSettlement(tx, { payTo: quote.payTo, assetId: quote.assetId, amountAtomic: quote.amountAtomic });
    assert(r !== "FAILED" && r !== "MISMATCH", `mirror says ${r} for ${tx}`);
    return r === "SUCCESS" ? r : null;
  });

async function run(id: string, fn: () => Promise<string>) {
  console.log(`\n${id}`);
  try {
    const detail = await fn();
    results.push({ id, ok: true, detail });
    console.log(`  PASS ${detail}`);
  } catch (err) {
    results.push({ id, ok: false, detail: (err as Error).message });
    console.log(`  FAIL ${(err as Error).message}`);
  }
}

await run("R1 paid request to quickcast", async () => {
  const catalog = await rails.getCatalog();
  assert(catalog.some((c) => c.id === "quickcast"), "quickcast missing from /catalog");
  const q = query("r1");
  const { quote, signed } = await quoteAndSign("quickcast", q);
  console.log(`  quoted ${quote.amountAtomic} of ${quote.assetId} to ${quote.payTo}; signed ${signed.hederaTxId}`);
  const paid = await rails.submitPaidRequest(quote, signed.paymentHeader);
  assert(paid.outcome === "SETTLED", `outcome ${paid.outcome} (${paid.error ?? ""})`);
  assert(paid.settlement?.transaction === signed.hederaTxId, `PAYMENT-RESPONSE tx ${paid.settlement?.transaction} != signer tx ${signed.hederaTxId}`);
  const v = rails.validateDelivery("quickcast", q, paid.body);
  assert(v.valid, `delivery invalid: ${v.issues.join("; ")}`);
  await settled(quote, signed.hederaTxId);
  return `${signed.hederaTxId} ${hashscan(signed.hederaTxId)}`;
});

await run("R4 DROP_AFTER_SETTLE: one settlement, recovered without a new 402", async () => {
  const setFault = (fault: string) => fetch(`${merchantsUrl}/admin/fault`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merchantId: "quickcast", fault }),
  });
  const f = await setFault("DROP_AFTER_SETTLE");
  assert(f.ok, `could not set fault (HTTP ${f.status}); is DEMO_MODE=true on the merchants service?`);
  type Txs = { transactions: { consensus_timestamp: string; result: string; transfers: { account: string; amount: number }[]; token_transfers: { account: string; amount: number }[] }[] };
  const payTo = need(env, "MERCHANT_QUICKCAST_PAYTO");
  // Baseline: the newest transaction already on the mirror for quickcast (R1 waited for its own to appear).
  const latest = await mirrorGet<Txs>(env, `/api/v1/transactions?account.id=${payTo}&order=desc&limit=1`);
  const baseline = latest?.transactions[0]?.consensus_timestamp ?? "0";
  try {
    const q = query("r4");
    const { quote, signed } = await quoteAndSign("quickcast", q);
    const paid = await rails.submitPaidRequest(quote, signed.paymentHeader);
    assert(paid.outcome === "NO_RESPONSE", `expected NO_RESPONSE, got ${paid.outcome}`);
    console.log(`  no response as expected; reconciling ${signed.hederaTxId}`);
    await settled(quote, signed.hederaTxId);
    const rec = await rails.recoverDelivery("quickcast", signed.hederaTxId, quote.requestHash);
    assert(rec.ok, "recoverDelivery failed");
    const v = rails.validateDelivery("quickcast", q, rec.body);
    assert(v.valid, `recovered delivery invalid: ${v.issues.join("; ")}`);
    // Exactly one credit to quickcast after the baseline.
    const credits = await until("mirror transaction list", async () => {
      const list = await mirrorGet<Txs>(env, `/api/v1/transactions?account.id=${quote.payTo}&timestamp=gt:${baseline}&order=asc&limit=25`);
      const c = (list?.transactions ?? []).filter((t) => t.result === "SUCCESS" &&
        [...t.transfers, ...(t.token_transfers ?? [])].some((x) => x.account === quote.payTo && x.amount > 0));
      return c.length > 0 ? c : null;
    });
    assert(credits.length === 1, `expected exactly 1 credit to ${quote.payTo}, found ${credits.length}`);
    return `${signed.hederaTxId} (1 credit on mirror) ${hashscan(signed.hederaTxId)}`;
  } finally {
    await setFault("NONE");
  }
});

await run("R7 audit publish to HCS", async () => {
  const json = JSON.stringify({ v: 1, type: "RUN_COMPLETED", id: newId("evt_"), run: newId("run_"), ts: new Date().toISOString(), prev: "e2e" });
  const r = await rails.publishAudit({ id: "e2e", json });
  console.log(`  topic ${r.topicId} sequence ${r.sequenceNumber} at ${r.consensusTimestamp}`);
  const msg = await until("topic message on mirror", () =>
    mirrorGet<{ message: string; sequence_number: number }>(env, `/api/v1/topics/${r.topicId}/messages/${r.sequenceNumber}`));
  assert(Buffer.from(msg.message, "base64").toString("utf8") === json, "mirror message differs from what was published");
  return `topic ${r.topicId} seq ${r.sequenceNumber} https://hashscan.io/testnet/topic/${r.topicId}`;
});

console.log("\nSummary");
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.id}: ${r.detail}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

// Manual end-to-end World run through trust: activate a mandate, then approve one over-cap purchase and receive its permit.
// Run: cd packages/trust && npx tsx --env-file-if-exists=../../.env scripts/world-manual.ts
// Needs WORLD_CLIENT_ID and WORLD_CLIENT_SECRET (WORLD_ISSUER defaults inside trust). Uses a scratch DB in the OS temp dir.
// Never prints: sub, tokens, device codes, secrets, permit mac. Mandate/purchase ids are scratch-only and fine.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { MERCHANT_REGISTRY, requestHash, type AuthAttemptPublic, type AuthPurpose, type Trust } from "@tollbooth/contracts";

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(...a);
const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!process.env.WORLD_CLIENT_ID || !process.env.WORLD_CLIENT_SECRET) {
  console.error("WORLD_CLIENT_ID / WORLD_CLIENT_SECRET not set (register a client at https://auth.world.org/portal). Nothing started.");
  process.exit(2);
}

// Scratch DB always: never touch ./data, even if .env sets DB_PATH.
const env: Record<string, string | undefined> = { ...process.env, DB_PATH: join(mkdtempSync(join(tmpdir(), "tollbooth-world-manual-")), "manual.sqlite") };
log("scratch DB:", env.DB_PATH);
const fill = (k: string, v: string) => { if (!env[k]) { env[k] = v; log(`placeholder: ${k} not set, using a scratch value`); } };
fill("PERMIT_SECRET", randomBytes(32).toString("hex"));
fill("AGENT_ACCOUNT_ID", "0.0.2000");
MERCHANT_REGISTRY.forEach((m, i) => fill(m.payToEnv, `0.0.${3001 + i}`));

const USER = "usr_manual";
// Imported after the credential check so a missing-credential run never loads trust or touches the network.
const { createTrust, createCtx } = await import("../src/index");
const ctx = createCtx(env); // kept only to read acr/amr/auth_time for NOTES.md (not on AuthAttemptPublic)
const trust: Trust = createTrust(env, { ctx });

/** Polls every 2 s (trust paces the real World calls) until the attempt leaves PENDING. */
async function runAuth(purpose: AuthPurpose, targetId: string): Promise<AuthAttemptPublic> {
  let a = await trust.startAuth(USER, purpose, targetId);
  log(`\n[${purpose}] attempt ${a.id} expires ${a.expiresAt}`);
  log("  open:", a.verificationUri);
  log("  code:", a.userCode);
  log("  approve in World (or deny/cancel/wait to observe a failure)...");
  while (a.result === "PENDING") {
    if (Date.now() > Date.parse(a.expiresAt) + 30_000) { log("  local timeout: still PENDING 30 s after expiry"); break; }
    await sleep(2000);
    a = await trust.pollAuth(a.id);
  }
  log(`  result: ${a.result} after ${elapsed()}`);
  const c = ctx.db.prepare("SELECT acr, amr, auth_time FROM auth_attempts WHERE id = ?").get(a.id) as Record<string, unknown> | undefined;
  log(`  acr: ${c?.acr ?? "-"}  amr: ${c?.amr ?? "-"}  auth_time: ${c?.auth_time ?? "-"}`);
  return a;
}

const ledger = () => {
  const l = trust.getLedgerView(USER);
  log(`ledger: limit ${l.limitAtomic} spent ${l.spentAtomic} reserved ${l.reservedAtomic} available ${l.availableAtomic}`);
};

// 1. Mandate activation (SPEC §10 demo defaults, 30 min expiry).
const draft = trust.createMandateDraft(USER, {
  totalBudgetAtomic: "200000", perPaymentCapAtomic: "100000", autoApproveCapAtomic: "20000",
  allowedMerchantIds: MERCHANT_REGISTRY.map((m) => m.id), maxPurchasesPerRun: 3,
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
});
log(`mandate ${draft.id} v${draft.version} draft, short code ${draft.mandateHash.slice(0, 6)}`);
const act = await runAuth("ACTIVATE_MANDATE", draft.id);
const active = trust.getActiveMandate(USER);
log("active mandate:", active ? `${active.id} v${active.version} ${active.state}` : "none (protected action did not happen)");
if (act.result !== "VERIFIED" || !active) process.exit(1);
log(`TIME TO FIRST SUCCESS (activation): ${elapsed()}`);

// 2. One over-cap purchase (50000 > 20000 auto-approve cap) needing step-up approval.
const run = trust.createRun(USER, "Manual World approval test");
const path = MERCHANT_REGISTRY.find((m) => m.id === "hourlypro")!.path;
const now = Date.now();
const quote = trust.recordQuote(run.id, {
  merchantId: "hourlypro", method: "GET", origin: env.MERCHANTS_URL ?? "http://127.0.0.1:4200", path,
  requestHash: requestHash("GET", path, { location: "mumbai" }),
  network: "hedera:testnet", assetId: env.USDC_TOKEN_ID ?? "0.0.429274", amountAtomic: "50000",
  payTo: env.MERCHANT_HOURLYPRO_PAYTO!, facilitatorUrl: env.FACILITATOR_URL ?? "https://x402.org/facilitator",
  feePayer: env.FACILITATOR_FEEPAYER ?? "0.0.9185802", maxTimeoutSeconds: 60,
  rawRequirements: Buffer.from("{}").toString("base64"), quoteHash: "computed-by-trust",
  // Checked at authorize only; after NEEDS_APPROVAL the human has the 5 min approval window.
  receivedAt: new Date(now).toISOString(), localExpiresAt: new Date(now + 60_000).toISOString(),
});
const purchase = trust.proposePurchase(quote.id, {
  action: "BUY", reasonCode: "FILLS_NEED", needId: "need_manual", expectedUsefulness: 0.9, rationale: "manual World test",
});
const auth = trust.authorize(purchase.id);
log(`\npurchase ${purchase.id}: authorize -> ${auth.kind}${auth.kind === "REJECTED" ? ` ${auth.reasons.join(",")}` : ""}`);
ledger();
if (auth.kind !== "NEEDS_APPROVAL") { console.error("expected NEEDS_APPROVAL (amount above auto-approve cap)"); process.exit(1); }

const appr = await runAuth("APPROVE_PURCHASE", purchase.id);
const permit = appr.result === "VERIFIED" ? trust.getPermitForPurchase(purchase.id) : null;
if (!permit) {
  const p = trust.getRunView(run.id).purchases.find((x) => x.id === purchase.id);
  log(`no permit; purchase state ${p?.state} (no payment can be signed)`);
  ledger();
  process.exit(1);
}
const { mac: _mac, ...fields } = permit;
log("permit (mac omitted):", fields);
log("second getPermitForPurchase (expect null):", trust.getPermitForPurchase(purchase.id));
ledger();
log(`TIME TO SUCCESS (purchase approval + permit): ${elapsed()}`);

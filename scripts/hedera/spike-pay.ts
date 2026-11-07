// Spike S1 client: pays one x402 request as AGENT and prints every artifact needed for docs/rails/COMPAT.md.
// Usage: tsx spike-pay.ts [url]   (default http://127.0.0.1:4200/m/quickcast/keys?tokenId=0.0.731861)
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { createClientHederaSigner, inspectHederaTransaction } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { SIGNER_ENV_PATH, parseKey, readEnvFile } from "./env.js";

const url = process.argv[2] ?? "http://127.0.0.1:4200/m/quickcast/keys?tokenId=0.0.731861";
const signerEnv = readEnvFile(SIGNER_ENV_PATH);
const agentId = signerEnv.AGENT_ACCOUNT_ID;
const agentKey = signerEnv.AGENT_PRIVATE_KEY;
if (!agentId || !agentKey) throw new Error("apps/signer/.env.local is missing AGENT_ACCOUNT_ID or AGENT_PRIVATE_KEY");

const signer = createClientHederaSigner(agentId, parseKey(agentKey), { network: "hedera:testnet" });
// HBAR is not a default x402 asset, so opt it in explicitly with a 1 HBAR atomic cap. USDC keeps the default $1 cap.
const core = x402Client.fromConfig({
  schemes: [{ network: "hedera:*", client: new ExactHederaScheme(signer) }],
  spendControls: { allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0", maxAmountPerPayment: "100000000" }] },
});
const http = new x402HTTPClient(core);

const first = await fetch(url, { redirect: "error" });
if (first.status !== 402) throw new Error(`expected 402, got ${first.status}`);
const paymentRequired = http.getPaymentRequiredResponse((h) => first.headers.get(h), await first.json());
console.log("PAYMENT-REQUIRED (decoded):\n" + JSON.stringify(paymentRequired, null, 2));

const payload = await http.createPaymentPayload(paymentRequired);
const txB64 = String(payload.payload.transaction);
const inspected = inspectHederaTransaction(txB64);
console.log("\nSigned transaction, before submission:");
console.log(JSON.stringify({ ...inspected, accepted: payload.accepted }, null, 2));

const paid = await fetch(url, { headers: http.encodePaymentSignatureHeader(payload), redirect: "error" });
console.log(`\nRetry status: ${paid.status}`);
console.log("Body:", JSON.stringify(await paid.json()));
if (!paid.headers.get("PAYMENT-RESPONSE")) throw new Error("no PAYMENT-RESPONSE header: payment did not settle");
const settle = http.getPaymentSettleResponse((h) => paid.headers.get(h));
console.log("\nPAYMENT-RESPONSE (decoded):\n" + JSON.stringify(settle, null, 2));
console.log(`\nTransaction ID known before submission matches settlement: ${settle.transaction === inspected.transactionId}`);
console.log(`HashScan: https://hashscan.io/testnet/transaction/${settle.transaction}`);

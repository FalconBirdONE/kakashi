// Spike S1 (SPEC §9.1): one paid route with manual verify-then-settle. Replaced by the real service in prompt 1.3.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import express from "express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { ExactHederaScheme } from "@x402/hedera/exact/server";

const root = resolve(import.meta.dirname, "../../..");
const env: Record<string, string> = {};
for (const f of [".env", ".env.generated"]) {
  const p = resolve(root, f);
  if (existsSync(p)) for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) if (v) env[k] = v;
}
for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;

const network = "hedera:testnet";
const asset = (env.ASSET_MODE ?? "usdc") === "hbar" ? "0.0.0" : (env.USDC_TOKEN_ID ?? "0.0.429274");
const payTo = env.MERCHANT_QUICKCAST_PAYTO;
if (!payTo) throw new Error("MERCHANT_QUICKCAST_PAYTO is not set (run scripts/hedera setup)");

const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: env.FACILITATOR_URL ?? "https://x402.org/facilitator" }),
).register("hedera:*", new ExactHederaScheme());
await resourceServer.initialize();

const requirements = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network,
  payTo,
  price: { asset, amount: "10000" },
  maxTimeoutSeconds: 60,
});

const app = express();
app.get("/m/quickcast/forecast", async (req, res) => {
  const resource = { url: `http://${req.headers.host}${req.originalUrl}`, mimeType: "application/json" };
  const header = req.header("PAYMENT-SIGNATURE");
  if (!header) {
    const pr = await resourceServer.createPaymentRequiredResponse(requirements, resource);
    res.status(402).set("PAYMENT-REQUIRED", encodePaymentRequiredHeader(pr)).json({});
    return;
  }
  const payload = decodePaymentSignatureHeader(header);
  const matched = resourceServer.findMatchingRequirements(requirements, payload);
  if (!matched) {
    res.status(402).json({ error: "no matching requirements" });
    return;
  }
  const verify = await resourceServer.verifyPayment(payload, matched);
  if (!verify.isValid) {
    console.log("verify failed:", verify.invalidReason, verify.invalidMessage);
    res.status(402).json({ error: verify.invalidReason });
    return;
  }
  const body = { merchant: "quickcast", spike: true, generatedAt: new Date().toISOString() };
  const settle = await resourceServer.settlePayment(payload, matched);
  if (!settle.success) {
    console.log("settle failed:", settle.errorReason, settle.errorMessage);
    res.status(402).json({ error: settle.errorReason });
    return;
  }
  console.log(`settled ${settle.transaction} payer ${settle.payer}`);
  res.set("PAYMENT-RESPONSE", encodePaymentResponseHeader(settle)).json(body);
});

const port = Number(env.MERCHANTS_PORT ?? 4200);
app.listen(port, "127.0.0.1", () => console.log(`spike merchant on http://127.0.0.1:${port} asset ${asset} payTo ${payTo}`));

import { MERCHANT_REGISTRY, addA, cmpA, getMerchant } from "@kakashi/contracts";
import type { Mandate, PolicyReason, PolicyResult, Quote } from "@kakashi/contracts";

// SPEC §11.1. Pure: no DB, no clock, no env. Money only via addA/cmpA.

export type RunStats = { runMandateVersion: number; runStartedAt: string; purchasesCounted: number; duplicateRequest: boolean };
export type PolicyConfig = { payTo: Record<string, string | undefined>; network: string; assetId: string; feePayer: string };

export function policyConfigFromEnv(env: Record<string, string | undefined>): PolicyConfig {
  const payTo: Record<string, string | undefined> = {};
  for (const m of MERCHANT_REGISTRY) payTo[m.id] = env[m.payToEnv];
  return {
    payTo,
    network: env.HEDERA_NETWORK ?? "hedera:testnet",
    assetId: env.ASSET_MODE?.toLowerCase() === "hbar" ? "0.0.0" : (env.USDC_TOKEN_ID ?? "0.0.429274"),
    feePayer: env.FACILITATOR_FEEPAYER ?? "0.0.9185802",
  };
}

/** Collects every failing reason in rule order; each reason can be pushed at most once, so no de-dup pass is needed. */
export function evaluate(
  quote: Pick<Quote, "merchantId" | "network" | "assetId" | "amountAtomic" | "payTo" | "feePayer" | "localExpiresAt">,
  mandate: Mandate, run: RunStats, now: Date, config: PolicyConfig,
): PolicyResult {
  const reasons: PolicyReason[] = [];
  const fail = (bad: boolean, r: PolicyReason): void => { if (bad) reasons.push(r); };
  const t = now.getTime();
  const amt = quote.amountAtomic;

  // 1. `!(x > t)` so an unparseable expiresAt (NaN) fails closed.
  if (mandate.state === "EXPIRED" || !(Date.parse(mandate.expiresAt) > t)) reasons.push("MANDATE_EXPIRED");
  else fail(!(Date.parse(mandate.validFrom) <= t) || mandate.state !== "ACTIVE" || mandate.revokedAt != null || mandate.version !== run.runMandateVersion, "MANDATE_INACTIVE");

  // 2.
  const merchant = getMerchant(quote.merchantId);
  fail(!mandate.allowedMerchantIds.includes(quote.merchantId) || !merchant, "MERCHANT_NOT_ALLOWED");

  // 3. Missing or empty configured payTo fails closed.
  const payTo = config.payTo[quote.merchantId];
  fail(!payTo || quote.payTo !== payTo, "RECIPIENT_MISMATCH");

  // 4–5.
  fail(quote.network !== mandate.network || quote.network !== config.network, "NETWORK_MISMATCH");
  fail(quote.assetId !== mandate.assetId || quote.assetId !== config.assetId, "ASSET_MISMATCH");
  fail(quote.feePayer !== config.feePayer, "FEEPAYER_NOT_ALLOWED");

  // 6–7.
  fail(cmpA(amt, mandate.perPaymentCapAtomic) > 0, "OVER_PER_PAYMENT_CAP");
  fail(cmpA(addA(addA(mandate.spentAtomic, mandate.reservedAtomic), amt), mandate.totalBudgetAtomic) > 0, "OVER_BUDGET");

  // 8. NaN runStartedAt fails closed (comparison is false).
  fail(run.purchasesCounted >= mandate.maxPurchasesPerRun, "MAX_PURCHASES_REACHED");
  fail(!(t >= Date.parse(run.runStartedAt) && t - Date.parse(run.runStartedAt) <= mandate.maxRunDurationSeconds * 1000), "RUN_TIME_EXCEEDED");

  // 9. 0.5*min <= amt <= 1.5*max, as 2*amt >= min and 2*amt <= 3*max. Unknown merchant already failed rule 2.
  if (merchant) {
    const { min, max } = merchant.referencePriceAtomic;
    const twice = addA(amt, amt);
    fail(cmpA(twice, min) < 0 || cmpA(twice, addA(addA(max, max), max)) > 0, "PRICE_ANOMALY");
  }

  // 10–11.
  fail(!(t < Date.parse(quote.localExpiresAt)), "QUOTE_EXPIRED");
  fail(run.duplicateRequest, "DUPLICATE_REQUEST");

  // 12. Always computed, even when rejected.
  const needsApproval = cmpA(amt, mandate.autoApproveCapAtomic) > 0;
  return { allowed: reasons.length === 0, reasons, needsApproval };
}

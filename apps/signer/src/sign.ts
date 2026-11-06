import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { PrivateKey, createClientHederaSigner, inspectHederaTransaction } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { verifyPermit, type SigningPermit } from "@tollbooth/contracts";
import type { PermitStore } from "./store.js";

export type RefusalReason =
  | "BAD_MAC" | "EXPIRED" | "NOT_YET_VALID" | "PERMIT_REUSED" | "BAD_REQUIREMENTS"
  | "NETWORK_MISMATCH" | "ASSET_MISMATCH" | "AMOUNT_MISMATCH" | "PAYTO_MISMATCH" | "FEEPAYER_MISMATCH"
  | "OVER_PER_TX_CEILING" | "OVER_TOTAL_CEILING" | "SIGNED_TX_MISMATCH" | "SIGNING_FAILED";

export type SignResult =
  | { ok: true; paymentHeader: string; hederaTxId: string }
  | { ok: false; error: "SIGNER_REFUSED"; reason: RefusalReason };

/** Builds the PAYMENT-SIGNATURE header value and returns the signed transaction bytes it carries. */
export type PaymentBuilder = (requirement: PaymentRequirements, paymentRequired: PaymentRequired) =>
  Promise<{ paymentHeader: string; transactionB64: string }>;

export function hederaPaymentBuilder(accountId: string, key: PrivateKey, network: string): PaymentBuilder {
  // spendControls off: the permit match and the signer ceilings are the spending controls here.
  const http = new x402HTTPClient(
    x402Client.fromConfig({
      schemes: [{ network: "hedera:*", client: new ExactHederaScheme(createClientHederaSigner(accountId, key, { network })) }],
      spendControls: false,
    }),
  );
  return async (requirement, paymentRequired) => {
    const payload = await http.createPaymentPayload({ ...paymentRequired, accepts: [requirement] });
    const headers = http.encodePaymentSignatureHeader(payload);
    const paymentHeader = headers["PAYMENT-SIGNATURE"];
    if (!paymentHeader) throw new Error("SDK did not produce a PAYMENT-SIGNATURE header");
    return { paymentHeader, transactionB64: String(payload.payload.transaction) };
  };

}

export type SignerDeps = {
  permitSecret: string;
  agentAccountId: string;
  network: string;
  maxPerTx: bigint;
  maxTotal: bigint;
  store: PermitStore;
  build: PaymentBuilder;
  now?: () => Date;
};

export function createSigner(d: SignerDeps) {
  const now = d.now ?? (() => new Date());
  const refuse = (reason: RefusalReason): SignResult => ({ ok: false, error: "SIGNER_REFUSED", reason });

  function matchRequirement(permit: SigningPermit, requirementsB64: string):
    { requirement: PaymentRequirements; paymentRequired: PaymentRequired } | RefusalReason {
    let pr: PaymentRequired;
    try {
      pr = decodePaymentRequiredHeader(requirementsB64);
    } catch {
      return "BAD_REQUIREMENTS";
    }
    if (!Array.isArray(pr.accepts)) return "BAD_REQUIREMENTS";
    if (permit.network !== d.network) return "NETWORK_MISMATCH";
    const exact = pr.accepts.filter((a) => a.scheme === "exact");
    if (!exact.some((a) => a.network === permit.network)) return "NETWORK_MISMATCH";
    const r = exact.find((a) => a.network === permit.network && a.asset === permit.assetId);
    if (!r) return "ASSET_MISMATCH";
    if (r.amount !== permit.amountAtomic) return "AMOUNT_MISMATCH";
    if (r.payTo !== permit.payTo) return "PAYTO_MISMATCH";
    if (r.extra?.feePayer !== permit.feePayer) return "FEEPAYER_MISMATCH";
    return { requirement: r, paymentRequired: pr };
  }

  /** The bytes must move exactly amount of asset from the agent to payTo, with the fee payer as tx account. */
  function signedMatches(permit: SigningPermit, transactionB64: string): string | null {
    const tx = inspectHederaTransaction(transactionB64);
    const moves = permit.assetId === "0.0.0" ? tx.hbarTransfers : (tx.tokenTransfers[permit.assetId] ?? []);
    const otherAssets = permit.assetId === "0.0.0"
      ? Object.keys(tx.tokenTransfers).length
      : tx.hbarTransfers.length + Object.keys(tx.tokenTransfers).length - 1;
    const net = (acct: string) => moves.filter((m) => m.accountId === acct).reduce((s, m) => s + BigInt(m.amount), 0n);
    const amount = BigInt(permit.amountAtomic);
    const ok = !tx.hasNonTransferOperations && otherAssets === 0 && moves.length === 2
      && net(d.agentAccountId) === -amount && net(permit.payTo) === amount
      && tx.transactionIdAccountId === permit.feePayer;
    return ok ? tx.transactionId : null;
  }

  const sign = async function sign(permit: SigningPermit, requirementsB64: string): Promise<SignResult> {
    const v = verifyPermit(permit, d.permitSecret, now());
    if (!v.ok) return refuse(v.reason);

    const matched = matchRequirement(permit, requirementsB64);
    let refusal: RefusalReason | null = typeof matched === "string" ? matched : null;
    if (!refusal && BigInt(permit.amountAtomic) > d.maxPerTx) refusal = "OVER_PER_TX_CEILING";

    // Burns the permit even when refusing, so a refused permit can never be retried.
    const final = d.store.claim({
      permitId: permit.permitId, purchaseId: permit.purchaseId, amountAtomic: permit.amountAtomic,
      refusal, maxTotal: d.maxTotal, at: now().toISOString(),
    }) as RefusalReason | null;
    if (final || typeof matched === "string") return refuse(final ?? (matched as RefusalReason));

    try {
      const { paymentHeader, transactionB64 } = await d.build(matched.requirement, matched.paymentRequired);
      const hederaTxId = signedMatches(permit, transactionB64);
      if (!hederaTxId) {
        d.store.markFailed(permit.permitId);
        return refuse("SIGNED_TX_MISMATCH");
      }
      if(!verifyPermit(permit,d.permitSecret,now()).ok){d.store.markFailed(permit.permitId);return refuse('EXPIRED');}
      d.store.markSigned(permit.permitId, hederaTxId, paymentHeader);
      return { ok: true, paymentHeader, hederaTxId };
    } catch {
      d.store.markFailed(permit.permitId);
      return refuse("SIGNING_FAILED");
    }
  };
  return Object.assign(sign,{status:(permit:SigningPermit): import('@tollbooth/contracts').SignerStatus => {
    // A valid MAC authorizes status recovery even after signing authority expires.
    if(!verifyPermit(permit,d.permitSecret,new Date(permit.issuedAt)).ok)return {state:'UNAVAILABLE'};
    try{return d.store.status(permit.permitId);}catch{return {state:'UNAVAILABLE'};}
  }});
}

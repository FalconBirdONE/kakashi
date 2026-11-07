import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { Client, PrivateKey, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { z } from "zod";
import {
  canonicalJson, getMerchant, railsEnv, requestHash, sha256Hex,
  type CatalogEntry, type Quote, type Rails, type RailsError, type SettlementInfo,
} from "@kakashi/contracts";
import { checkSettlement } from "./settlement.js";
import { validateDelivery } from "./validate.js";

export { checkSettlement, toMirrorTxId } from "./settlement.js";
export { validateDelivery } from "./validate.js";

export const AUDIT_MAX_BYTES = 1024;
const QUOTE_TIMEOUT_MS = 10_000;
const PAID_TIMEOUT_MS = 15_000;
const SIGNER_TIMEOUT_MS = 10_000;

export type RailsDeps = {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Override HCS submission (tests). Default: TopicMessageSubmitTransaction with the operator key. */
  submitAudit?: (message: string) => Promise<{ topicId: string; sequenceNumber: number; consensusTimestamp: string }>;
  log?: (msg: string) => void;
};

const catalogSchema = z.array(z.object({
  id: z.string(), name: z.string(), path: z.string(), capabilities: z.array(z.string()), coverage: z.string(),
  freshnessSeconds: z.number(), responseSchemaId: z.string(),
  referencePriceAtomic: z.object({ min: z.string().regex(/^\d+$/), max: z.string().regex(/^\d+$/) }),
  priceAtomic: z.string().regex(/^\d+$/), demoRole: z.enum(["normal", "adversarial"]),
}));

const acct = /^\d+\.\d+\.\d+$/;
const signerOk = z.object({ paymentHeader: z.string().min(1), hederaTxId: z.string().regex(/^\d+\.\d+\.\d+@\d+\.\d+$/) });

function parseKey(text: string): PrivateKey {
  return text.startsWith("302") ? PrivateKey.fromStringDer(text) : PrivateKey.fromStringECDSA(text);
}

export function createRails(env: NodeJS.ProcessEnv, deps: RailsDeps = {}): Rails {
  const e = railsEnv.parse(env);
  const fetchFn = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.log(`[rails] ${m}`));
  const assetId = e.ASSET_MODE === "hbar" ? "0.0.0" : e.USDC_TOKEN_ID;
  const origin = new URL(e.MERCHANTS_URL).origin;
  // Quotes carry only requestHash, so remember each query to repeat the exact request when paying.
  // shortcut: in-memory, lost on restart; quotes expire within 60 s, and recovery needs only the hash.
  const queries = new Map<string, Record<string, string>>();

  const urlFor = (path: string, query: Record<string, string>) => {
    const url = new URL(path, origin);
    for (const k of Object.keys(query).sort()) url.searchParams.set(k, query[k]!);
    return url;
  };

  let hcs: Client | undefined;
  const submitAudit = deps.submitAudit ?? (async (message: string) => {
    hcs ??= Client.forTestnet().setOperator(e.HEDERA_OPERATOR_ID, parseKey(e.HEDERA_OPERATOR_KEY));
    const resp = await new TopicMessageSubmitTransaction().setTopicId(e.HCS_TOPIC_ID).setMessage(message).execute(hcs);
    const record = await resp.getRecord(hcs);
    const seq = record.receipt.topicSequenceNumber;
    if (seq == null) throw new Error("HCS receipt has no sequence number");
    return { topicId: e.HCS_TOPIC_ID, sequenceNumber: Number(seq.toString()), consensusTimestamp: record.consensusTimestamp.toString() };
  });

  return {
    restoreRequest(quote,query) {
      const m=getMerchant(quote.merchantId);
      if(!m || quote.origin!==origin || quote.path!==m.path || requestHash(quote.method,quote.path,query)!==quote.requestHash)throw new Error('REQUEST_HASH_MISMATCH');
      queries.set(quote.requestHash,query);
    },
    async signerStatus(permit) {
      try {
        const res=await fetchFn(new URL('/status',e.SIGNER_URL),{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify({permit}),signal:AbortSignal.timeout(SIGNER_TIMEOUT_MS)});
        if(!res.ok)return {state:'UNAVAILABLE'};
        const b=await res.json();
        if(b.state==='SIGNED'){const r=signerOk.safeParse(b);return r.success?{state:'SIGNED',...r.data}:{state:'UNAVAILABLE'};}
        return ['NOT_FOUND','SIGNING','FAILED','REFUSED'].includes(b.state)?{state:b.state}:{state:'UNAVAILABLE'};
      } catch{return {state:'UNAVAILABLE'};}
    },
    async getCatalog(): Promise<CatalogEntry[]> {
      const res = await fetchFn(new URL("/catalog", origin), { redirect: "manual", signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
      return catalogSchema.parse(await res.json());
    },

    async fetchQuote(merchantId, query) {
      const m = getMerchant(merchantId);
      if (!m) return { ok: false, error: "UNKNOWN_MERCHANT" };
      let res: Response;
      try {
        // Origin from config, path from the registry only: no model-supplied URLs, no redirects.
        res = await fetchFn(urlFor(m.path, query), { redirect: "manual", signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) });
      } catch {
        return { ok: false, error: "NETWORK" };
      }
      await res.body?.cancel().catch(() => {}); // the body is never read
      if (res.status !== 402) return { ok: false, error: "QUOTE_NOT_402" };
      const raw = res.headers.get("PAYMENT-REQUIRED");
      let pr: PaymentRequired;
      try {
        pr = decodePaymentRequiredHeader(raw ?? "");
      } catch {
        return { ok: false, error: "BAD_REQUIREMENTS_HEADER" };
      }
      const r = (Array.isArray(pr.accepts) ? pr.accepts : []).find(
        (a) => a.scheme === "exact" && a.network === e.HEDERA_NETWORK && a.asset === assetId,
      );
      const feePayer = r?.extra?.feePayer;
      if (!raw || !r || !/^\d+$/.test(r.amount) || !acct.test(r.payTo) || typeof feePayer !== "string" || !acct.test(feePayer)
        || !Number.isInteger(r.maxTimeoutSeconds) || r.maxTimeoutSeconds <= 0) {
        return { ok: false, error: "BAD_REQUIREMENTS_HEADER" };
      }
      const rh = requestHash("GET", m.path, query);
      queries.set(rh, { ...query });
      const core = {
        merchantId: m.id, method: "GET" as const, origin, path: m.path, requestHash: rh,
        network: r.network, assetId: r.asset, amountAtomic: r.amount, payTo: r.payTo,
        facilitatorUrl: e.FACILITATOR_URL, feePayer, maxTimeoutSeconds: r.maxTimeoutSeconds,
      };
      const received = now();
      return {
        ok: true,
        quote: {
          ...core,
          rawRequirements: raw,
          receivedAt: received.toISOString(),
          localExpiresAt: new Date(received.getTime() + Math.min(60, r.maxTimeoutSeconds) * 1000).toISOString(),
          quoteHash: sha256Hex(canonicalJson(core)),
        },
      };
    },

    async signPayment(permit, requirementsB64) {
      let res: Response;
      try {
        res = await fetchFn(new URL("/sign", e.SIGNER_URL), {
          method: "POST", headers: { "content-type": "application/json" }, redirect: "manual",
          body: JSON.stringify({ permit, requirementsB64 }), signal: AbortSignal.timeout(SIGNER_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, error: "SIGNER_UNREACHABLE" };
      }
      const body = (await res.json().catch(() => null)) as unknown;
      const ok = res.status === 200 ? signerOk.safeParse(body) : null;
      if (!ok?.success) {
        log(`signer refused purchase=${permit.purchaseId} reason=${(body as { reason?: string } | null)?.reason ?? res.status}`);
        return { ok: false, error: "SIGNER_REFUSED" };
      }
      return { ok: true, ...ok.data };
    },

    async submitPaidRequest(quote: Quote, paymentHeader: string) {
      const m = getMerchant(quote.merchantId);
      const query = queries.get(quote.requestHash);
      if (!m || m.path !== quote.path || quote.origin !== origin || !query) {
        // Never sent, so the signed transaction can't land.
        return { outcome: "REJECTED" as const, error: "UNKNOWN_MERCHANT" as RailsError };
      }
      let res: Response;
      try {
        res = await fetchFn(urlFor(m.path, query), {
          headers: { "PAYMENT-SIGNATURE": paymentHeader }, redirect: "manual", signal: AbortSignal.timeout(PAID_TIMEOUT_MS),
        });
      } catch {
        return { outcome: "NO_RESPONSE" as const, error: "NETWORK" as RailsError };
      }
      const header = res.headers.get("PAYMENT-RESPONSE");
      if (res.status !== 200 || !header) {
        await res.body?.cancel().catch(() => {});
        return { outcome: "REJECTED" as const, error: "SETTLEMENT_REJECTED" as RailsError };
      }
      let settlement: SettlementInfo;
      try {
        const s = decodePaymentResponseHeader(header);
        settlement = { success: s.success, transaction: s.transaction, network: s.network, payer: s.payer, errorReason: s.errorReason };
      } catch {
        await res.body?.cancel().catch(() => {});
        return { outcome: "REJECTED" as const, error: "BAD_REQUIREMENTS_HEADER" as RailsError };
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        // Settled but the body was lost or unreadable. validateDelivery reports it, and /recover can fetch it again.
        body = undefined;
      }
      return { outcome: "SETTLED" as const, body, settlement };
    },

    checkSettlement: (txId, expect) => checkSettlement(fetchFn, e.MIRROR_NODE_URL, txId, expect),

    async recoverDelivery(merchantId, hederaTxId, reqHash) {
      if (!getMerchant(merchantId)) return { ok: false };
      try {
        const res = await fetchFn(urlFor("/recover", { tx: hederaTxId, requestHash: reqHash, merchant: merchantId }), {
          redirect: "manual", signal: AbortSignal.timeout(PAID_TIMEOUT_MS),
        });
        if (res.status !== 200) {
          await res.body?.cancel().catch(() => {});
          return { ok: false };
        }
        return { ok: true, body: await res.json() };
      } catch {
        return { ok: false };
      }
    },

    validateDelivery: (merchantId, query, body) => validateDelivery(merchantId, query, body, now()),

    async publishAudit(event) {
      if (Buffer.byteLength(event.json, "utf8") > AUDIT_MAX_BYTES) {
        throw new Error(`audit payload for ${event.id} exceeds ${AUDIT_MAX_BYTES} bytes`);
      }
      return submitAudit(event.json);
    },
  };
}

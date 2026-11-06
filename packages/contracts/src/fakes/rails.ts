import { MERCHANTS, getMerchant } from "../registry";
import { requestHash, sha256Hex } from "../hash";
import type { CatalogEntry, Quote, Rails } from "../types";

/** In-memory Rails. Gouger quotes 0.50 USDC; everything else settles instantly. */
export function createFakeRails(): Rails {
  const paid = new Map<string, unknown>(); // txId -> body
  let seq = 0;
  const body = (id: string) => ({
    location: { lat: 19.07, lon: 72.87 }, window: { start: "2026-11-07", end: "2026-11-13" },
    generatedAt: new Date().toISOString(), units: "metric", merchant: id, summary: "dry, 31C",
  });
  return {
    async getCatalog(): Promise<CatalogEntry[]> {
      return MERCHANTS.map(({ payToEnv: _p, priceAtomic, ...m }) => ({ ...m, livePriceAtomic: priceAtomic }));
    },
    async fetchQuote(merchantId, query) {
      const m = getMerchant(merchantId);
      if (!m) return { ok: false, error: "UNKNOWN_MERCHANT" };
      const now = Date.now();
      const q = {
        merchantId, method: "GET" as const, origin: "http://fake.merchants", path: m.path,
        requestHash: requestHash("GET", m.path, query),
        network: "hedera:testnet", assetId: "0.0.429274", amountAtomic: m.priceAtomic,
        payTo: `0.0.${1000 + MERCHANTS.indexOf(m)}`, facilitatorUrl: "http://fake.facilitator", feePayer: "0.0.9185802",
        maxTimeoutSeconds: 120, rawRequirements: Buffer.from(JSON.stringify({ fake: true })).toString("base64"),
        receivedAt: new Date(now).toISOString(), localExpiresAt: new Date(now + 60_000).toISOString(),
      };
      const { rawRequirements: _r, receivedAt: _a, localExpiresAt: _l, ...hashed } = q;
      return { ok: true, quote: { ...q, quoteHash: sha256Hex(hashed) } };
    },
    async signPayment(permit) {
      const hederaTxId = `0.0.9185802@${Math.floor(Date.now() / 1000)}.${String(++seq).padStart(9, "0")}`;
      return { ok: true, paymentHeader: Buffer.from(JSON.stringify({ permit: permit.permitId, hederaTxId })).toString("base64"), hederaTxId };
    },
    async submitPaidRequest(quote: Quote, paymentHeader) {
      const { hederaTxId } = JSON.parse(Buffer.from(paymentHeader, "base64").toString()) as { hederaTxId: string };
      const b = body(quote.merchantId);
      paid.set(hederaTxId, b);
      return { outcome: "SETTLED", body: b, settlement: { success: true, transaction: hederaTxId, network: quote.network } };
    },
    async checkSettlement(txId) { return paid.has(txId) ? "SUCCESS" : "NOT_FOUND"; },
    async recoverDelivery(_m, txId) { const b = paid.get(txId); return b ? { ok: true, body: b } : { ok: false }; },
    validateDelivery() { return { valid: true, issues: [] }; },
    async publishAudit() { return { topicId: "0.0.1", sequenceNumber: ++seq, consensusTimestamp: new Date().toISOString() }; },
  };
}

import { addA, cmpA, subA } from "../money";
import { newId, sha256Hex } from "../hash";
import { getMerchant } from "../registry";
import {
  IllegalTransitionError, PURCHASE_TRANSITIONS,
  type AuditEvent, type AuditEventType, type AuthAttempt, type InferenceCall, type Mandate, type Purchase,
  type PolicyReason, type PolicyResult, type Quote, type ResearchRun, type SigningPermit, type Trust, type UserPreferences,
} from "../types";

const now = () => new Date().toISOString();
const pub = (a: AuthAttempt) => ({ id: a.id, purpose: a.purpose, targetHash: a.targetHash, expiresAt: a.expiresAt,
  result: a.result, verificationUri: a.verificationUri, userCode: a.userCode });

/** In-memory Trust. Auth attempts auto-VERIFY on first poll (set failNextAuth to exercise the failure path). */
export function createFakeTrust(opts: { failNextAuth?: "DENIED" | "CANCELLED" | "EXPIRED" } = {}): Trust & { failNextAuth?: string } {
  const mandates = new Map<string, Mandate>(), attempts = new Map<string, AuthAttempt>(), runs = new Map<string, ResearchRun>(),
    quotes = new Map<string, Quote>(), purchases = new Map<string, Purchase>(), calls: InferenceCall[] = [],
    prefs = new Map<string, UserPreferences>(), audit: AuditEvent[] = [], permits = new Map<string, SigningPermit>();
  const self: Trust & { failNextAuth?: string } = { failNextAuth: opts.failNextAuth } as never;

  const emit = (type: AuditEventType, extra: Partial<AuditEvent["payload"]> = {}) => {
    const prev = audit.at(-1)?.hash ?? "0".repeat(64), id = newId("evt");
    const payload = { v: 1 as const, type, id, prev, ts: now(), ...extra };
    audit.push({ id, type, payload, prevHash: prev, hash: sha256Hex(payload), state: "PENDING", attempts: 0 });
  };
  const evaluate = (q: Quote): PolicyResult => {
    const run = runs.get(q.runId)!, m = mandates.get(run.mandateId)!, reasons: PolicyReason[] = [];
    const mer = getMerchant(q.merchantId);
    if (m.state !== "ACTIVE") reasons.push("MANDATE_INACTIVE");
    if (!mer || !m.allowedMerchantIds.includes(q.merchantId)) reasons.push("MERCHANT_NOT_ALLOWED");
    if (cmpA(q.amountAtomic, m.perPaymentCapAtomic) > 0) reasons.push("OVER_PER_PAYMENT_CAP");
    if (cmpA(addA(addA(m.spentAtomic, m.reservedAtomic), q.amountAtomic), m.totalBudgetAtomic) > 0) reasons.push("OVER_BUDGET");
    if (mer && (cmpA(q.amountAtomic, (BigInt(mer.referencePriceAtomic.min) / 2n).toString()) < 0 ||
        cmpA(q.amountAtomic, (BigInt(mer.referencePriceAtomic.max) * 3n / 2n).toString()) > 0)) reasons.push("PRICE_ANOMALY");
    if ([...purchases.values()].filter((p) => p.runId === q.runId && !["POLICY_REJECTED", "AGENT_SKIPPED"].includes(p.state)).length >= m.maxPurchasesPerRun)
      reasons.push("MAX_PURCHASES_REACHED");
    return { allowed: reasons.length === 0, reasons, needsApproval: cmpA(q.amountAtomic, m.autoApproveCapAtomic) > 0 };
  };
  const mint = (p: Purchase): SigningPermit => {
    const q = quotes.get(p.quoteId)!;
    const permit = { permitId: newId("pmt"), purchaseId: p.id, mandateId: p.mandateId, mandateVersion: p.mandateVersion,
      network: q.network, assetId: q.assetId, amountAtomic: q.amountAtomic, payTo: q.payTo, feePayer: q.feePayer,
      quoteHash: q.quoteHash, issuedAt: now(), expiresAt: new Date(Date.now() + 60_000).toISOString(), mac: "fake" };
    permits.set(p.id, permit);
    return permit;
  };

  return Object.assign(self, {
    createMandateDraft(userId, d) {
      const m: Mandate = { id: newId("mdt"), version: 1, state: "DRAFT", userId, agentId: "agt_fake", walletAccountId: "0.0.2000",
        network: "hedera:testnet", assetId: "0.0.429274", assetDecimals: 6, totalBudgetAtomic: d.totalBudgetAtomic,
        perPaymentCapAtomic: d.perPaymentCapAtomic, autoApproveCapAtomic: d.autoApproveCapAtomic,
        allowedMerchantIds: d.allowedMerchantIds, maxPurchasesPerRun: d.maxPurchasesPerRun, maxRunDurationSeconds: d.maxRunDurationSeconds,
        validFrom: now(), expiresAt: new Date(Date.now() + d.expiresInSeconds * 1000).toISOString(), revokedAt: null,
        spentAtomic: "0", reservedAtomic: "0", mandateHash: "", activationApprovalId: null, createdAt: now() };
      m.mandateHash = sha256Hex({ ...m, state: undefined, spentAtomic: undefined, reservedAtomic: undefined });
      mandates.set(m.id, m);
      return m;
    },
    async startAuth(userId, purpose, targetId) {
      const m = purpose === "ACTIVATE_MANDATE" ? mandates.get(targetId) : undefined;
      const p = purpose === "APPROVE_PURCHASE" ? purchases.get(targetId) : undefined;
      if (m) m.state = "PENDING_APPROVAL";
      for (const a of attempts.values()) if (a.userId === userId && a.result === "PENDING") a.result = "SUPERSEDED";
      const a: AuthAttempt = { id: newId("att"), userId, purpose, targetHash: m?.mandateHash ?? p?.purchaseHash ?? targetId,
        startedAt: now(), expiresAt: new Date(Date.now() + 300_000).toISOString(), result: "PENDING", deviceCodeRef: targetId,
        verificationUri: "https://auth.world.org/fake", userCode: "FAKE-1234" };
      attempts.set(a.id, a);
      return pub(a);
    },
    async pollAuth(attemptId) {
      const a = attempts.get(attemptId)!;
      if (a.result !== "PENDING") return pub(a);
      if (self.failNextAuth) { a.result = self.failNextAuth as AuthAttempt["result"]; self.failNextAuth = undefined; return pub(a); }
      a.result = "VERIFIED";
      if (a.purpose === "ACTIVATE_MANDATE") {
        const m = mandates.get(a.deviceCodeRef)!; m.state = "ACTIVE"; emit("MANDATE_ACTIVATED", { mandateHash: m.mandateHash });
      } else {
        const p = purchases.get(a.deviceCodeRef)!;
        if (p.state === "AWAITING_APPROVAL") { p.state = "RESERVED"; mint(p); emit("APPROVAL_GRANTED", { pur: p.id }); }
      }
      return pub(a);
    },
    revokeMandate(id) { const m = mandates.get(id)!; m.state = "REVOKED"; m.revokedAt = now(); emit("MANDATE_REVOKED", { mandateHash: m.mandateHash }); return m; },
    getActiveMandate(userId) { return [...mandates.values()].find((m) => m.userId === userId && m.state === "ACTIVE") ?? null; },
    getPreferences: (u) => prefs.get(u) ?? null,
    setPreferences(userId, text) { prefs.set(userId, { userId, text, updatedAt: now() }); },
    createRun(userId, question) {
      const m = self.getActiveMandate(userId);
      if (!m) throw new Error("MANDATE_INACTIVE");
      const r: ResearchRun = { id: newId("run"), userId, mandateId: m.id, mandateVersion: m.version, question, state: "PLANNING", startedAt: now() };
      runs.set(r.id, r);
      return r;
    },
    updateRun(id, patch) { Object.assign(runs.get(id)!, patch); },
    recordQuote(runId, q) { const full = { ...q, id: newId("qte"), runId }; quotes.set(full.id, full); return full; },
    precheck: (qid) => evaluate(quotes.get(qid)!),
    proposePurchase(qid, decision) {
      const q = quotes.get(qid)!, run = runs.get(q.runId)!, id = newId("pur");
      const p: Purchase = { id, runId: q.runId, quoteId: qid, quoteHash: q.quoteHash, mandateId: run.mandateId, mandateVersion: run.mandateVersion,
        state: "PROPOSED", delivery: "NOT_RECEIVED", decision, amountAtomic: q.amountAtomic,
        purchaseHash: sha256Hex({ purchaseId: id, quoteHash: q.quoteHash, amountAtomic: q.amountAtomic, payTo: q.payTo, mandateVersion: run.mandateVersion }),
        createdAt: now(), updatedAt: now() };
      purchases.set(id, p);
      return p;
    },
    authorize(pid) {
      const p = purchases.get(pid)!, q = quotes.get(p.quoteId)!, m = mandates.get(p.mandateId)!;
      const r = evaluate(q);
      if (!r.allowed) { p.state = "POLICY_REJECTED"; p.policyResult = r; return { kind: "REJECTED", reasons: r.reasons }; }
      m.reservedAtomic = addA(m.reservedAtomic, q.amountAtomic);
      p.policyResult = r; p.state = r.needsApproval ? "AWAITING_APPROVAL" : "RESERVED";
      emit("PURCHASE_DECIDED", { pur: p.id, quoteHash: p.quoteHash, mandateHash: m.mandateHash });
      return r.needsApproval ? { kind: "NEEDS_APPROVAL", purchase: p } : { kind: "PERMIT", permit: mint(p) };
    },
    getPermitForPurchase(pid) { const p = permits.get(pid) ?? null; permits.delete(pid); return p; },
    transition(pid, to, data) {
      const p = purchases.get(pid)!;
      if (!PURCHASE_TRANSITIONS[p.state].includes(to)) throw new IllegalTransitionError(p.state, to);
      const m = mandates.get(p.mandateId)!;
      if (to === "CONFIRMED") { m.reservedAtomic = subA(m.reservedAtomic, p.amountAtomic); m.spentAtomic = addA(m.spentAtomic, p.amountAtomic); }
      if (to === "APPROVAL_DENIED" || to === "FAILED_FINAL") m.reservedAtomic = subA(m.reservedAtomic, p.amountAtomic);
      Object.assign(p, data, { state: to, updatedAt: now() });
      if (to === "CONFIRMED") emit("PURCHASE_CONFIRMED", { pur: p.id, tx: p.hederaTxId, quoteHash: p.quoteHash });
      if (to === "FAILED_FINAL") emit("PURCHASE_FAILED", { pur: p.id });
      return p;
    },
    setDelivery(pid, d, issues) { const p = purchases.get(pid)!; p.delivery = d; p.deliveryIssues = issues; emit("DELIVERY_RESULT", { pur: pid }); },
    listUnresolved: () => [...purchases.values()].filter((p) => ["SIGNED", "SUBMITTED", "UNKNOWN"].includes(p.state)),
    recordInference(c) { const full = { ...c, id: newId("inf") }; calls.push(full); return full; },
    listPendingAudit: (n) => audit.filter((e) => e.state !== "ANCHORED").slice(0, n),
    markAnchored(id, r) { Object.assign(audit.find((e) => e.id === id)!, r, { state: "ANCHORED" }); },
    markAuditRetry(id) { const e = audit.find((x) => x.id === id)!; e.state = "RETRYING"; e.attempts++; },
    getRunView(runId) {
      const run = runs.get(runId)!;
      return { run, quotes: [...quotes.values()].filter((q) => q.runId === runId),
        purchases: [...purchases.values()].filter((p) => p.runId === runId).map((p) => ({ ...p, audit: "PENDING" as const })),
        inferenceCalls: calls.filter((c) => c.runId === runId) };
    },
    getLedgerView(userId) {
      const m = [...mandates.values()].filter((x) => x.userId === userId).at(-1) ?? null;
      const receipts = [...purchases.values()].filter((p) => p.state === "CONFIRMED");
      return { mandate: m, limitAtomic: m?.totalBudgetAtomic ?? "0", spentAtomic: m?.spentAtomic ?? "0", reservedAtomic: m?.reservedAtomic ?? "0",
        availableAtomic: m ? subA(subA(m.totalBudgetAtomic, m.spentAtomic), m.reservedAtomic) : "0",
        dataSpendAtomic: m?.spentAtomic ?? "0", inferenceSpend: calls.reduce((s, c) => s + Number(c.totalCost), 0).toString(), receipts };
    },
  } satisfies Trust);
}

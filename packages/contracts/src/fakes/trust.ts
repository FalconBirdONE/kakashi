import type { Trust } from "../interfaces.js";
import type {
  AgentDecision, AuditEvent, AuditPayload, AuthAttempt, AuthAttemptPublic, Approval, AuthorizeResult, InferenceCall, LedgerView,
  Mandate, MandateDraft, PolicyResult, Purchase, Quote, ResearchRun, RunView, UserPreferences,
} from "../entities.js";
import type { AuditEventType, AuthAttemptResult, AuthPurpose, DeliveryState, PurchaseState } from "../enums.js";
import { canTransition } from "../enums.js";
import { IllegalTransitionError, type PolicyReason } from "../errors.js";
import { addA, cmpA, subA } from "../money.js";
import { newId } from "../ids.js";
import { canonicalJson, sha256Hex } from "../hash.js";
import { mintPermit, type SigningPermit } from "../permit.js";
import { MERCHANT_REGISTRY, getMerchant } from "../registry.js";
import { FAKE_ASSET_ID, FAKE_FEEPAYER, FAKE_NETWORK, FAKE_PAYTO, FAKE_PERMIT_SECRET } from "./shared.js";

export type FakeTrust = Trust & {
  /** Simulate World finishing (or failing) an auth attempt. */
  completeAuth(attemptId: string, result: AuthAttemptResult): void;
  setNow(d: Date): void;
};

const RESERVING: PurchaseState[] = ["AWAITING_APPROVAL", "RESERVED", "SIGNED", "SUBMITTED", "UNKNOWN"];
const COUNTS_TOWARD_LIMIT: PurchaseState[] = [...RESERVING, "CONFIRMED"];

export function createFakeTrust(opts: { now?: () => Date; walletAccountId?: string } = {}): FakeTrust {
  let clock = opts.now;
  const now = () => (clock ? clock() : new Date());
  const iso = () => now().toISOString();
  const plus = (s: number) => new Date(now().getTime() + s * 1000).toISOString();

  const mandates = new Map<string, Mandate>();
  const prefs = new Map<string, UserPreferences>();
  const runs = new Map<string, ResearchRun>();
  const quotes = new Map<string, Quote>();
  const policyByQuote = new Map<string, PolicyResult>();
  const purchases = new Map<string, Purchase>();
  const attempts = new Map<string, AuthAttempt & { targetId: string }>();
  const approvals = new Map<string, Approval>();
  const inferences = new Map<string, InferenceCall>();
  const audit: AuditEvent[] = [];
  const pendingPermits = new Map<string, SigningPermit>();

  // ---------- audit outbox (hash chain) ----------
  const emit = (type: AuditEventType, extra: Partial<AuditPayload> = {}) => {
    const prevHash = audit.at(-1)?.hash ?? "GENESIS";
    const id = newId("evt_");
    const payload: AuditPayload = { v: 1, type, id, prev: prevHash, ts: iso(), ...extra };
    audit.push({ id, type, payload, prevHash, hash: sha256Hex(canonicalJson(payload)), state: "PENDING", attempts: 0 });
  };

  const reserve = (m: Mandate, amt: string) => { m.reservedAtomic = addA(m.reservedAtomic, amt); };
  const release = (m: Mandate, amt: string) => { m.reservedAtomic = subA(m.reservedAtomic, amt); };

  const amountOf = (p: Purchase) => quotes.get(p.quoteId)!.amountAtomic;

  // ---------- state machine with budget effects ----------
  function move(p: Purchase, to: PurchaseState, data: Partial<Purchase> = {}): Purchase {
    if (!canTransition(p.state, to)) throw new IllegalTransitionError(p.state, to);
    const m = mandates.get(p.mandateId)!;
    const amt = amountOf(p);
    const from = p.state;
    if (to === "AWAITING_APPROVAL" || (to === "RESERVED" && from === "PROPOSED")) reserve(m, amt);
    else if (to === "CONFIRMED") { release(m, amt); m.spentAtomic = addA(m.spentAtomic, amt); }
    else if (to === "APPROVAL_DENIED" || to === "FAILED_FINAL") release(m, amt);
    Object.assign(p, data, { state: to, updatedAt: iso() });
    return p;
  }

  // ---------- policy (SPEC §11.1) ----------
  function evaluate(q: Quote, m: Mandate | undefined, run: ResearchRun): PolicyResult {
    const r: PolicyReason[] = [];
    if (!m || m.state !== "ACTIVE" || m.revokedAt) r.push("MANDATE_INACTIVE");
    else if (Date.parse(m.expiresAt) <= now().getTime()) r.push("MANDATE_EXPIRED");
    else if (m.version !== run.mandateVersion) r.push("MANDATE_INACTIVE");
    const info = getMerchant(q.merchantId);
    if (!m || !info || !m.allowedMerchantIds.includes(q.merchantId)) r.push("MERCHANT_NOT_ALLOWED");
    if (q.payTo !== FAKE_PAYTO[q.merchantId]) r.push("RECIPIENT_MISMATCH");
    if (m && q.network !== m.network) r.push("NETWORK_MISMATCH");
    if (m && q.assetId !== m.assetId) r.push("ASSET_MISMATCH");
    if (q.feePayer !== FAKE_FEEPAYER) r.push("FEEPAYER_NOT_ALLOWED");
    if (m && cmpA(q.amountAtomic, m.perPaymentCapAtomic) > 0) r.push("OVER_PER_PAYMENT_CAP");
    if (m && cmpA(addA(addA(m.spentAtomic, m.reservedAtomic), q.amountAtomic), m.totalBudgetAtomic) > 0) r.push("OVER_BUDGET");
    if (m) {
      const used = [...purchases.values()].filter((p) => p.runId === run.id && COUNTS_TOWARD_LIMIT.includes(p.state)).length;
      if (used >= m.maxPurchasesPerRun) r.push("MAX_PURCHASES_REACHED");
      if (now().getTime() - Date.parse(run.startedAt) > m.maxRunDurationSeconds * 1000) r.push("RUN_TIME_EXCEEDED");
    }
    if (info) {
      const amt = BigInt(q.amountAtomic);
      if (amt * 2n < BigInt(info.referencePriceAtomic.min) || amt * 2n > BigInt(info.referencePriceAtomic.max) * 3n) r.push("PRICE_ANOMALY");
    }
    if (now().getTime() >= Date.parse(q.localExpiresAt)) r.push("QUOTE_EXPIRED");
    const dup = [...purchases.values()].some((p) => {
      const pq = quotes.get(p.quoteId)!;
      return p.runId === run.id && p.quoteId !== q.id && pq.requestHash === q.requestHash && pq.merchantId === q.merchantId
        && !["POLICY_REJECTED", "AGENT_SKIPPED", "APPROVAL_DENIED", "FAILED_FINAL"].includes(p.state);
    });
    if (dup) r.push("DUPLICATE_REQUEST");
    const needsApproval = !!m && cmpA(q.amountAtomic, m.autoApproveCapAtomic) > 0;
    return { allowed: r.length === 0, reasons: r, needsApproval };
  }

  const lazyMandate = (m: Mandate) => {
    if (m.state === "ACTIVE") {
      if (Date.parse(m.expiresAt) <= now().getTime()) m.state = "EXPIRED";
      else if (m.reservedAtomic === "0") {
        const min = MERCHANT_REGISTRY.reduce((a, x) => (cmpA(x.priceAtomic, a) < 0 ? x.priceAtomic : a), MERCHANT_REGISTRY[0]!.priceAtomic);
        if (cmpA(subA(m.totalBudgetAtomic, m.spentAtomic), min) < 0) m.state = "EXHAUSTED";
      }
    }
    return m;
  };

  const mintFor = (p: Purchase): SigningPermit => {
    const q = quotes.get(p.quoteId)!;
    const permit = mintPermit({
      permitId: newId("pmt_"), purchaseId: p.id, mandateId: p.mandateId, mandateVersion: p.mandateVersion,
      network: q.network, assetId: q.assetId, amountAtomic: q.amountAtomic, payTo: q.payTo, feePayer: q.feePayer,
      quoteHash: q.quoteHash, issuedAt: iso(), expiresAt: plus(60),
    }, FAKE_PERMIT_SECRET);
    p.permitId = permit.permitId;
    return permit;
  };

  const pub = (a: AuthAttempt & { targetId: string }): AuthAttemptPublic => ({
    id: a.id, purpose: a.purpose, targetId: a.targetId, startedAt: a.startedAt, expiresAt: a.expiresAt,
    result: a.result, verificationUri: a.verificationUri, userCode: a.userCode,
  });

  const purchaseHashOf = (id: string, q: Quote, version: number) =>
    sha256Hex(canonicalJson({ purchaseId: id, quoteHash: q.quoteHash, amountAtomic: q.amountAtomic, payTo: q.payTo, mandateVersion: version }));

  // ---------- auth completion ----------
  function finish(a: AuthAttempt & { targetId: string }, result: AuthAttemptResult) {
    if (a.result !== "PENDING") return;
    a.result = result;
    if (a.purpose === "ACTIVATE_MANDATE") {
      const m = mandates.get(a.targetId)!;
      if (result === "VERIFIED" && m.mandateHash === a.targetHash) {
        for (const o of mandates.values()) if (o.userId === m.userId && o.state === "ACTIVE") o.state = "REVOKED";
        const apv: Approval = { id: newId("apv_"), attemptId: a.id, purpose: a.purpose, targetHash: a.targetHash, decision: "APPROVED", createdAt: iso(), expiresAt: plus(300), consumedAt: iso() };
        approvals.set(apv.id, apv);
        m.activationApprovalId = apv.id; m.state = "ACTIVE";
        emit("MANDATE_ACTIVATED", { mandateHash: m.mandateHash });
      } else if (m.state === "PENDING_APPROVAL") m.state = "DRAFT"; // failure path: mandate stays non-active
    } else {
      const p = purchases.get(a.targetId)!;
      if (p.state !== "AWAITING_APPROVAL") return;
      if (result === "VERIFIED" && p.purchaseHash === a.targetHash) {
        const apv: Approval = { id: newId("apv_"), attemptId: a.id, purpose: a.purpose, targetHash: a.targetHash, decision: "APPROVED", createdAt: iso(), expiresAt: plus(300), consumedAt: iso() };
        approvals.set(apv.id, apv);
        move(p, "RESERVED", { approvalId: apv.id });
        pendingPermits.set(p.id, mintFor(p));
        emit("APPROVAL_GRANTED", { pur: p.id, mandateHash: mandates.get(p.mandateId)!.mandateHash });
      } else {
        move(p, "APPROVAL_DENIED");
        emit("APPROVAL_DENIED", { pur: p.id });
      }
    }
  }

  const trust: FakeTrust = {
    setNow: (d) => void (clock = () => d),
    completeAuth: (id, result) => {
      const a = attempts.get(id);
      if (!a) throw new Error(`unknown attempt ${id}`);
      finish(a, result);
    },

    createMandateDraft(userId, d: MandateDraft) {
      const base = {
        userId, agentId: `agt_${userId}`, walletAccountId: opts.walletAccountId ?? "0.0.1001",
        network: FAKE_NETWORK, assetId: FAKE_ASSET_ID, assetDecimals: 6,
        totalBudgetAtomic: d.totalBudgetAtomic, perPaymentCapAtomic: d.perPaymentCapAtomic, autoApproveCapAtomic: d.autoApproveCapAtomic,
        allowedMerchantIds: [...d.allowedMerchantIds].sort(),
        maxPurchasesPerRun: d.maxPurchasesPerRun ?? 3, maxRunDurationSeconds: d.maxRunDurationSeconds ?? 120,
        expiresAt: d.expiresAt, version: 1,
      };
      const m: Mandate = {
        id: newId("mdt_"), state: "DRAFT", validFrom: iso(), revokedAt: null, spentAtomic: "0", reservedAtomic: "0",
        mandateHash: sha256Hex(canonicalJson(base)), activationApprovalId: null, createdAt: iso(), ...base,
      };
      mandates.set(m.id, m);
      return { ...m };
    },

    async startAuth(userId, purpose: AuthPurpose, targetId) {
      let targetHash: string;
      if (purpose === "ACTIVATE_MANDATE") {
        const m = mandates.get(targetId);
        if (!m || m.userId !== userId || !["DRAFT", "PENDING_APPROVAL"].includes(m.state)) throw new Error("mandate not activatable");
        m.state = "PENDING_APPROVAL";
        targetHash = m.mandateHash;
      } else {
        const p = purchases.get(targetId);
        if (!p || p.state !== "AWAITING_APPROVAL") throw new Error("purchase not awaiting approval");
        targetHash = p.purchaseHash;
      }
      for (const o of attempts.values()) if (o.userId === userId && o.purpose === purpose && o.targetId === targetId && o.result === "PENDING") o.result = "SUPERSEDED";
      const a = {
        id: newId("att_"), userId, purpose, targetHash, targetId, startedAt: iso(), expiresAt: plus(purpose === "APPROVE_PURCHASE" ? 300 : 600),
        result: "PENDING" as AuthAttemptResult, deviceCodeRef: `fake-device-${attempts.size + 1}`,
        verificationUri: "https://fake.world.example/device", userCode: `FAKE-${attempts.size + 1}`,
      };
      attempts.set(a.id, a);
      return pub(a);
    },

    async pollAuth(id) {
      const a = attempts.get(id);
      if (!a) throw new Error(`unknown attempt ${id}`);
      if (a.result === "PENDING" && now().getTime() >= Date.parse(a.expiresAt)) finish(a, "EXPIRED");
      return pub(a);
    },

    revokeMandate(id) {
      const m = mandates.get(id);
      if (!m) throw new Error("unknown mandate");
      m.state = "REVOKED"; m.revokedAt = iso();
      emit("MANDATE_REVOKED", { mandateHash: m.mandateHash });
      return { ...m };
    },

    getActiveMandate(userId) {
      for (const m of mandates.values()) if (m.userId === userId && lazyMandate(m).state === "ACTIVE") return { ...m };
      return null;
    },
    getPreferences: (u) => prefs.get(u) ?? null,
    setPreferences: (u, text) => void prefs.set(u, { userId: u, text, updatedAt: iso() }),

    createRun(userId, question) {
      const m = trust.getActiveMandate(userId);
      if (!m) throw new Error("NO_ACTIVE_MANDATE");
      const r: ResearchRun = { id: newId("run_"), userId, mandateId: m.id, mandateVersion: m.version, question, state: "PLANNING", startedAt: iso() };
      runs.set(r.id, r);
      return { ...r };
    },
    updateRun(id, patch) {
      const r = runs.get(id);
      if (!r) throw new Error("unknown run");
      Object.assign(r, patch);
    },

    recordQuote(runId, q) {
      const full: Quote = { ...q, id: newId("qte_"), runId };
      quotes.set(full.id, full);
      policyByQuote.set(full.id, evaluate(full, mandates.get(runs.get(runId)!.mandateId), runs.get(runId)!));
      return { ...full };
    },

    precheck(quoteId) {
      const q = quotes.get(quoteId)!;
      const run = runs.get(q.runId)!;
      const res = evaluate(q, mandates.get(run.mandateId), run);
      policyByQuote.set(quoteId, res);
      return res;
    },

    proposePurchase(quoteId, decision: AgentDecision) {
      const q = quotes.get(quoteId);
      if (!q) throw new Error("unknown quote");
      for (const p of purchases.values()) if (p.runId === q.runId && p.quoteId === quoteId) throw new Error("purchase already exists for quote");
      const run = runs.get(q.runId)!;
      const id = newId("pur_");
      const p: Purchase = {
        id, runId: q.runId, quoteId, quoteHash: q.quoteHash, mandateId: run.mandateId, mandateVersion: run.mandateVersion,
        state: "PROPOSED", delivery: "NOT_RECEIVED", decision, purchaseHash: purchaseHashOf(id, q, run.mandateVersion),
        createdAt: iso(), updatedAt: iso(),
      };
      purchases.set(id, p);
      return { ...p };
    },

    authorize(purchaseId): AuthorizeResult {
      const p = purchases.get(purchaseId);
      if (!p) throw new Error("unknown purchase");
      if (p.state !== "PROPOSED") throw new IllegalTransitionError(p.state, "RESERVED");
      const q = quotes.get(p.quoteId)!;
      const run = runs.get(p.runId)!;
      const res = evaluate(q, mandates.get(p.mandateId), run);
      p.policyResult = res;
      if (!res.allowed || q.quoteHash !== p.quoteHash) {
        move(p, "POLICY_REJECTED");
        return { kind: "REJECTED", reasons: res.reasons };
      }
      if (res.needsApproval) {
        move(p, "AWAITING_APPROVAL");
        emit("PURCHASE_DECIDED", { run: p.runId, pur: p.id, quoteHash: p.quoteHash });
        return { kind: "NEEDS_APPROVAL", purchase: { ...p } };
      }
      move(p, "RESERVED");
      emit("PURCHASE_DECIDED", { run: p.runId, pur: p.id, quoteHash: p.quoteHash });
      return { kind: "PERMIT", permit: mintFor(p) };
    },

    getPermitForPurchase(id) {
      const permit = pendingPermits.get(id) ?? null;
      pendingPermits.delete(id);
      return permit;
    },

    transition(id, to, data) {
      const p = purchases.get(id);
      if (!p) throw new Error("unknown purchase");
      move(p, to, data);
      if (to === "CONFIRMED") emit("PURCHASE_CONFIRMED", { run: p.runId, pur: p.id, tx: p.hederaTxId, quoteHash: p.quoteHash });
      if (to === "FAILED_FINAL") emit("PURCHASE_FAILED", { run: p.runId, pur: p.id, tx: p.hederaTxId });
      return { ...p };
    },

    setDelivery(id, d: DeliveryState, issues) {
      const p = purchases.get(id)!;
      p.delivery = d; p.deliveryIssues = issues; p.updatedAt = iso();
      emit("DELIVERY_RESULT", { run: p.runId, pur: p.id });
    },

    listUnresolved: () => [...purchases.values()].filter((p) => ["SIGNED", "SUBMITTED", "UNKNOWN"].includes(p.state)).map((p) => ({ ...p })),

    recordInference(c) {
      const full: InferenceCall = { ...c, id: newId("inf_") };
      inferences.set(full.id, full);
      return full;
    },

    listPendingAudit: (limit) => audit.filter((e) => e.state === "PENDING" || e.state === "RETRYING").slice(0, limit),
    markAnchored(id, r) {
      const e = audit.find((x) => x.id === id);
      if (e) Object.assign(e, { state: "ANCHORED", topicId: r.topicId, sequenceNumber: r.sequenceNumber, consensusTimestamp: r.consensusTimestamp });
    },
    markAuditRetry(id) {
      const e = audit.find((x) => x.id === id);
      if (e) { e.state = "RETRYING"; e.attempts++; }
    },

    getRunView(runId): RunView {
      const run = runs.get(runId)!;
      const qs = [...quotes.values()].filter((q) => q.runId === runId);
      return {
        run: { ...run },
        quotes: qs.map((q) => ({ ...q, policyResult: policyByQuote.get(q.id) })),
        purchases: [...purchases.values()].filter((p) => p.runId === runId).map((p) => ({ ...p })),
        inferenceCalls: [...inferences.values()].filter((c) => c.runId === runId),
      };
    },

    getLedgerView(userId): LedgerView {
      const ms = [...mandates.values()].filter((m) => m.userId === userId);
      const m = ms.find((x) => lazyMandate(x).state === "ACTIVE") ?? ms.at(-1) ?? null;
      const mine = new Set([...runs.values()].filter((r) => r.userId === userId).map((r) => r.id));
      const confirmed = [...purchases.values()].filter((p) => mine.has(p.runId) && p.state === "CONFIRMED");
      const calls = [...inferences.values()].filter((c) => mine.has(c.runId));
      const limit = m?.totalBudgetAtomic ?? "0";
      const spent = m?.spentAtomic ?? "0";
      const reserved = m?.reservedAtomic ?? "0";
      return {
        mandate: m ? { ...m } : null,
        limitAtomic: limit, spentAtomic: spent, reservedAtomic: reserved,
        availableAtomic: subA(limit, addA(spent, reserved)),
        dataSpendAtomic: confirmed.reduce((s, p) => addA(s, amountOf(p)), "0"),
        // ponytail: Number sum is fine for display of credit costs; use a decimal lib if precision matters.
        inferenceSpend: String(calls.reduce((s, c) => s + Number(c.totalCost || 0), 0)),
        receipts: confirmed.map((p) => ({
          purchaseId: p.id, merchantId: quotes.get(p.quoteId)!.merchantId, amountAtomic: amountOf(p), hederaTxId: p.hederaTxId ?? "",
          zgRequestId: p.decision?.inferenceCallId ? inferences.get(p.decision.inferenceCallId)?.zgRequestId : undefined, at: p.updatedAt,
        })),
      };
    },
  };
  return trust;
}

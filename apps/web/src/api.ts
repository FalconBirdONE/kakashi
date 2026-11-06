// Typed API client. All network calls live here; components never call fetch.
// Runtime imports from contracts are limited to pure modules (see vite.config.ts); the rest is type-only.
import type {
  AuthAttemptPublic, AuthAttemptResult, LedgerView, Mandate, MandateDraft, MerchantFault, RunView,
} from "@kakashi/contracts";

export type AuditStatus = { state: "PENDING" | "ANCHORED" | "UNKNOWN"; sequenceNumber?: number; topicId?: string };
export type RunViewWithAudit = RunView & { audit: Record<string, AuditStatus> };
export type AppConfig = { demoMode: boolean; devAuth: boolean; modes: Record<"rails" | "brain" | "trust", "fake" | "real"> };
export type HistoryItem = { id: string; question: string; state: string; startedAt: string; finishedAt?: string; dataSpendAtomic: string };
export type PurchaseRow = {
  purchaseId: string; runId: string; merchantId: string; amountAtomic: string; payTo: string;
  state: string; delivery: string; hederaTxId?: string; updatedAt: string;
  zgRequestId?: string; trustTier?: string; teeVerified?: boolean | null; audit: AuditStatus;
};
export type DevAuthResult = Exclude<AuthAttemptResult, "PENDING" | "SUPERSEDED">;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

let csrf: string | undefined;
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method, credentials: "same-origin",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "ERROR", data.message ?? res.statusText);
  if (typeof data.csrf === "string") csrf = data.csrf;
  return data as T;
}

export const api = {
  session: () => call<{ userId: string }>("POST", "/session"),
  currentSession: () => call<{userId:string;csrf:string}>("GET","/session"),
  logout: () => call<{ok:true}>("POST","/logout"),
  config: () => call<AppConfig>("GET", "/config"),

  getMandate: () => call<{ mandate: Mandate | null }>("GET", "/mandate"),
  createMandate: (d: MandateDraft) => call<Mandate>("POST", "/mandates", d),
  activateMandate: (id: string) => call<AuthAttemptPublic>("POST", `/mandates/${id}/activate`),
  revokeMandate: (id: string) => call<Mandate>("POST", `/mandates/${id}/revoke`),
  getAttempt: (id: string) => call<AuthAttemptPublic>("GET", `/auth-attempts/${id}`),
  setPreferences: (text: string) => call<{ ok: true }>("PUT", "/preferences", { text }),

  ledger: () => call<LedgerView>("GET", "/ledger"),
  purchases: () => call<{ purchases: PurchaseRow[] }>("GET", "/purchases"),

  startRun: (question: string) => call<{ runId: string }>("POST", "/runs", { question }),
  rerun: (runId: string) => call<{ runId: string }>("POST", `/runs/${runId}/rerun`),
  run: (runId: string) => call<RunViewWithAudit>("GET", `/runs/${runId}`),
  runs: () => call<{ runs: HistoryItem[] }>("GET", "/runs"),
  approvePurchase: (purchaseId: string) => call<AuthAttemptPublic>("POST", `/purchases/${purchaseId}/approve`),
  /** URL for EventSource; the server sends {runId, kind, entityId} per state change. */
  eventsUrl: (runId: string) => `/api/runs/${runId}/events`,

  setFault: (merchantId: string, fault: MerchantFault) => call<{ ok: true }>("POST", "/demo/fault", { merchantId, fault }),
  devCompleteAuth: (attemptId: string, result: DevAuthResult) => call<{ ok: true }>("POST", `/dev/complete-auth/${attemptId}`, { result }),
};

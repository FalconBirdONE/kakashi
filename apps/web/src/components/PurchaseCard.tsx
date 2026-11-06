import type { ReactNode } from "react";
import type { DeliveryState, Purchase, PurchaseState } from "@kakashi/contracts";
import { MERCHANT_REGISTRY } from "@kakashi/contracts/registry";
import type { RunViewWithAudit } from "../api";
import ApprovalCard from "./ApprovalCard";
import { Badge, Card, hashscanTx, usdc, type Tone } from "./ui";

// SPEC A5: the standalone word "Paid" belongs to CONFIRMED only. UNKNOWN is never "Failed".
const PAYMENT: Record<PurchaseState, [string, Tone]> = {
  PROPOSED: ["Proposed", "gray"], AWAITING_APPROVAL: ["Awaiting your approval", "yellow"],
  RESERVED: ["Budget reserved", "blue"], SIGNED: ["Signed, not yet sent", "blue"],
  SUBMITTED: ["Submitted, waiting for confirmation", "blue"], CONFIRMED: ["Paid", "green"],
  UNKNOWN: ["Pending reconciliation", "yellow"], FAILED_FINAL: ["Failed (not charged)", "red"],
  POLICY_REJECTED: ["Rejected by policy", "red"], AGENT_SKIPPED: ["Skipped by the AI", "gray"],
  APPROVAL_DENIED: ["Approval denied", "red"],
};
const DELIVERY: Record<DeliveryState, [string, Tone]> = {
  NOT_RECEIVED: ["Data not received", "gray"], RECEIVED_VALID: ["Data received and valid", "green"],
  RECEIVED_INVALID: ["Data received but failed checks", "red"], RECOVERED: ["Data recovered", "green"],
};

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
    <dt className="shrink-0 text-zinc-500">{k}</dt><dd className="min-w-0 break-all text-zinc-200 sm:text-right">{children}</dd>
  </div>
);

export default function PurchaseCard({ purchase, view, onChanged }: { purchase: Purchase; view: RunViewWithAudit; onChanged: () => void }) {
  const quote = view.quotes.find((q) => q.id === purchase.quoteId);
  const merchant = MERCHANT_REGISTRY.find((m) => m.id === quote?.merchantId)?.name ?? quote?.merchantId ?? "Unknown merchant";
  const call = view.inferenceCalls.find((c) => c.id === purchase.decision?.inferenceCallId);
  const audit = view.audit[purchase.id];
  const [pText, pTone] = PAYMENT[purchase.state];
  const [dText, dTone] = DELIVERY[purchase.delivery];
  const [aText, aTone]: [string, Tone] =
    audit?.state === "ANCHORED" ? [`Audit anchored #${audit.sequenceNumber}`, "green"]
    : audit?.state === "UNKNOWN" ? ["Audit status unknown", "yellow"] : ["Audit anchoring pending", "gray"];

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-zinc-50">{merchant}</h3>
        <span className="font-mono text-base text-zinc-100">{quote ? usdc(quote.amountAtomic) : "amount unknown"}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={pTone}>{pText}</Badge>
        <Badge tone={dTone}>{dText}</Badge>
        <Badge tone={aTone}>{aText}</Badge>
      </div>
      {purchase.delivery === "RECEIVED_INVALID" && purchase.deliveryIssues?.length ? (
        <ul className="mt-3 list-disc pl-5 text-sm text-rose-300">{purchase.deliveryIssues.map((i, n) => <li key={n}>{i}</li>)}</ul>
      ) : null}
      <dl className="mt-4 divide-y divide-white/[0.05] border-t border-white/[0.05] text-sm">
        <Row k="Recipient"><span className="font-mono text-xs">{quote?.payTo ?? "unknown"}</span></Row>
        {purchase.hederaTxId && (
          <Row k="Transaction"><a className="text-link" href={hashscanTx(purchase.hederaTxId)} target="_blank" rel="noreferrer">View on HashScan</a></Row>
        )}
        {call && (<>
          <Row k="0G request"><span className="font-mono text-xs">{call.zgRequestId}</span></Row>
          <Row k="Trust tier">{call.trustTier}</Row>
        </>)}
      </dl>
      {call && (call.teeVerified === true
        ? <p className="mt-3 flex items-center gap-2 text-sm text-emerald-300"><span aria-hidden="true">✓</span>TEE verified (reported by 0G Router)</p>
        : <p role="alert" className="mt-3 text-sm text-amber-300">TEE verification not reported</p>)}
      {purchase.decision && <p className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-zinc-400">AI rationale: {purchase.decision.rationale}</p>}
      {purchase.state === "AWAITING_APPROVAL" && <ApprovalCard purchase={purchase} view={view} onChanged={onChanged} />}
    </Card>
  );
}

import type { DeliveryState, Purchase, PurchaseState } from "@tollbooth/contracts";
import { MERCHANT_REGISTRY } from "@tollbooth/contracts/registry";
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
  const pShort = purchase.state === "CONFIRMED" ? "Payment confirmed" : pText;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{merchant}</h3>
        <span className="font-semibold">{quote ? usdc(quote.amountAtomic) : "amount unknown"}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge tone={pTone}>{pText}</Badge>
        <Badge tone={dTone}>{dText}</Badge>
        <Badge tone={aTone}>{aText}</Badge>
      </div>
      <p className="mt-2 text-xs text-slate-400">{pShort} · {aText}</p>
      {purchase.delivery === "RECEIVED_INVALID" && purchase.deliveryIssues?.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-rose-300">{purchase.deliveryIssues.map((i, n) => <li key={n}>{i}</li>)}</ul>
      ) : null}
      <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-400">Recipient</dt><dd className="break-all font-mono text-xs">{quote?.payTo ?? "unknown"}</dd>
        {purchase.hederaTxId && (<>
          <dt className="text-slate-400">Transaction</dt>
          <dd><a className="break-all underline" href={hashscanTx(purchase.hederaTxId)} target="_blank" rel="noreferrer">View on HashScan</a></dd>
        </>)}
        {call && (<>
          <dt className="text-slate-400">0G request</dt><dd className="break-all font-mono text-xs">{call.zgRequestId}</dd>
          <dt className="text-slate-400">Trust tier</dt><dd>{call.trustTier}</dd>
        </>)}
      </dl>
      {call && (call.teeVerified === true
        ? <p className="mt-2 text-sm text-emerald-300">TEE verified (reported by 0G Router)</p>
        : <p role="alert" className="mt-2 text-sm text-amber-300">TEE verification not reported</p>)}
      {purchase.decision && <p className="mt-2 text-sm text-slate-300">AI rationale: {purchase.decision.rationale}</p>}
      {purchase.state === "AWAITING_APPROVAL" && <ApprovalCard purchase={purchase} view={view} onChanged={onChanged} />}
    </Card>
  );
}

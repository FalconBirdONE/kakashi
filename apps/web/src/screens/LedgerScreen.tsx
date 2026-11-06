import { useState } from "react";
import type { LedgerView } from "@tollbooth/contracts";
import { MERCHANT_REGISTRY } from "@tollbooth/contracts/registry";
import { api, type PurchaseRow } from "../api";
import { Badge, Card, ErrorText, fmtTime, hashscanTx, usdc } from "../components/ui";
import { usePoll } from "../hooks";

const PAY_WORDS: Record<string, string> = {
  PROPOSED: "Proposed", POLICY_REJECTED: "Blocked by policy", AGENT_SKIPPED: "Skipped", AWAITING_APPROVAL: "Awaiting approval",
  APPROVAL_DENIED: "Approval denied", RESERVED: "Funds reserved", SIGNED: "Signed", SUBMITTED: "Submitted",
  CONFIRMED: "Paid", FAILED_FINAL: "Failed", UNKNOWN: "Pending reconciliation",
};
const DELIVERY_WORDS: Record<string, string> = {
  NOT_RECEIVED: "Not received", RECEIVED_VALID: "Received", RECEIVED_INVALID: "Received, invalid", RECOVERED: "Recovered",
};
const name = (id: string) => MERCHANT_REGISTRY.find((m) => m.id === id)?.name ?? id;
const pct = (part: string, whole: string) => {
  const w = Number(whole);
  return w > 0 ? Math.min(100, (Number(part) / w) * 100) : 0;
};

function auditText(p?: PurchaseRow) {
  const a = p?.audit;
  if (!a || a.state === "UNKNOWN") return "-";
  return a.state === "ANCHORED" ? `Anchored #${a.sequenceNumber}` : "Audit anchoring pending";
}

export default function LedgerScreen() {
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  usePoll(async () => {
    try {
      const [l, p] = await Promise.all([api.ledger(), api.purchases()]);
      setLedger(l); setPurchases(p.purchases); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the ledger"); }
  }, 3000);

  if (!ledger) return <div>{error ? <ErrorText>{error}</ErrorText> : <p className="text-slate-400">Loading ledger...</p>}</div>;
  const byId = new Map(purchases.map((p) => [p.purchaseId, p]));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Ledger</h1>
      {error && <ErrorText>{error}</ErrorText>}
      {!ledger.mandate ? (
        <Card><p className="text-slate-300">No mandate yet. <a className="underline" href="#/mandate">Create one on the Mandate screen.</a></p></Card>
      ) : (
        <Card title="Mandate budget">
          <div className="flex h-3 overflow-hidden rounded bg-slate-700" role="img" aria-label="Budget: spent, reserved and available">
            <div className="bg-emerald-500" style={{ width: `${pct(ledger.spentAtomic, ledger.limitAtomic)}%` }} />
            <div className="bg-amber-500" style={{ width: `${pct(ledger.reservedAtomic, ledger.limitAtomic)}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {([["Limit", ledger.limitAtomic], ["Spent", ledger.spentAtomic], ["Reserved", ledger.reservedAtomic], ["Available", ledger.availableAtomic]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-slate-400">{k}</dt><dd className="font-semibold text-slate-100">{usdc(v)}</dd></div>
            ))}
          </dl>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Data spend (USDC, from mandate)"><p className="text-lg font-semibold text-slate-100">{usdc(ledger.dataSpendAtomic)}</p></Card>
        <Card title="AI inference (0G credits, sponsored)">
          <p className="text-lg font-semibold text-slate-100">{ledger.inferenceSpend} 0G credits</p>
          {ledger.inferenceBillingPending && <p role="status">Some inference charges are unknown; budget remains reserved pending reconciliation.</p>}
          <p className="text-xs text-slate-400">Inference is not counted against the mandate budget.</p>
        </Card>
      </div>

      <Card title="Receipts">
        {ledger.receipts.length === 0 ? <p className="text-sm text-slate-400">No receipts yet. Run a research question to make a purchase.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-slate-400"><tr>
                {["Time", "Merchant", "Amount", "Payment", "Delivery", "Audit", "Transaction", "0G request"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {ledger.receipts.map((r) => {
                  const p = byId.get(r.purchaseId);
                  return (
                    <tr key={r.purchaseId} className="border-t border-slate-800 text-slate-100">
                      <td className="px-2 py-1">{fmtTime(r.at)}</td>
                      <td className="px-2 py-1">{name(r.merchantId)}</td>
                      <td className="px-2 py-1">{usdc(r.amountAtomic)}</td>
                      <td className="px-2 py-1">{p ? <Badge tone={p.state === "CONFIRMED" ? "green" : "yellow"}>{PAY_WORDS[p.state] ?? "Unknown state"}</Badge> : "-"}</td>
                      <td className="px-2 py-1">{p ? DELIVERY_WORDS[p.delivery] ?? p.delivery : "-"}</td>
                      <td className="px-2 py-1">{auditText(p)}</td>
                      <td className="px-2 py-1">
                        <a className="font-mono underline" target="_blank" rel="noreferrer" href={hashscanTx(r.hederaTxId)}>{r.hederaTxId.length > 14 ? `${r.hederaTxId.slice(0, 14)}...` : r.hederaTxId}</a>
                      </td>
                      <td className="px-2 py-1 font-mono">{r.zgRequestId ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

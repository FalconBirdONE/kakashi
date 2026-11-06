import { useState } from "react";
import type { LedgerView } from "@kakashi/contracts";
import { MERCHANT_REGISTRY } from "@kakashi/contracts/registry";
import { api, type PurchaseRow } from "../api";
import { SponsorMark } from "../components/Brand";
import { Badge, Card, ErrorText, fmtTime, hashscanTx, Muted, PageHeader, usdc } from "../components/ui";
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

const HEADER = (
  <PageHeader eyebrow="Step 3 of 3 · Verify" title="Ledger">
    Every purchase with its Hedera transaction and its 0G decision. Data spend comes out of your mandate; AI inference is billed separately in 0G credits.
  </PageHeader>
);

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

  if (!ledger) return (
    <div>{HEADER}{error ? <ErrorText>{error}</ErrorText> : <div className="h-48 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />}</div>
  );
  const byId = new Map(purchases.map((p) => [p.purchaseId, p]));

  return (
    <div className="space-y-6">
      {HEADER}
      {error && <ErrorText>{error}</ErrorText>}
      {!ledger.mandate ? (
        <Card><p className="text-zinc-300">No mandate yet. <a className="text-link" href="#/mandate">Create one on the Mandate screen.</a></p></Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-100">Mandate budget</h2>
              <p className="mt-1 text-xs text-zinc-500">Available</p>
              <p className="font-mono text-3xl tracking-tight text-zinc-50 sm:text-4xl">{usdc(ledger.availableAtomic)}</p>
            </div>
            <ul aria-hidden="true" className="flex gap-4 text-xs text-zinc-400">
              <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-400" />Spent</li>
              <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" />Reserved</li>
              <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-white/15" />Available</li>
            </ul>
          </div>
          <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/[0.08]" role="img" aria-label="Budget: spent, reserved and available">
            <div className="flex h-full origin-left animate-grow-x">
              <div className="bg-emerald-400 transition-[width] duration-700 ease-out-expo" style={{ width: `${pct(ledger.spentAtomic, ledger.limitAtomic)}%` }} />
              <div className="bg-amber-400 transition-[width] duration-700 ease-out-expo" style={{ width: `${pct(ledger.reservedAtomic, ledger.limitAtomic)}%` }} />
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-4 text-sm">
            {([["Limit", ledger.limitAtomic], ["Spent", ledger.spentAtomic], ["Reserved", ledger.reservedAtomic]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-zinc-500">{k}</dt><dd className="mt-0.5 font-mono text-zinc-100">{usdc(v)}</dd></div>
            ))}
          </dl>
        </Card>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card title={<><SponsorMark id="hedera" className="h-4 text-zinc-400" />Data spend (USDC, from mandate)</>}><p className="font-mono text-2xl text-zinc-50">{usdc(ledger.dataSpendAtomic)}</p></Card>
        <Card title={<><SponsorMark id="0g" className="h-3 text-zinc-400" />AI inference (0G credits, sponsored)</>}>
          <p className="font-mono text-2xl text-zinc-50">{ledger.inferenceSpend} 0G credits</p>
          {ledger.inferenceBillingPending && <p role="status" className="mt-2 text-sm text-amber-200">Some inference charges are unknown; budget remains reserved pending reconciliation.</p>}
          <p className="mt-2 text-xs text-zinc-500">Inference is not counted against the mandate budget.</p>
        </Card>
      </div>

      <Card title="Receipts">
        {ledger.receipts.length === 0 ? <Muted>No receipts yet. Run a research question to make a purchase.</Muted> : (
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-white/[0.06] text-xs uppercase tracking-wider text-zinc-500">
                {["Time", "Merchant", "Amount", "Payment", "Delivery", "Audit", "Transaction", "0G request"].map((h) => <th key={h} className="px-3 py-2.5 font-medium first:pl-5 sm:first:pl-6">{h}</th>)}
              </tr></thead>
              <tbody>
                {ledger.receipts.map((r) => {
                  const p = byId.get(r.purchaseId);
                  return (
                    <tr key={r.purchaseId} className="border-b border-white/[0.04] text-zinc-200 transition-colors last:border-0 hover:bg-white/[0.02]">
                      <td className="whitespace-nowrap px-3 py-3 pl-5 text-zinc-400 sm:pl-6">{fmtTime(r.at)}</td>
                      <td className="px-3 py-3 font-medium">{name(r.merchantId)}</td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono">{usdc(r.amountAtomic)}</td>
                      <td className="px-3 py-3">{p ? <Badge tone={p.state === "CONFIRMED" ? "green" : "yellow"}>{PAY_WORDS[p.state] ?? "Unknown state"}</Badge> : "-"}</td>
                      <td className="px-3 py-3 text-zinc-400">{p ? DELIVERY_WORDS[p.delivery] ?? p.delivery : "-"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{auditText(p)}</td>
                      <td className="px-3 py-3">
                        <a className="text-link inline-flex items-center gap-1.5 font-mono text-xs" target="_blank" rel="noreferrer" href={hashscanTx(r.hederaTxId)}><SponsorMark id="hedera" className="h-3" />{r.hederaTxId.length > 14 ? `${r.hederaTxId.slice(0, 14)}...` : r.hederaTxId}</a>
                      </td>
                      <td className="px-3 py-3 pr-5 font-mono text-xs text-zinc-400 sm:pr-6">{r.zgRequestId ? <span className="inline-flex items-center gap-1.5"><SponsorMark id="0g" className="h-2.5" />{r.zgRequestId}</span> : "-"}</td>
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

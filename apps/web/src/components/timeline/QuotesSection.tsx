import type { PolicyReason, RunView } from "@kakashi/contracts";
import { MERCHANT_REGISTRY } from "@kakashi/contracts/registry";
import { Badge, listCls, Muted, usdc } from "../ui";

export const REASON_TEXT: Record<PolicyReason, string> = {
  MANDATE_INACTIVE: "Your mandate is not active", MANDATE_EXPIRED: "Your mandate has expired",
  MERCHANT_NOT_ALLOWED: "This merchant is not on your allowed list",
  RECIPIENT_MISMATCH: "Pay-to account does not match the registered merchant",
  ASSET_MISMATCH: "Payment asset is not the one your mandate allows", NETWORK_MISMATCH: "Payment network is not the one your mandate allows",
  FEEPAYER_NOT_ALLOWED: "Fee payer is not allowed", OVER_PER_PAYMENT_CAP: "Above your per-payment cap",
  OVER_BUDGET: "Would exceed the budget", MAX_PURCHASES_REACHED: "Purchase limit for this run reached",
  PRICE_ANOMALY: "Price far outside the normal range", QUOTE_EXPIRED: "The quote expired before it could be used",
  DUPLICATE_REQUEST: "The same request was already made", RUN_TIME_EXCEEDED: "The run took longer than its time limit",
};
export const merchantName = (id: string): string => MERCHANT_REGISTRY.find((m) => m.id === id)?.name ?? id;

export default function QuotesSection({ quotes }: { quotes: RunView["quotes"] }) {
  if (quotes.length === 0) return <Muted>No quotes yet.</Muted>;
  return (
    <ul className={listCls}>
      {quotes.map((q) => {
        const p = q.policyResult;
        return (
          <li key={q.id} className="px-4 py-3 text-sm text-zinc-200">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-medium text-zinc-100">{merchantName(q.merchantId)}</span>
              <span className="font-mono text-zinc-400">{usdc(q.amountAtomic)}</span>
              <span className="flex flex-wrap gap-2 sm:ml-auto">
                {p && <Badge tone={p.allowed ? "green" : "red"}>{p.allowed ? "Allowed" : "Rejected"}</Badge>}
                {p?.needsApproval && <Badge tone="yellow">Needs your approval</Badge>}
              </span>
            </div>
            {p && p.reasons.length > 0 && (
              <ul className="mt-1.5 list-disc pl-5 text-zinc-500">{p.reasons.map((r) => <li key={r}>{REASON_TEXT[r] ?? r}</li>)}</ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

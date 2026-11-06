import type { PolicyReason, RunView } from "@tollbooth/contracts";
import { MERCHANT_REGISTRY } from "@tollbooth/contracts/registry";
import { Badge, Card, usdc } from "../ui";

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
  return (
    <Card title="Quotes">
      {quotes.length === 0 ? <p className="text-sm text-slate-400">No quotes yet.</p> : (
        <ul className="space-y-3">
          {quotes.map((q) => {
            const p = q.policyResult;
            return (
              <li key={q.id} className="text-sm text-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{merchantName(q.merchantId)}</span><span>{usdc(q.amountAtomic)}</span>
                  {p && <Badge tone={p.allowed ? "green" : "red"}>{p.allowed ? "Allowed" : "Rejected"}</Badge>}
                  {p?.needsApproval && <Badge tone="yellow">Needs your approval</Badge>}
                </div>
                {p && p.reasons.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-slate-400">{p.reasons.map((r) => <li key={r}>{REASON_TEXT[r] ?? r}</li>)}</ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

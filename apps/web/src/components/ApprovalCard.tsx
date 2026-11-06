import { useState } from "react";
import type { AuthAttemptPublic, AuthAttemptResult, Purchase } from "@tollbooth/contracts";
import { MERCHANT_REGISTRY } from "@tollbooth/contracts/registry";
import { api, type RunViewWithAudit } from "../api";
import { AuthFlow } from "./AuthFlow";
import { Button, ErrorText, shortCode, usdc } from "./ui";

export default function ApprovalCard({ purchase, view, onChanged }: { purchase: Purchase; view: RunViewWithAudit; onChanged: () => void }) {
  const quote = view.quotes.find((q) => q.id === purchase.quoteId);
  const merchant = MERCHANT_REGISTRY.find((m) => m.id === quote?.merchantId)?.name ?? quote?.merchantId ?? "Unknown merchant";
  const [attempt, setAttempt] = useState<AuthAttemptPublic | null>(null);
  const [result, setResult] = useState<AuthAttemptResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true); setErr(null);
    try { setAttempt(await api.approvePurchase(purchase.id)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not start approval"); }
    finally { setBusy(false); }
  };
  const done = (r: AuthAttemptResult) => { setResult(r); onChanged(); };
  const failed = result !== null && result !== "VERIFIED";

  return (
    <div className="mt-3 space-y-3 rounded border border-amber-700 bg-slate-950 p-3" role="group" aria-label="Purchase approval">
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-400">Amount</dt><dd className="font-semibold">{quote ? usdc(quote.amountAtomic) : "unknown"}</dd>
        <dt className="text-slate-400">Merchant</dt><dd>{merchant}</dd>
        <dt className="text-slate-400">Recipient</dt><dd className="break-all font-mono text-xs">{quote?.payTo ?? "unknown"}</dd>
        <dt className="text-slate-400">Short code</dt><dd className="font-mono font-bold" data-testid="short-code">{shortCode(purchase.purchaseHash)}</dd>
      </dl>
      <p className="text-xs text-slate-400">World authenticates the human. Tollbooth records your approval of this specific purchase.</p>
      {!attempt && <Button onClick={start} disabled={busy}>Approve with World ID</Button>}
      {err && <ErrorText>{err}</ErrorText>}
      {attempt && <AuthFlow attempt={attempt} onResult={done} />}
      {failed && <p className="text-sm text-slate-200">This purchase was not approved. No payment was made and the reserved budget was released.</p>}
    </div>
  );
}

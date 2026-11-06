import { useState } from "react";
import type { AuthAttemptPublic, AuthAttemptResult, Purchase } from "@kakashi/contracts";
import { MERCHANT_REGISTRY } from "@kakashi/contracts/registry";
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
    <div className="mt-5 space-y-4 rounded-xl border border-amber-400/30 bg-amber-400/[0.04] p-4 sm:p-5" role="group" aria-label="Purchase approval">
      <h4 className="text-sm font-semibold text-amber-100">This purchase is above your auto-approve cap</h4>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-zinc-500">Amount</dt><dd className="font-mono font-semibold text-zinc-50">{quote ? usdc(quote.amountAtomic) : "unknown"}</dd>
        <dt className="text-zinc-500">Merchant</dt><dd className="text-zinc-200">{merchant}</dd>
        <dt className="text-zinc-500">Recipient</dt><dd className="break-all font-mono text-xs text-zinc-200">{quote?.payTo ?? "unknown"}</dd>
        <dt className="text-zinc-500">Short code</dt><dd className="font-mono font-semibold tracking-[0.15em] text-gold-200" data-testid="short-code">{shortCode(purchase.purchaseHash)}</dd>
      </dl>
      <p className="text-xs text-zinc-500">World authenticates the human. Kakashi records your approval of this specific purchase.</p>
      {!attempt && <Button onClick={start} disabled={busy}>Approve with World ID</Button>}
      {err && <ErrorText>{err}</ErrorText>}
      {attempt && <AuthFlow attempt={attempt} onResult={done} />}
      {failed && <p className="text-sm text-zinc-200">This purchase was not approved. No payment was made and the reserved budget was released.</p>}
    </div>
  );
}

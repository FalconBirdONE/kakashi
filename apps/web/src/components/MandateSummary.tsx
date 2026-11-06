import type { Mandate } from "@kakashi/contracts";
import { MERCHANT_REGISTRY } from "@kakashi/contracts/registry";
import { Badge, Card, fmtTime, shortCode, usdc, type Tone } from "./ui";

const TONES: Record<string, Tone> = { ACTIVE: "green", DRAFT: "gray", PENDING_APPROVAL: "yellow", EXPIRED: "red", REVOKED: "red", EXHAUSTED: "red" };
const LABELS: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", PENDING_APPROVAL: "Awaiting approval", EXPIRED: "Expired", REVOKED: "Revoked", EXHAUSTED: "Exhausted" };
const merchantName = (id: string) => MERCHANT_REGISTRY.find((m) => m.id === id)?.name ?? id;

export default function MandateSummary({ mandate: m }: { mandate: Mandate }) {
  const limits: [string, string][] = [
    ["Total budget", usdc(m.totalBudgetAtomic)], ["Per-payment cap", usdc(m.perPaymentCapAtomic)], ["Auto-approve cap", usdc(m.autoApproveCapAtomic)],
  ];
  const rows: [string, string][] = [
    ["Max purchases per run", String(m.maxPurchasesPerRun)], ["Max run duration", `${m.maxRunDurationSeconds} s`],
    ["Spent", usdc(m.spentAtomic)], ["Reserved", usdc(m.reservedAtomic)], ["Expires", fmtTime(m.expiresAt)],
    ["Wallet account", m.walletAccountId], ["Network", m.network], ["Asset", `${m.assetId} (${m.assetDecimals} decimals)`],
    ["Version", String(m.version)],
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">Your mandate</h2>
          <div className="mt-2"><Badge tone={TONES[m.state] ?? "gray"}>{LABELS[m.state] ?? m.state}</Badge></div>
        </div>
        <div className="sm:text-right">
          <span className="block text-xs text-zinc-500">Short code</span>
          <span className="mt-1 block font-mono text-2xl font-semibold tracking-[0.2em] text-gold-200" data-testid="short-code">{shortCode(m.mandateHash)}</span>
        </div>
      </div>
      <dl className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3">
        {limits.map(([k, v]) => (
          <div key={k} className="bg-ink/90 px-4 py-3.5">
            <dt className="text-xs text-zinc-500">{k}</dt>
            <dd className="mt-1 font-mono text-lg text-zinc-50">{v}</dd>
          </div>
        ))}
      </dl>
      <dl className="mt-5 grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4 border-b border-white/[0.05] py-2.5 sm:col-span-2">
          <dt className="shrink-0 text-zinc-500">Allowed merchants</dt>
          <dd className="text-right text-zinc-200">{m.allowedMerchantIds.map(merchantName).join(", ") || "none"}</dd>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-white/[0.05] py-2.5">
            <dt className="shrink-0 text-zinc-500">{k}</dt><dd className="text-right text-zinc-200 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

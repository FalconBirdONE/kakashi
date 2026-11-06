import type { Mandate } from "@tollbooth/contracts";
import { MERCHANT_REGISTRY } from "@tollbooth/contracts/registry";
import { Badge, Card, fmtTime, shortCode, usdc, type Tone } from "./ui";

const TONES: Record<string, Tone> = { ACTIVE: "green", DRAFT: "gray", PENDING_APPROVAL: "yellow", EXPIRED: "red", REVOKED: "red", EXHAUSTED: "red" };
const LABELS: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", PENDING_APPROVAL: "Awaiting approval", EXPIRED: "Expired", REVOKED: "Revoked", EXHAUSTED: "Exhausted" };
const merchantName = (id: string) => MERCHANT_REGISTRY.find((m) => m.id === id)?.name ?? id;

export default function MandateSummary({ mandate: m }: { mandate: Mandate }) {
  const rows: [string, string][] = [
    ["Wallet account", m.walletAccountId], ["Network", m.network], ["Asset", `${m.assetId} (${m.assetDecimals} decimals)`],
    ["Total budget", usdc(m.totalBudgetAtomic)], ["Per-payment cap", usdc(m.perPaymentCapAtomic)],
    ["Auto-approve cap", usdc(m.autoApproveCapAtomic)],
    ["Allowed merchants", m.allowedMerchantIds.map(merchantName).join(", ") || "none"],
    ["Max purchases per run", String(m.maxPurchasesPerRun)], ["Max run duration", `${m.maxRunDurationSeconds} s`],
    ["Expires", fmtTime(m.expiresAt)], ["Spent", usdc(m.spentAtomic)], ["Reserved", usdc(m.reservedAtomic)],
    ["Version", String(m.version)],
  ];
  return (
    <Card title="Your mandate">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Badge tone={TONES[m.state] ?? "gray"}>{LABELS[m.state] ?? m.state}</Badge>
        <span className="text-sm text-slate-400">Short code</span>
        <span className="font-mono text-2xl font-bold tracking-widest text-slate-50" data-testid="short-code">{shortCode(m.mandateHash)}</span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-slate-800 py-1">
            <dt className="text-slate-400">{k}</dt><dd className="break-all text-right text-slate-100">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

import type { PlanOutput } from "@kakashi/contracts";
import { Badge, listCls, Muted } from "../ui";

export default function PlanSection({ plan }: { plan?: PlanOutput }) {
  if (!plan) return <Muted>Waiting for the plan.</Muted>;
  const { tokenId, tradeUsd } = plan.query as { tokenId?: string; tradeUsd?: number };
  return (
    <>
    {(tokenId || tradeUsd !== undefined) && (
      <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-300">
        {tokenId && <a className="text-link font-mono" href={`https://hashscan.io/mainnet/token/${tokenId}`} target="_blank" rel="noreferrer">Token {tokenId}</a>}
        {tradeUsd !== undefined && <span className="font-mono">Trade {tradeUsd} USD</span>}
      </p>
    )}
    <ul className={listCls}>
      {plan.needs.map((n) => (
        <li key={n.needId} className="flex items-start gap-3 px-4 py-3 text-sm text-zinc-200">
          <Badge tone={n.priority === 1 ? "yellow" : "gray"}>Priority {n.priority}</Badge><span>{n.description}</span>
        </li>
      ))}
    </ul>
    </>
  );
}

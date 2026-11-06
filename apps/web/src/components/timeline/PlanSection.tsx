import type { PlanOutput } from "@tollbooth/contracts";
import { Badge, listCls, Muted } from "../ui";

export default function PlanSection({ plan }: { plan?: PlanOutput }) {
  if (!plan) return <Muted>Waiting for the plan.</Muted>;
  return (
    <ul className={listCls}>
      {plan.needs.map((n) => (
        <li key={n.needId} className="flex items-start gap-3 px-4 py-3 text-sm text-zinc-200">
          <Badge tone={n.priority === 1 ? "yellow" : "gray"}>Priority {n.priority}</Badge><span>{n.description}</span>
        </li>
      ))}
    </ul>
  );
}

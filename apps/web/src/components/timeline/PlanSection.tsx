import type { PlanOutput } from "@tollbooth/contracts";
import { Badge, Card } from "../ui";

export default function PlanSection({ plan }: { plan?: PlanOutput }) {
  return (
    <Card title="Plan">
      {!plan ? <p className="text-sm text-slate-400">Waiting for the plan.</p> : (
        <ul className="space-y-2">
          {plan.needs.map((n) => (
            <li key={n.needId} className="flex items-start gap-2 text-sm text-slate-200">
              <Badge tone={n.priority === 1 ? "yellow" : "gray"}>Priority {n.priority}</Badge><span>{n.description}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

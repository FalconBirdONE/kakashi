import type { AgentDecision, RunView } from "@tollbooth/contracts";
import { Badge, Card } from "../ui";
import { merchantName } from "./QuotesSection";

const CODE: Record<AgentDecision["reasonCode"], string> = {
  FILLS_NEED: "Fills a need", REDUNDANT: "Redundant with other data", TOO_EXPENSIVE_FOR_VALUE: "Too expensive for its value",
  LOW_RELEVANCE: "Low relevance", CORROBORATES_CONFLICT: "Helps settle a conflict between sources",
};

export default function DecisionsSection({ view }: { view: RunView }) {
  const items = view.purchases.filter((p) => p.decision);
  return (
    <Card title="Decisions">
      {items.length === 0 ? <p className="text-sm text-slate-400">No decisions yet.</p> : (
        <ul className="space-y-3">
          {items.map((p) => {
            const d = p.decision!;
            const q = view.quotes.find((x) => x.id === p.quoteId);
            return (
              <li key={p.id} className="text-sm text-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={d.action === "BUY" ? "green" : "gray"}>{d.action}</Badge>
                  <span className="font-medium">{q ? merchantName(q.merchantId) : "Unknown merchant"}</span>
                  <span>{CODE[d.reasonCode] ?? d.reasonCode}</span>
                  <span className="text-slate-400">Expected usefulness {Math.round(d.expectedUsefulness * 100)}%</span>
                </div>
                <p className="mt-1 text-slate-400">{d.rationale}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

import type { AgentDecision, RunView } from "@kakashi/contracts";
import { Badge, listCls, Muted } from "../ui";
import { merchantName } from "./QuotesSection";

const CODE: Record<AgentDecision["reasonCode"], string> = {
  FILLS_NEED: "Fills a need", REDUNDANT: "Redundant with other data", TOO_EXPENSIVE_FOR_VALUE: "Too expensive for its value",
  LOW_RELEVANCE: "Low relevance", CORROBORATES_CONFLICT: "Helps settle a conflict between sources",
};

export default function DecisionsSection({ view }: { view: RunView }) {
  const items = view.purchases.filter((p) => p.decision);
  if (items.length === 0) return <Muted>No decisions yet.</Muted>;
  return (
    <ul className={listCls}>
      {items.map((p) => {
        const d = p.decision!;
        const q = view.quotes.find((x) => x.id === p.quoteId);
        const pct = Math.round(d.expectedUsefulness * 100);
        return (
          <li key={p.id} className="px-4 py-3.5 text-sm text-zinc-200">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Badge tone={d.action === "BUY" ? "green" : "gray"}>{d.action}</Badge>
              <span className="font-medium text-zinc-100">{q ? merchantName(q.merchantId) : "Unknown merchant"}</span>
              <span className="text-zinc-400">{CODE[d.reasonCode] ?? d.reasonCode}</span>
              <span className="flex items-center gap-2 text-xs text-zinc-500 sm:ml-auto">
                Expected usefulness
                <span aria-hidden="true" className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full origin-left animate-grow-x rounded-full bg-gold-400/70" style={{ width: `${pct}%` }} />
                </span>
                {pct}%
              </span>
            </div>
            <p className="mt-1.5 text-zinc-400">{d.rationale}</p>
          </li>
        );
      })}
    </ul>
  );
}

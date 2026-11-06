import Markdown from "react-markdown";
import type { SynthesisOutput } from "@tollbooth/contracts";
import { Badge, Card, Muted } from "../ui";

const go = (id: string) => document.getElementById(`purchase-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
const List = ({ title, items }: { title: string; items: string[] }) => items.length === 0 ? null : (
  <div className="mt-5"><h3 className="text-sm font-medium text-zinc-200">{title}</h3>
    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-zinc-400">{items.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
);
const prose = "space-y-3 text-[15px] leading-relaxed text-zinc-200 [&_a]:text-link [&_code]:font-mono [&_code]:text-gold-200 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-zinc-50 [&_ul]:list-disc [&_ul]:pl-5";

export default function AnswerSection({ answer }: { answer?: SynthesisOutput }) {
  if (!answer) return <Muted>Waiting for the answer.</Muted>;
  return (
    <Card frame="gold" className="animate-page-in">
      <Badge tone={answer.confidence === "high" ? "green" : answer.confidence === "medium" ? "yellow" : "red"}>Confidence: {answer.confidence}</Badge>
      <div className={`mt-4 ${prose}`}><Markdown skipHtml>{answer.answer}</Markdown></div>
      {answer.citations.length > 0 && (
        <p className="mt-5 text-sm text-zinc-400">Sources:{" "}
          {answer.citations.map((c, i) => (
            <a key={c} href={`#purchase-${c}`} className="text-link mr-2 font-mono"
              onClick={(e) => { e.preventDefault(); go(c); }}>[{i + 1}]</a>
          ))}
        </p>
      )}
      <List title="Disagreements" items={answer.disagreements} />
      <List title="Gaps" items={answer.gaps} />
      {answer.suspiciousContent.length > 0 && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
          <h3 className="text-sm font-semibold text-amber-200">Suspicious content found in purchased data</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-100/90">{answer.suspiciousContent.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}

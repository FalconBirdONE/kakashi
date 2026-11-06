import Markdown from "react-markdown";
import type { SynthesisOutput } from "@tollbooth/contracts";
import { Badge, Card } from "../ui";

const go = (id: string) => document.getElementById(`purchase-${id}`)?.scrollIntoView({ behavior: "smooth" });
const List = ({ title, items }: { title: string; items: string[] }) => items.length === 0 ? null : (
  <div className="mt-3"><h3 className="text-sm font-medium text-slate-200">{title}</h3>
    <ul className="list-disc pl-5 text-sm text-slate-300">{items.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
);

export default function AnswerSection({ answer }: { answer?: SynthesisOutput }) {
  if (!answer) return null;
  return (
    <Card title="Answer">
      <Badge tone={answer.confidence === "high" ? "green" : answer.confidence === "medium" ? "yellow" : "red"}>Confidence: {answer.confidence}</Badge>
      <div className="mt-3 space-y-2 text-sm text-slate-200"><Markdown skipHtml>{answer.answer}</Markdown></div>
      {answer.citations.length > 0 && (
        <p className="mt-3 text-sm text-slate-300">Sources:{" "}
          {answer.citations.map((c, i) => (
            <a key={c} href={`#purchase-${c}`} className="mr-2 text-sky-400 underline"
              onClick={(e) => { e.preventDefault(); go(c); }}>[{i + 1}]</a>
          ))}
        </p>
      )}
      <List title="Disagreements" items={answer.disagreements} />
      <List title="Gaps" items={answer.gaps} />
      {answer.suspiciousContent.length > 0 && (
        <div role="alert" className="mt-4 rounded border border-amber-600 bg-amber-950 p-3">
          <h3 className="text-sm font-semibold text-amber-200">Suspicious content found in purchased data</h3>
          <ul className="list-disc pl-5 text-sm text-amber-100">{answer.suspiciousContent.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}

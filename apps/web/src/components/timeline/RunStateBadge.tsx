import type { ResearchRun } from "@tollbooth/contracts";
import { Badge } from "../ui";

const REASONS: Record<string, string> = {
  PROCESS_RESTART: "The server restarted; recorded payments are being recovered. A run with no purchases can be rerun",
  SYNTHESIZE_ZG_UNAVAILABLE: "The AI service was unavailable; no new decisions were made",
  RUN_TIME_EXCEEDED: "The run took longer than its time limit",
  MANDATE_INACTIVE: "Your mandate is not active",
  INTERNAL_ERROR: "Something went wrong on our side",
};
export const failureText = (r?: string): string =>
  !r ? "" : REASONS[r] ?? (r.startsWith("PLAN_") ? "The AI service could not make a plan" : r.startsWith("SYNTHESIZE_") ? "The AI service could not write the answer" : r);

const LIVE: Record<string, string> = {
  PLANNING: "Planning: working out what data is needed", QUOTING: "Quoting: asking merchants for prices",
  DECIDING: "Deciding: choosing what is worth buying", PURCHASING: "Purchasing: in progress",
  SYNTHESIZING: "Synthesizing: writing the answer",
};

const row = "flex flex-wrap items-center gap-x-2.5 gap-y-1.5";
export default function RunStateBadge({ run }: { run: ResearchRun }) {
  const why = failureText(run.failureReason);
  if (LIVE[run.state]) return <p role="status" className={row}><Badge tone="blue">In progress</Badge> <span className="text-sm text-zinc-400">{LIVE[run.state]}</span></p>;
  if (run.state === "DONE") return <p role="status" className={row}><Badge tone="green">Done</Badge></p>;
  if (run.state === "PARTIAL") return (
    <p role="status" className={row}><Badge tone="yellow">Partial</Badge>{" "}
      <span className="text-sm text-zinc-400">Partial: some evidence is missing, still unresolved, or the AI service failed. Receipts so far are shown below.{why && ` ${why}.`}</span></p>);
  return <p role="status" className={row}><Badge tone="red">Failed</Badge>{" "}
    <span className="text-sm text-zinc-400">Failed: nothing was bought.{why && ` ${why}.`}</span></p>;
}

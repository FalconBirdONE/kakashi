import { useState } from "react";
import type { AuthAttemptPublic, AuthAttemptResult } from "@kakashi/contracts";
import { api, type DevAuthResult } from "../api";
import { useConfig, usePoll } from "../hooks";
import { Badge, Button, ErrorText, type Tone } from "./ui";

export const RESULT_WORDS: Record<AuthAttemptResult, { text: string; tone: Tone }> = {
  PENDING: { text: "Waiting for you to finish in World ID", tone: "yellow" },
  VERIFIED: { text: "Verified", tone: "green" },
  CANCELLED: { text: "Cancelled", tone: "red" },
  DENIED: { text: "Denied", tone: "red" },
  EXPIRED: { text: "Expired", tone: "red" },
  IDENTITY_MISMATCH: { text: "Different World ID used", tone: "red" },
  ERROR: { text: "Error", tone: "red" },
  SUPERSEDED: { text: "Replaced by a newer attempt", tone: "gray" },
};
const DEV_RESULTS: DevAuthResult[] = ["VERIFIED", "CANCELLED", "DENIED", "EXPIRED", "IDENTITY_MISMATCH", "ERROR"];

/**
 * World ID attempt UI shared by mandate activation and purchase approval: shows the link and code,
 * polls the attempt every 2 s, and reports the terminal result in plain words.
 * In DEMO_MODE with fake trust it also shows buttons that complete the attempt.
 */
export function AuthFlow({ attempt, onResult }: { attempt: AuthAttemptPublic; onResult?: (r: AuthAttemptResult) => void }) {
  const config = useConfig();
  const [current, setCurrent] = useState(attempt);
  const [err, setErr] = useState<string | null>(null);
  const pending = current.result === "PENDING";

  usePoll(async () => {
    try {
      const a = await api.getAttempt(attempt.id);
      setCurrent(a);
      if (a.result !== "PENDING") onResult?.(a.result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "polling failed");
    }
  }, 2000, pending);

  const words = RESULT_WORDS[current.result];
  return (
    <div className="space-y-4" aria-live="polite">
      <Badge tone={words.tone}>{words.text}</Badge>
      {pending && (
        <div className="animate-page-in rounded-xl border border-white/[0.08] bg-black/30 p-4 sm:p-5">
          <p className="text-sm text-zinc-400">
            Open <a href={current.verificationUri} target="_blank" rel="noreferrer" className="text-link break-all">{current.verificationUri}</a> and enter this code:
          </p>
          <p className="mt-3 font-mono text-3xl font-semibold tracking-[0.3em] text-zinc-50 sm:text-4xl" data-testid="user-code">{current.userCode}</p>
        </div>
      )}
      {err && <ErrorText>{err}</ErrorText>}
      {pending && config.devAuth && (
        <div className="rounded-xl border border-dashed border-white/15 p-3">
          <p className="mb-2 text-xs text-zinc-500">Demo only: finish this attempt as World would.</p>
          <div className="flex flex-wrap gap-2">
            {DEV_RESULTS.map((r) => (
              <Button key={r} variant="ghost" size="sm" onClick={() => api.devCompleteAuth(attempt.id, r).catch((e) => setErr(String(e.message)))}>
                {RESULT_WORDS[r].text}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

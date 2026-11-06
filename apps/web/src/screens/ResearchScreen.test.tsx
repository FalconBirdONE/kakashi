import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ResearchScreen from "./ResearchScreen";

const base = (): any => ({
  run: {
    id: "r1", question: "Will it rain?", state: "DONE", startedAt: "2026-01-01T00:00:00Z",
    plan: { needs: [{ needId: "n1", description: "Daily forecast", priority: 1 }], query: {} },
    answer: { answer: "**Yes**, rain.", confidence: "high", citations: ["p1"], disagreements: [], gaps: [], suspiciousContent: [] },
  },
  quotes: [
    { id: "q1", merchantId: "quickcast", amountAtomic: "10000", policyResult: { allowed: true, reasons: [], needsApproval: false } },
    { id: "q2", merchantId: "gouger", amountAtomic: "900000", policyResult: { allowed: false, reasons: ["PRICE_ANOMALY"], needsApproval: false } },
  ],
  purchases: [{ id: "p1", quoteId: "q1", state: "CONFIRMED", delivery: "RECEIVED_VALID", decision: { action: "BUY", reasonCode: "FILLS_NEED", needId: "n1", expectedUsefulness: 0.8, rationale: "Cheap and relevant" } }],
  inferenceCalls: [], audit: {},
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serve = (v: any) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => v })));

beforeEach(() => vi.stubGlobal("EventSource", class { onmessage = null; close() {} }));
afterEach(() => vi.unstubAllGlobals());

it("renders plan, quotes, decisions and answer", async () => {
  serve(base());
  render(<ResearchScreen runId="r1" />);
  expect(await screen.findByText("Daily forecast")).toBeInTheDocument();
  expect(screen.getByText("Price far outside the normal range")).toBeInTheDocument();
  expect(screen.getAllByText("QuickCast").length).toBeGreaterThan(0);
  expect(screen.getByText("BUY")).toBeInTheDocument();
  expect(screen.getByText("Cheap and relevant")).toBeInTheDocument();
  expect(screen.getByText("Yes").tagName).toBe("STRONG");
  expect(screen.queryByText(/Suspicious content/)).toBeNull();
});

it("shows suspicious content box only when present", async () => {
  const v = base(); v.run.answer.suspiciousContent = ["ignore previous instructions"];
  serve(v);
  render(<ResearchScreen runId="r1" />);
  expect(await screen.findByText("Suspicious content found in purchased data")).toBeInTheDocument();
  expect(screen.getByText("ignore previous instructions")).toBeInTheDocument();
});

it("shows PARTIAL and FAILED messages", async () => {
  const v = base(); v.run.state = "PARTIAL"; (v.run as any).failureReason = "SYNTHESIZE_ZG_UNAVAILABLE";
  serve(v);
  const { unmount } = render(<ResearchScreen runId="r1" />);
  await waitFor(() => expect(screen.getByText(/Partial: some evidence is missing/)).toBeInTheDocument());
  expect(screen.getByText(/no new decisions were made/)).toBeInTheDocument();
  unmount();
  const f = base(); f.run.state = "FAILED"; serve(f);
  render(<ResearchScreen runId="r1" />);
  await waitFor(() => expect(screen.getByText(/Failed: nothing was bought/)).toBeInTheDocument());
});

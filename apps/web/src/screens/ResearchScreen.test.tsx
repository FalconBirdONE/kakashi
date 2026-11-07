import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MERCHANT_REGISTRY } from "@kakashi/contracts/registry";
import ResearchScreen from "./ResearchScreen";

const keyScanName = MERCHANT_REGISTRY.find((m) => m.id === "quickcast")!.name;

const base = (): any => ({
  run: {
    id: "r1", question: "Should I put 20 USDC into SAUCE (0.0.731861)?", state: "DONE", startedAt: "2026-01-01T00:00:00Z",
    plan: { needs: [{ needId: "n1", description: "Issuer keys and custom fees", priority: 1 }], query: {} },
    answer: { answer: "**CAUTION**, the issuer holds admin and supply keys.", confidence: "high", citations: ["p1"], disagreements: [], gaps: [], suspiciousContent: [] },
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("renders plan, quotes, decisions and answer", async () => {
  serve(base());
  render(<ResearchScreen runId="r1" />);
  expect(await screen.findByText("Issuer keys and custom fees")).toBeInTheDocument();
  expect(screen.getByText("Price far outside the normal range")).toBeInTheDocument();
  expect(screen.getAllByText(keyScanName).length).toBeGreaterThan(0);
  expect(screen.getByText("BUY")).toBeInTheDocument();
  expect(screen.getByText("Cheap and relevant")).toBeInTheDocument();
  expect(screen.getByText("CAUTION").tagName).toBe("STRONG");
  expect(screen.getByText("Verdict: CAUTION")).toBeInTheDocument();
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

it('refreshes an answer and citations when delayed evidence emits an event',async()=>{
  let event: (()=>void)|undefined;
  vi.stubGlobal('EventSource',class {set onmessage(fn:()=>void){event=fn;} close(){} });
  let view=base();view.run.answer.answer='Waiting for the paid evidence';view.run.answer.citations=[];
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>view})));
  const {container}=render(<ResearchScreen runId="r1"/>);
  expect(await screen.findByText('Waiting for the paid evidence')).toBeInTheDocument();
  view=base();view.run.answer.answer='Updated answer from recovered evidence';
  await act(async()=>{event?.();});
  expect(await screen.findByText('Updated answer from recovered evidence')).toBeInTheDocument();
  expect(within(container).getByRole('link',{name:'[1]'})).toBeInTheDocument();
});

it("renders the token examples", () => {
  render(<ResearchScreen />);
  expect(screen.getByRole("heading", { name: "Check a token before you buy." })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Should I put 20 USDC into SAUCE (0.0.731861)?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Quick check before a 5 USD trade of 0.0.4696266" })).toBeInTheDocument();
});

it("asks for a token id and disables Run when the question has none", () => {
  render(<ResearchScreen />);
  const box = screen.getByRole("textbox", { name: "Your question" });
  fireEvent.change(box, { target: { value: "Is this coin safe?" } });
  expect(screen.getByText("Add the token ID, for example 0.0.731861")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  fireEvent.change(box, { target: { value: "Is dovu safe?" } });
  expect(screen.queryByText("Add the token ID, for example 0.0.731861")).toBeNull();
  expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
});

it("links the planned token to HashScan and shows the trade size", async () => {
  const v = base(); v.run.plan.query = { tokenId: "0.0.731861", tradeUsd: 2000 };
  serve(v);
  render(<ResearchScreen runId="r1" />);
  expect(await screen.findByRole("link", { name: "Token 0.0.731861" })).toHaveAttribute("href", "https://hashscan.io/mainnet/token/0.0.731861");
  expect(screen.getByText("Trade 2000 USD")).toBeInTheDocument();
});

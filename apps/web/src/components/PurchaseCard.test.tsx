import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Purchase, PurchaseState } from "@kakashi/contracts";
import type { RunViewWithAudit } from "../api";
import PurchaseCard from "./PurchaseCard";

const STATES: PurchaseState[] = ["PROPOSED", "POLICY_REJECTED", "AGENT_SKIPPED", "AWAITING_APPROVAL", "APPROVAL_DENIED",
  "RESERVED", "SIGNED", "SUBMITTED", "CONFIRMED", "FAILED_FINAL", "UNKNOWN"];

const mk = (state: PurchaseState, hederaTxId?: string) => ({
  id: "p1", runId: "r1", quoteId: "q1", quoteHash: "h", mandateId: "m", mandateVersion: 1, state, delivery: "NOT_RECEIVED",
  purchaseHash: "abcdef123456", hederaTxId, createdAt: "", updatedAt: "",
  decision: { action: "BUY", reasonCode: "FILLS_NEED", needId: "n", expectedUsefulness: 0.5, rationale: "<b>cheap</b>", inferenceCallId: "i1" },
}) as unknown as Purchase;

const view = {
  run: {}, purchases: [],
  quotes: [{ id: "q1", merchantId: "quickcast", amountAtomic: "10000", payTo: "0.0.99" }],
  inferenceCalls: [{ id: "i1", zgRequestId: "zg-1", trustTier: "verified", teeVerified: null }],
  audit: { p1: { state: "PENDING" } },
} as unknown as RunViewWithAudit;

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(STATES)("Paid wording only for CONFIRMED: %s", (s) => {
  render(<PurchaseCard purchase={mk(s)} view={view} onChanged={() => {}} />);
  if (s === "CONFIRMED") expect(screen.getAllByText(/\bPaid\b/i).length).toBeGreaterThan(0);
  else expect(screen.queryByText(/\bPaid\b/i)).toBeNull();
  if (s === "UNKNOWN") {
    expect(screen.getAllByText(/Pending reconciliation/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/failed/i)).toBeNull();
  }
});

it("HashScan link only with a tx id", () => {
  const { unmount } = render(<PurchaseCard purchase={mk("SUBMITTED")} view={view} onChanged={() => {}} />);
  expect(screen.queryByRole("link")).toBeNull();
  unmount();
  render(<PurchaseCard purchase={mk("CONFIRMED", "0.0.1@2.3")} view={view} onChanged={() => {}} />);
  expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringContaining("0.0.1@2.3"));
});

it("shows approval card with short code, TEE warning, and plain-text rationale", () => {
  render(<PurchaseCard purchase={mk("AWAITING_APPROVAL")} view={view} onChanged={() => {}} />);
  expect(screen.getByTestId("short-code")).toHaveTextContent("ABCDEF");
  expect(screen.getByRole("button", { name: "Approve with World ID" })).toBeInTheDocument();
  expect(screen.getByText(/TEE verification not reported/)).toBeInTheDocument();
  expect(screen.getByText(/<b>cheap<\/b>/)).toBeInTheDocument();
});

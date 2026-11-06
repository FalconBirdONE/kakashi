import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MandateScreen from "./MandateScreen";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mandate = (state: string) => ({
  id: "m1", version: 1, state, userId: "u", agentId: "a", walletAccountId: "0.0.5", network: "hedera:testnet", assetId: "0.0.9",
  assetDecimals: 6, totalBudgetAtomic: "200000", perPaymentCapAtomic: "100000", autoApproveCapAtomic: "20000",
  allowedMerchantIds: ["quickcast"], maxPurchasesPerRun: 3, maxRunDurationSeconds: 120, validFrom: "2026-01-01T00:00:00Z",
  expiresAt: "2026-01-01T01:00:00Z", revokedAt: null, spentAtomic: "0", reservedAtomic: "0", mandateHash: "abcdef123456",
  activationApprovalId: null, createdAt: "2026-01-01T00:00:00Z",
});
const json = (b: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) });

function stub(initial: unknown, attemptResult = "PENDING") {
  let current = initial;
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const m = init?.method ?? "GET";
    if (url === "/api/mandate") return json({ mandate: current });
    if (url === "/api/mandates" && m === "POST") { current = mandate("DRAFT"); return json(current); }
    if (url.endsWith("/activate")) return json({ id: "at1", purpose: "MANDATE_ACTIVATION", targetId: "m1", startedAt: "", expiresAt: "", result: "PENDING", verificationUri: "https://w.example", userCode: "ABCD" });
    if (url === "/api/auth-attempts/at1") return json({ id: "at1", result: attemptResult, verificationUri: "https://w.example", userCode: "ABCD" });
    return json({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("shows form defaults and keeps preferences outside the form", async () => {
  stub(null);
  render(<MandateScreen />);
  const form = await screen.findByRole("form", { name: "Create mandate" });
  expect(screen.getByLabelText("Total budget (USDC)")).toHaveValue("0.20");
  expect(screen.getByLabelText("Per-payment cap (USDC)")).toHaveValue("0.10");
  expect(screen.getByLabelText("Auto-approve cap (USDC)")).toHaveValue("0.02");
  expect(screen.getByLabelText("Max purchases per run")).toHaveValue("3");
  expect(screen.getByLabelText("Expires in (minutes)")).toHaveValue("30");
  expect(within(form).getAllByRole("checkbox")).toHaveLength(4);
  const prefs = screen.getByLabelText("Used by the AI, not enforced");
  expect(form.contains(prefs)).toBe(false);
});

it("shows the summary with short code after creation", async () => {
  stub(null);
  render(<MandateScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Create mandate" }));
  expect(await screen.findByTestId("short-code")).toHaveTextContent("ABCDEF");
  expect(screen.queryByText("Active")).not.toBeInTheDocument();
});

it("rejects out-of-order caps in plain words", async () => {
  const f = stub(null);
  render(<MandateScreen />);
  const auto = await screen.findByLabelText("Auto-approve cap (USDC)");
  fireEvent.change(auto, { target: { value: "0.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Create mandate" }));
  expect(await screen.findByText(/must not exceed the per-payment cap/)).toBeInTheDocument();
  expect(f).not.toHaveBeenCalledWith("/api/mandates", expect.anything());
});

it("does not show Active when the World result is not VERIFIED", async () => {
  stub(mandate("DRAFT"), "DENIED");
  render(<MandateScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Activate with World ID" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0), { timeout: 4000 });
  expect(screen.queryByText("Active")).not.toBeInTheDocument();
});

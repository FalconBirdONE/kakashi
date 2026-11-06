import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LedgerScreen from "./LedgerScreen";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("renders server figures verbatim with separate spend labels", async () => {
  const ledger = {
    mandate: { id: "m1" }, limitAtomic: "200000", spentAtomic: "30000", reservedAtomic: "10000", availableAtomic: "160000",
    dataSpendAtomic: "30000", inferenceSpend: "0.000123",
    receipts: [{ purchaseId: "p1", merchantId: "quickcast", amountAtomic: "30000", hederaTxId: "0.0.1@1.2", zgRequestId: "zg-9", at: "2026-01-01T00:00:00Z" }],
  };
  const purchases = [{ purchaseId: "p1", state: "CONFIRMED", delivery: "RECEIVED_VALID", audit: { state: "ANCHORED", sequenceNumber: 7 } }];
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url === "/api/ledger" ? ledger : { purchases }) })));
  render(<LedgerScreen />);
  expect(await screen.findByText("0.16 USDC")).toBeInTheDocument();
  expect(screen.getByText("Data spend (USDC, from mandate)")).toBeInTheDocument();
  expect(screen.getByText("AI inference (0G credits, sponsored)")).toBeInTheDocument();
  expect(screen.getByText("0.000123 0G credits")).toBeInTheDocument();
  expect(screen.getByText("Paid")).toBeInTheDocument();
  expect(screen.getByText("Anchored #7")).toBeInTheDocument();
  expect(screen.getByText("zg-9")).toBeInTheDocument();
});

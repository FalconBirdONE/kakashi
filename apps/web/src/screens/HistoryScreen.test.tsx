import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HistoryScreen from "./HistoryScreen";

afterEach(() => vi.unstubAllGlobals());

it("lists past runs with state, data spend and a Run again button", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    runs: [{ id: "run_1", question: "Will it rain?", state: "DONE", startedAt: "2026-11-07T10:00:00Z", dataSpendAtomic: "10000" }],
  }))));
  render(<HistoryScreen />);
  expect(await screen.findByText("Will it rain?")).toBeInTheDocument();
  expect(screen.getByText("DONE")).toBeInTheDocument();
  expect(screen.getByText(/0\.01 USDC/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
});

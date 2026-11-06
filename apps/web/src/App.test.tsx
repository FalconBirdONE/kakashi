import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

it("renders the title and navigation", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<App />);
  expect(screen.getByText("Tollbooth")).toBeInTheDocument();
  for (const n of ["Mandate", "Research", "Ledger", "History"]) expect(screen.getByRole("link", { name: n })).toBeInTheDocument();
});

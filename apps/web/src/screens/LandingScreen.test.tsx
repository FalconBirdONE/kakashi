import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LandingScreen from "./LandingScreen";

const scrolled: string[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };
  // Only the first slide sits above the 40% line, so it is the current one.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { top: this.id === "intro" ? 0 : 5000 } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("links all three sponsors", () => {
  render(<LandingScreen />);
  for (const n of ["World", "0G", "Hedera"]) expect(screen.getAllByRole("link", { name: `${n} website` }).length).toBeGreaterThan(0);
});

it("moves one slide per arrow key, but not while typing", () => {
  render(<LandingScreen />);
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(scrolled).toEqual(["problem"]);
  fireEvent.keyDown(window, { key: "End" });
  expect(scrolled.at(-1)).toBe("close");
  const input = document.createElement("input");
  document.body.append(input);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(scrolled).toHaveLength(2);
  input.remove();
});

it("shows the failure path in the World demo", () => {
  render(<LandingScreen />);
  fireEvent.click(screen.getAllByRole("button", { name: "Activate with World ID" })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Cancelled. The mandate stays inactive.")).toBeInTheDocument();
});

it("pitches the pre-trade token check", () => {
  render(<LandingScreen />);
  expect(screen.getByRole("heading", { level: 1, name: "Check a token before you buy it." })).toBeInTheDocument();
  expect(screen.getByText("I'm about to put 2,000 USDC into SAUCE (0.0.731861). Safe?")).toBeInTheDocument();
  expect(screen.getByText(/Checks read public Hedera mainnet data/)).toBeInTheDocument();
  expect(screen.getByText(/a cheapest-first rule buys KeyScan every time/)).toBeInTheDocument();
});

it("buys only KeyScan under the cheapest-first rule", () => {
  render(<LandingScreen />);
  fireEvent.click(screen.getByLabelText("Compare with a cheapest-first rule"));
  expect(screen.getByText("No AI: it buys KeyScan every time.")).toBeInTheDocument();
  expect(screen.getAllByText("Cheapest quote that fills a need.")).toHaveLength(1);
});

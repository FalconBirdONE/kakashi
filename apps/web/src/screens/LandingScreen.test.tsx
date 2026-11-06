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

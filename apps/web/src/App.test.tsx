import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ""; });

it("opens on the landing page with the main navigation", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1, name: /Check a token before you buy it/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Kakashi home" })).toHaveAttribute("href", "#/");
  expect(screen.getByRole("link", { name: /Set up a mandate/ })).toHaveAttribute("href", "#/mandate");
  for (const n of ["Mandate", "Research", "Ledger", "History"]) expect(screen.getByRole("link", { name: n })).not.toHaveAttribute("aria-current");
});

it("routes app pages by hash and marks the current nav link", () => {
  window.location.hash = "#/research/run_1";
  render(<App />);
  expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("heading", { level: 1, name: /Check a token before you buy it/ })).toBeNull();
});

it("falls back to the landing page for unknown routes", () => {
  window.location.hash = "#/nope";
  render(<App />);
  expect(screen.getByRole("heading", { level: 1, name: /Check a token before you buy it/ })).toBeInTheDocument();
});

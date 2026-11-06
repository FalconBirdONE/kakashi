import { describe, expect, it } from "vitest";
import { PURCHASE_TRANSITIONS, canTransition, type PurchaseState } from "../src/index.js";

describe("canTransition", () => {
  const states = Object.keys(PURCHASE_TRANSITIONS) as PurchaseState[];
  it("agrees with the table for every pair", () => {
    for (const from of states)
      for (const to of states) expect(canTransition(from, to)).toBe(PURCHASE_TRANSITIONS[from].includes(to));
  });
  it("spot checks from SPEC §7.3", () => {
    expect(canTransition("PROPOSED", "RESERVED")).toBe(true);
    expect(canTransition("UNKNOWN", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "FAILED_FINAL")).toBe(false);
    expect(canTransition("RESERVED", "CONFIRMED")).toBe(false);
    expect(canTransition("POLICY_REJECTED", "RESERVED")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { addA, cmpA, fromAtomic, isAtomic, subA, toAtomic } from "../src/money.js";

describe("money", () => {
  it("round trips", () => {
    expect(toAtomic("0.02", 6)).toBe("20000");
    expect(toAtomic("5", 6)).toBe("5000000");
    expect(toAtomic("0", 6)).toBe("0");
    expect(fromAtomic("20000", 6)).toBe("0.02");
    expect(fromAtomic("5000000", 6)).toBe("5");
    expect(fromAtomic("0", 6)).toBe("0");
    expect(fromAtomic("1", 6)).toBe("0.000001");
    expect(fromAtomic("12", 0)).toBe("12");
    for (const d of ["0.1", "123.456789", "9"]) expect(fromAtomic(toAtomic(d, 6), 6)).toBe(d);
  });
  it("rejects bad display input", () => {
    for (const s of ["-1", "1e3", "1.5e2", "abc", "", "1.", ".5", "0.0000001", "1,5", " 1"])
      expect(() => toAtomic(s, 6), s).toThrow();
  });
  it("rejects bad atomics", () => {
    for (const s of ["-1", "1.5", "x", ""]) {
      expect(() => fromAtomic(s, 6)).toThrow();
      expect(() => addA(s, "1")).toThrow();
      expect(() => cmpA("1", s)).toThrow();
    }
  });
  it("arithmetic", () => {
    expect(addA("999999999999999999", "1")).toBe("1000000000000000000");
    expect(subA("5", "5")).toBe("0");
    expect(() => subA("4", "5")).toThrow();
    expect(cmpA("2", "10")).toBe(-1);
    expect(cmpA("10", "10")).toBe(0);
    expect(cmpA("11", "10")).toBe(1);
  });
  it("isAtomic", () => {
    expect(isAtomic("0")).toBe(true);
    expect(isAtomic("123")).toBe(true);
    for (const x of ["01", "-1", "1.0", "", "a", 1, null, undefined]) expect(isAtomic(x)).toBe(false);
  });
});

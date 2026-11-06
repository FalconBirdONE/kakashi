import { describe, expect, it } from "vitest";
import { canonicalJson, requestHash, sha256Hex } from "../src/hash.js";
import { newId, ID_PREFIXES } from "../src/ids.js";

describe("hash", () => {
  it("canonicalJson is key-order stable, recursive, drops undefined, keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 1, 2] } })).toBe('{"a":{"c":[3,1,2],"d":2},"b":1}');
    expect(canonicalJson({ a: 1, b: { y: 1, x: 2 } })).toBe(canonicalJson({ b: { x: 2, y: 1 }, a: 1 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(null)).toBe("null");
  });
  it("sha256Hex known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("requestHash is query-order independent and method-case insensitive", () => {
    const a = requestHash("get", "/x", { a: "1", b: "2 3" });
    expect(a).toBe(requestHash("GET", "/x", { b: "2 3", a: "1" }));
    expect(a).toBe(sha256Hex("GET\n/x\na=1&b=2%203"));
    expect(a).not.toBe(requestHash("GET", "/x", { a: "1", b: "2" }));
  });
});

describe("ids", () => {
  it("26-char crockford, prefixed, unique and monotonic", () => {
    let prev = "";
    for (let i = 0; i < 2000; i++) {
      const id = newId("run_");
      expect(id).toMatch(/^run_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(id > prev).toBe(true);
      prev = id;
    }
    expect(ID_PREFIXES).toHaveLength(11);
  });
});

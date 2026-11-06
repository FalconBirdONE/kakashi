import { expect, test } from "vitest";
import { upsertEnvText } from "./env.js";

test("upsertEnvText replaces existing keys, keeps other lines, appends new keys", () => {
  const before = "# header\nA=1\nB=\nC=3\n";
  expect(upsertEnvText(before, { B: "two", D: "4" })).toBe("# header\nA=1\nB=two\nC=3\nD=4\n");
});

test("upsertEnvText on empty text writes only the new keys", () => {
  expect(upsertEnvText("", { X: "1" })).toBe("X=1\n");
});

import { createHash } from "node:crypto";
import { ulid } from "ulid";

export type IdPrefix = "usr" | "agt" | "mdt" | "att" | "apv" | "run" | "qte" | "pur" | "inf" | "evt" | "pmt";
export const newId = (p: IdPrefix): string => `${p}_${ulid()}`;

/** Sorted keys, undefined dropped (SPEC §7.2). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export const sha256Hex = (v: unknown): string =>
  createHash("sha256").update(typeof v === "string" ? v : canonicalJson(v)).digest("hex");

export function requestHash(method: string, path: string, query: Record<string, string> = {}): string {
  const qs = Object.keys(query).sort().map((k) => `${k}=${query[k]}`).join("&");
  return sha256Hex(`${method}\n${path}\n${qs}`);
}

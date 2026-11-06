import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { PrivateKey } from "@hiero-ledger/sdk";

export const ROOT = resolve(import.meta.dirname, "../..");
export const GENERATED_PATH = resolve(ROOT, ".env.generated");
export const SIGNER_ENV_PATH = resolve(ROOT, "apps/signer/.env.local");

export const ACCOUNT_KEYS = [
  "AGENT_ACCOUNT_ID",
  "MERCHANT_QUICKCAST_PAYTO",
  "MERCHANT_HOURLYPRO_PAYTO",
  "MERCHANT_GROUNDTRUTH_PAYTO",
  "MERCHANT_GOUGER_PAYTO",
] as const;

export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

// Later sources win, but an empty value never hides a real one (.env copied from .env.example has blanks).
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const src of [readEnvFile(resolve(ROOT, ".env")), readEnvFile(GENERATED_PATH), process.env]) {
    for (const [k, v] of Object.entries(src)) if (v) out[k] = v;
  }
  return out;
}

// Replace or append KEY=value lines, keeping every other line (comments, other keys) intact.
export function upsertEnvText(text: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values));
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const updated = lines.map((line) => {
    const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (key === undefined || !pending.has(key)) return line;
    const v = pending.get(key)!;
    pending.delete(key);
    return `${key}=${v}`;
  });
  for (const [k, v] of pending) updated.push(`${k}=${v}`);
  return updated.join("\n") + "\n";
}

export function upsertEnvFile(path: string, values: Record<string, string>, header = ""): void {
  const current = existsSync(path) ? readFileSync(path, "utf8") : header;
  writeFileSync(path, upsertEnvText(current, values), { mode: 0o600 });
}

// Portal keys come as DER ("302...") or raw hex ("0x..."); raw hex is ambiguous, so assume ECDSA (SPEC §4.2).
export function parseKey(text: string): PrivateKey {
  return text.startsWith("302") ? PrivateKey.fromStringDer(text) : PrivateKey.fromStringECDSA(text);
}

export function need(env: Record<string, string>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is not set (put it in .env)`);
  return v;
}

export async function mirrorGet<T>(env: Record<string, string>, path: string): Promise<T | null> {
  const base = env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com";
  const res = await fetch(`${base}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mirror node ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

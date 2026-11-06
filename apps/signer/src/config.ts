import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { PrivateKey } from "@x402/hedera";
import { signerEnv } from "@tollbooth/contracts";

export const PACKAGE_DIR = resolve(import.meta.dirname, "..");

/** apps/signer/.env.local, then the process env. The signer never reads the shared root .env. */
export function loadSignerConfig(env: Record<string, string | undefined> = process.env) {
  const merged: Record<string, string> = {};
  const local = resolve(PACKAGE_DIR, ".env.local");
  for (const src of [existsSync(local) ? parseEnv(readFileSync(local, "utf8")) : {}, env]) {
    for (const [k, v] of Object.entries(src)) if (v) merged[k] = v;
  }
  const host = merged.SIGNER_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1") throw new Error(`refusing to start: SIGNER_HOST must be 127.0.0.1, got ${host}`);
  const e = signerEnv.parse(merged);
  return {
    ...e,
    agentKey: parseKey(e.AGENT_PRIVATE_KEY),
    host,
    port: Number(merged.SIGNER_PORT ?? 4100),
    dbPath: merged.SIGNER_DB_PATH ?? resolve(PACKAGE_DIR, "data/signer.sqlite"),
  };
}

// DER ("302...") or hex ECDSA, matching scripts/hedera/env.ts.
export function parseKey(text: string): PrivateKey {
  return text.startsWith("302") ? PrivateKey.fromStringDer(text) : PrivateKey.fromStringECDSA(text);
}

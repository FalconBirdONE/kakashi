import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import { MERCHANT_REGISTRY, type MerchantId } from "@tollbooth/contracts";

export const PACKAGE_DIR = resolve(import.meta.dirname, "..");
const ROOT = resolve(PACKAGE_DIR, "../...js");

/** Root .env, then .env.generated, then the process env. Empty values never hide a real one. */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const files = [".env", ".env.generated"].map((f) => resolve(ROOT, f)).filter(existsSync);
  for (const src of [...files.map((f) => parseEnv(readFileSync(f, "utf8"))), process.env]) {
    for (const [k, v] of Object.entries(src)) if (v) out[k] = v;
  }
  return out;
}

const acct = z.string().regex(/^\d+\.\d+\.\d+$/, "expected 0.0.x");
const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const schema = z.object({
  ASSET_MODE: z.enum(["usdc", "hbar"]).default("usdc"),
  USDC_TOKEN_ID: acct.default("0.0.429274"),
  FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  MIRROR_NODE_URL: z.string().url().default("https://testnet.mirrornode.hedera.com"),
  MERCHANT_QUICKCAST_PAYTO: acct,
  MERCHANT_HOURLYPRO_PAYTO: acct,
  MERCHANT_GROUNDTRUTH_PAYTO: acct,
  MERCHANT_GOUGER_PAYTO: acct,
  HEDERA_OPERATOR_ID: acct.optional(), // SWAP_PAYTO demo fault only
  DEMO_MODE: bool,
  FIXTURE_MODE: bool,
  MERCHANTS_PORT: z.coerce.number().int().default(4200),
  MERCHANTS_DB_PATH: z.string().default(resolve(PACKAGE_DIR, "data/merchants.sqlite")),
});

export type MerchantsConfig = {
  network: "hedera:testnet";
  asset: string;
  payTo: Record<MerchantId, string>;
  swapPayTo?: string;
  facilitatorUrl: string;
  mirrorUrl: string;
  demoMode: boolean;
  fixtureMode: boolean;
  port: number;
  dbPath: string;
};

export function parseConfig(env: Record<string, string | undefined>): MerchantsConfig {
  const e = schema.parse(env);
  const payTo = Object.fromEntries(
    MERCHANT_REGISTRY.map((m) => [m.id, (e as Record<string, unknown>)[m.payToEnv] as string]),
  ) as Record<MerchantId, string>;
  return {
    network: "hedera:testnet",
    // Prices are registry atomic amounts in either asset (tinybars in HBAR mode).
    asset: e.ASSET_MODE === "hbar" ? "0.0.0" : e.USDC_TOKEN_ID,
    payTo,
    swapPayTo: e.HEDERA_OPERATOR_ID,
    facilitatorUrl: e.FACILITATOR_URL,
    mirrorUrl: e.MIRROR_NODE_URL,
    demoMode: e.DEMO_MODE,
    fixtureMode: e.FIXTURE_MODE,
    port: e.MERCHANTS_PORT,
    dbPath: e.MERCHANTS_DB_PATH,
  };
}

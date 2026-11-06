import { MERCHANT_REGISTRY } from "../registry.js";

/** Deterministic fake accounts, shared by the fake rails and the fake trust (which plays "env[payToEnv]"). */
export const FAKE_PAYTO: Record<string, string> = Object.fromEntries(
  MERCHANT_REGISTRY.map((m, i) => [m.id, `0.0.${5001 + i}`]),
);
export const FAKE_ASSET_ID = "0.0.429274";
export const FAKE_NETWORK = "hedera:testnet" as const;
export const FAKE_FEEPAYER = "0.0.9185802";
export const FAKE_FACILITATOR = "https://x402.org/facilitator";
export const FAKE_PERMIT_SECRET = "00".repeat(31) + "01";
export const FAKE_ORIGIN = "http://127.0.0.1:4200";

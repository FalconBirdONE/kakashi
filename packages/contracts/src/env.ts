import { z } from "zod";

// SPEC §7.9. Each package parses only its own schema.
const assetMode = z.enum(["usdc", "hbar"]).default("usdc");
const acct = z.string().regex(/^\d+\.\d+\.\d+$/, "expected 0.0.x");
const atomic = z.string().regex(/^\d+$/);
const hex32 = z.string().regex(/^[0-9a-fA-F]{64}$/, "32 random bytes, hex");
const common = {
  HEDERA_NETWORK: z.literal("hedera:testnet").default("hedera:testnet"),
  ASSET_MODE: assetMode,
  USDC_TOKEN_ID: acct.default("0.0.429274"),
  FACILITATOR_URL: z.string().url().default("https://x402.org/facilitator"),
  FACILITATOR_FEEPAYER: acct.default("0.0.9185802"),
  AGENT_ACCOUNT_ID: acct,
  MERCHANT_QUICKCAST_PAYTO: acct,
  MERCHANT_HOURLYPRO_PAYTO: acct,
  MERCHANT_GROUNDTRUTH_PAYTO: acct,
  MERCHANT_GOUGER_PAYTO: acct,
};
const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

export const railsEnv = z.object({
  ...common,
  HEDERA_OPERATOR_ID: acct,
  HEDERA_OPERATOR_KEY: z.string().min(1),
  HCS_TOPIC_ID: acct,
  MERCHANTS_URL: z.string().url().default("http://127.0.0.1:4200"),
  MIRROR_NODE_URL: z.string().url().default("https://testnet.mirrornode.hedera.com"),
  SIGNER_URL: z.string().url().default("http://127.0.0.1:4100"),
  DEMO_MODE: bool,
});

// The signer holds the agent key and nothing else.
export const signerEnv = z.object({
  AGENT_PRIVATE_KEY: z.string().min(1),
  AGENT_ACCOUNT_ID: acct,
  PERMIT_SECRET: hex32,
  SIGNER_MAX_PER_TX_ATOMIC: atomic,
  SIGNER_MAX_TOTAL_ATOMIC: atomic,
  HEDERA_NETWORK: common.HEDERA_NETWORK,
});

export const brainEnv = z.object({
  ZG_BASE_URL: z.string().url().default("https://router-api.0g.ai/v1"),
  ZG_API_KEY: z.string().min(1),
  ZG_MODEL: z.string().min(1),
  ZG_TRUST_MODE: z.enum(["private", "verified", "standard"]).default("private"),
  ZG_VERIFY_TEE: bool.default(true),
});

export const trustEnv = z.object({
  ...common,
  PERMIT_SECRET: hex32,
  WORLD_ISSUER: z.string().url(),
  WORLD_CLIENT_ID: z.string().min(1),
  WORLD_CLIENT_SECRET: z.string().min(1),
  WORLD_REQUIRED_ACR: z.string().optional(),
  DB_PATH: z.string().default("./data/kakashi.sqlite"),
});

export const serverEnv = z.object({
  DEMO_MODE: bool,
  USE_REAL: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(["rails", "brain", "trust"]))),
  MERCHANTS_URL: z.string().url().default("http://127.0.0.1:4200"),
});

export type RailsEnv = z.infer<typeof railsEnv>;
export type SignerEnv = z.infer<typeof signerEnv>;
export type BrainEnv = z.infer<typeof brainEnv>;
export type TrustEnv = z.infer<typeof trustEnv>;
export type ServerEnv = z.infer<typeof serverEnv>;

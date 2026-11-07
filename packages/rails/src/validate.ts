import { z } from "zod";
import { getMerchant } from "@kakashi/contracts";

const base = z.object({
  merchant: z.string(),
  source: z.enum(["hedera-mainnet-mirror", "fixture"]),
  tokenId: z.string().regex(/^0\.0\.\d{1,10}$/),
  generatedAt: z.string().datetime(),
  flags: z.array(z.string()),
  note: z.string().optional(),
});

const tokenKeys = z.object({
  name: z.string(), symbol: z.string(), decimals: z.union([z.number(), z.string()]),
  totalSupply: z.string(), maxSupply: z.string(), supplyType: z.string(), treasury: z.string().nullable(),
  createdAt: z.string().nullable(), memo: z.string(), pauseStatus: z.string(),
  keys: z.object({
    admin: z.boolean(), freeze: z.boolean(), wipe: z.boolean(), supply: z.boolean(),
    pause: z.boolean(), kyc: z.boolean(), feeSchedule: z.boolean(),
  }).passthrough(),
  customFees: z.object({ fixed: z.number(), fractional: z.number(), royalty: z.number() }).passthrough(),
}).passthrough().nullable();

const holders = z.object({
  thresholdPct: z.literal(1),
  whales: z.array(z.object({ account: z.string(), balance: z.string(), pct: z.number() }).passthrough()),
  whaleCount: z.number(),
  whaleSharePct: z.number(),
  treasurySharePct: z.number(),
}).passthrough();

const treasury = z.object({
  account: z.string().nullable(),
  sampled: z.number(),
  mints: z.array(z.object({ timestamp: z.string(), amount: z.string() }).passthrough()),
  outflows: z.array(z.object({ timestamp: z.string(), amount: z.string(), to: z.string() }).passthrough()),
  outflowTotal: z.string(),
}).passthrough();

// One schema per registry responseSchemaId (contract item 6).
export const RESPONSE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "token-keys.v1": base.extend({ token: tokenKeys }),
  "token-holders.v1": base.extend({ holders }),
  "token-treasury.v1": base.extend({ treasury }),
  "token-alpha.v1": base.extend({ token: tokenKeys }),
};

const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function validateDelivery(
  merchantId: string, query: Record<string, string>, body: unknown, now: Date,
): { valid: boolean; issues: string[] } {
  const m = getMerchant(merchantId);
  if (!m) return { valid: false, issues: [`unknown merchant ${merchantId}`] };
  const schema = RESPONSE_SCHEMAS[m.responseSchemaId];
  if (!schema) return { valid: false, issues: [`no schema for ${m.responseSchemaId}`] };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { valid: false, issues: parsed.error.issues.map((i) => `schema: ${i.path.join(".") || "body"} ${i.message}`) };
  }
  const b = parsed.data as z.infer<typeof base>;
  const issues: string[] = [];

  if (b.merchant !== m.id) issues.push(`wrong merchant: ${b.merchant}`);
  if (b.tokenId !== query.tokenId) issues.push(`wrong token: ${b.tokenId}, requested ${query.tokenId}`);

  const ageMs = now.getTime() - Date.parse(b.generatedAt);
  if (ageMs < -MAX_CLOCK_SKEW_MS) issues.push("generatedAt is in the future");
  else if (m.freshnessSeconds > 0 && ageMs > m.freshnessSeconds * 1000) {
    issues.push(`stale data: generated ${Math.round(ageMs / 1000)} s ago (max ${m.freshnessSeconds} s)`);
  }

  return { valid: issues.length === 0, issues };
}

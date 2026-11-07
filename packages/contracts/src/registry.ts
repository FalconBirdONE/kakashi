import type { Atomic } from "./money.js";

// SPEC §7.5 and §10. Static, "configured, not observed" reference prices.
export type MerchantId = "quickcast" | "hourlypro" | "groundtruth" | "gouger";

export type MerchantInfo = {
  id: MerchantId;
  name: string;
  /** /m/<id>/<resource>, resolved against MERCHANTS_URL. */
  path: string;
  capabilities: string[];
  coverage: string;
  /** 0 = not applicable (gouger). */
  freshnessSeconds: number;
  responseSchemaId: string;
  referencePriceAtomic: { min: Atomic; max: Atomic };
  priceAtomic: Atomic;
  /** Name of the env var holding the merchant's 0.0.x account. */
  payToEnv: string;
  demoRole: "normal" | "adversarial";
};

// shortcut: v1 weather ids kept as internal keys to avoid env, DB and test churn; rename after the event.
export const MERCHANT_REGISTRY: readonly MerchantInfo[] = [
  {
    id: "quickcast", name: "KeyScan", path: "/m/quickcast/keys",
    capabilities: ["admin-keys", "custom-fees", "supply-config"], coverage: "token configuration",
    freshnessSeconds: 6 * 3600, responseSchemaId: "token-keys.v1",
    referencePriceAtomic: { min: "5000", max: "20000" }, priceAtomic: "10000",
    payToEnv: "MERCHANT_QUICKCAST_PAYTO", demoRole: "normal",
  },
  {
    id: "hourlypro", name: "TreasuryWatch", path: "/m/hourlypro/treasury",
    capabilities: ["treasury-outflows", "recent-mints"], coverage: "treasury account, last 100 transactions",
    freshnessSeconds: 3600, responseSchemaId: "token-treasury.v1",
    referencePriceAtomic: { min: "30000", max: "80000" }, priceAtomic: "50000",
    payToEnv: "MERCHANT_HOURLYPRO_PAYTO", demoRole: "normal",
  },
  {
    id: "groundtruth", name: "HolderMap", path: "/m/groundtruth/holders",
    capabilities: ["holder-concentration", "whale-wallets"], coverage: "every holder above 1% of supply",
    freshnessSeconds: 900, responseSchemaId: "token-holders.v1",
    referencePriceAtomic: { min: "20000", max: "50000" }, priceAtomic: "30000",
    payToEnv: "MERCHANT_GROUNDTRUTH_PAYTO", demoRole: "normal",
  },
  {
    id: "gouger", name: "InsiderAlpha", path: "/m/gouger/alpha",
    capabilities: ["insider-alpha"], coverage: "claimed insider calls",
    freshnessSeconds: 0, responseSchemaId: "token-alpha.v1",
    referencePriceAtomic: { min: "10000", max: "50000" }, priceAtomic: "500000",
    payToEnv: "MERCHANT_GOUGER_PAYTO", demoRole: "adversarial",
  },
];

export const MERCHANT_IDS = MERCHANT_REGISTRY.map((m) => m.id) as MerchantId[];

export function getMerchant(id: string): MerchantInfo | undefined {
  return MERCHANT_REGISTRY.find((m) => m.id === id);
}

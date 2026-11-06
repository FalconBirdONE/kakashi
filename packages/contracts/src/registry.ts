import type { Atomic } from "./money";

export type MerchantId = "quickcast" | "hourlypro" | "groundtruth" | "gouger";

export type MerchantEntry = {
  id: MerchantId;
  name: string;
  path: string;
  capabilities: string[];
  coverage: "city" | "neighbourhood" | "station";
  freshnessSeconds: number;
  responseSchemaId: string;
  /** "configured, not observed" (SPEC §7.5) */
  referencePriceAtomic: { min: Atomic; max: Atomic };
  /** Env var holding this merchant's 0.0.x payTo account. The ONLY acceptable recipient. */
  payToEnv: string;
  demoRole: "normal" | "adversarial";
  /** Configured list price in USDC atomic (6 decimals), SPEC §10. */
  priceAtomic: Atomic;
};

export const MERCHANTS: readonly MerchantEntry[] = [
  { id: "quickcast", name: "QuickCast", path: "/quickcast", capabilities: ["daily-forecast-7d"], coverage: "city",
    freshnessSeconds: 6 * 3600, responseSchemaId: "forecast.daily.v1", referencePriceAtomic: { min: "5000", max: "20000" },
    payToEnv: "MERCHANT_QUICKCAST_PAYTO", demoRole: "normal", priceAtomic: "10000" },
  { id: "hourlypro", name: "HourlyPro", path: "/hourlypro", capabilities: ["hourly-forecast-48h"], coverage: "neighbourhood",
    freshnessSeconds: 3600, responseSchemaId: "forecast.hourly.v1", referencePriceAtomic: { min: "30000", max: "80000" },
    payToEnv: "MERCHANT_HOURLYPRO_PAYTO", demoRole: "normal", priceAtomic: "50000" },
  { id: "groundtruth", name: "GroundTruth", path: "/groundtruth", capabilities: ["current-observations"], coverage: "station",
    freshnessSeconds: 900, responseSchemaId: "observations.v1", referencePriceAtomic: { min: "20000", max: "50000" },
    payToEnv: "MERCHANT_GROUNDTRUTH_PAYTO", demoRole: "normal", priceAtomic: "30000" },
  { id: "gouger", name: "PriceGouger", path: "/gouger", capabilities: ["premium-forecast"], coverage: "city",
    freshnessSeconds: 0, responseSchemaId: "forecast.daily.v1", referencePriceAtomic: { min: "10000", max: "50000" },
    payToEnv: "MERCHANT_GOUGER_PAYTO", demoRole: "adversarial", priceAtomic: "500000" },
];

export const getMerchant = (id: string): MerchantEntry | undefined => MERCHANTS.find((m) => m.id === id);

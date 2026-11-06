import { z } from "zod";
import { getMerchant } from "@tollbooth/contracts";

const base = z.object({
  merchant: z.string(),
  source: z.string(),
  location: z.object({ lat: z.number(), lon: z.number(), name: z.string() }),
  window: z.object({ start: z.string(), end: z.string() }),
  generatedAt: z.string().datetime(),
  units: z.string(),
});
const series = z.object({ time: z.array(z.string()).min(1) }).passthrough();

// One schema per registry responseSchemaId (SPEC §7.5).
export const RESPONSE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "daily-forecast.v1": base.extend({ daily: series }),
  "hourly-forecast.v1": base.extend({ hourly: series }),
  "observations.v1": base.extend({ current: z.object({ time: z.string() }).passthrough() }),
  "premium-forecast.v1": base.extend({ daily: series }),
};

const MAX_DISTANCE_KM = 10;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

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

  const qLat = Number(query.lat);
  const qLon = Number(query.lon);
  if (Number.isFinite(qLat) && Number.isFinite(qLon)) {
    const km = distanceKm(qLat, qLon, b.location.lat, b.location.lon);
    if (km > MAX_DISTANCE_KM) issues.push(`wrong location: ${km.toFixed(1)} km from the requested point (max ${MAX_DISTANCE_KM} km)`);
  }

  // ISO dates compare correctly as strings.
  if (query.startDate && b.window.start > query.startDate) issues.push(`window starts ${b.window.start}, after requested ${query.startDate}`);
  if (query.endDate && b.window.end < query.endDate) issues.push(`window ends ${b.window.end}, before requested ${query.endDate}`);

  const ageMs = now.getTime() - Date.parse(b.generatedAt);
  if (ageMs < -MAX_CLOCK_SKEW_MS) issues.push("generatedAt is in the future");
  else if (m.freshnessSeconds > 0 && ageMs > m.freshnessSeconds * 1000) {
    issues.push(`stale data: generated ${Math.round(ageMs / 1000)} s ago (max ${m.freshnessSeconds} s)`);
  }

  if (b.units !== "metric") issues.push(`unexpected units: ${b.units} (declared metric)`);
  return { valid: issues.length === 0, issues };
}

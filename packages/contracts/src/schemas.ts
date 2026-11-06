import { z } from "zod";

// Brain output schemas (SPEC §9.2), strict. DecideOutput's quoteId enum is built per call from the given IDs.
export const NeedSchema = z.strictObject({
  needId: z.string(), description: z.string(), priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export const PlanOutputSchema = z.strictObject({
  needs: z.array(NeedSchema),
  query: z.strictObject({ lat: z.number(), lon: z.number(), startDate: z.string(), endDate: z.string() }),
});

export const decideOutputSchema = (quoteIds: [string, ...string[]]) =>
  z.strictObject({
    decisions: z.array(z.strictObject({
      quoteId: z.enum(quoteIds),
      action: z.enum(["BUY", "SKIP"]),
      reasonCode: z.enum(["FILLS_NEED", "REDUNDANT", "TOO_EXPENSIVE_FOR_VALUE", "LOW_RELEVANCE", "CORROBORATES_CONFLICT"]),
      needId: z.string(),
      expectedUsefulness: z.number().min(0).max(1),
      rationale: z.string().max(200),
    })),
    stop: z.boolean(),
  });

export const SynthesisOutputSchema = z.strictObject({
  answer: z.string().max(1200),
  confidence: z.enum(["low", "medium", "high"]),
  citations: z.array(z.string()),
  disagreements: z.array(z.string()),
  gaps: z.array(z.string()),
  suspiciousContent: z.array(z.string()),
});

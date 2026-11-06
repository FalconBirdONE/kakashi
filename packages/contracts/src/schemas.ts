import { z } from "zod";

// SPEC §9.2. Built per call so quoteId / merchantId are closed enums of server-issued ids.
const enumOf = (ids: readonly string[]) => z.enum(ids as [string, ...string[]]);

export const planOutputSchema = (_merchantIds: readonly string[] = []) =>
  z.object({
    needs: z.array(z.object({
      needId: z.string().min(1),
      description: z.string().min(1).max(300),
      priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    }).strict()).min(1).max(5),
    query: z.object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      startDate: z.string(),
      endDate: z.string(),
    }).strict(),
  }).strict();

export const decideOutputSchema = (quoteIds: readonly string[], needIds: readonly string[] = []) =>
  z.object({
    decisions: z.array(z.object({
      quoteId: enumOf(quoteIds),
      action: z.enum(["BUY", "SKIP"]),
      reasonCode: z.enum(["FILLS_NEED", "REDUNDANT", "TOO_EXPENSIVE_FOR_VALUE", "LOW_RELEVANCE", "CORROBORATES_CONFLICT"]),
      needId: needIds.length ? enumOf(needIds) : z.string(),
      expectedUsefulness: z.number().min(0).max(1),
      rationale: z.string().max(200),
    }).strict()),
    stop: z.boolean(),
  }).strict();

/** purchaseIds restricts citations to ids actually supplied as evidence. */
export const synthesisOutputSchema = (purchaseIds: readonly string[]) =>
  z.object({
    answer: z.string().max(1200),
    confidence: z.enum(["low", "medium", "high"]),
    citations: z.array(purchaseIds.length ? enumOf(purchaseIds) : z.never()),
    disagreements: z.array(z.string()),
    gaps: z.array(z.string()),
    suspiciousContent: z.array(z.string()),
  }).strict();

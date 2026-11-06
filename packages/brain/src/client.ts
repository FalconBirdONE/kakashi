import OpenAI from "openai";
import type { z } from "zod";
import { sha256Hex } from "@tollbooth/contracts";
import type { BrainError, InferenceKind, InferenceTrace, Traced } from "@tollbooth/contracts";

export type CallOpts<T> = { kind: InferenceKind; system: string; user: string; schema: z.ZodType<T>; maxTokens?: number };
export type ClientDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

type Tier = InferenceTrace["trustTier"];
type Msg = { role: "system" | "user" | "assistant"; content: string };
type Raw = { content: string; requestId: string; provider: string; teeVerified: boolean | null; cost: number; latencyMs: number };
type Fail = { error: BrainError; trace?: InferenceTrace };

const TIERS: readonly string[] = ["private", "verified", "standard"];
const NO_PROVIDER = "no_provider_for_trust_mode";
const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One structured 0G call. Fails closed; never downgrades the trust tier; never fabricates a request id. */
export async function callStructured<T>(o: CallOpts<T>, deps: ClientDeps = {}): Promise<Traced<T>> {
  const env = deps.env ?? process.env;
  const model = env.ZG_MODEL, apiKey = env.ZG_API_KEY, mode = env.ZG_TRUST_MODE ?? "private";
  const verify = (env.ZG_VERIFY_TEE ?? "true") !== "false";
  const t0 = Date.now();
  const done = (result: string, requestId?: string) =>
    // Only metadata is ever logged: no prompts, responses or keys.
    console.info(JSON.stringify({ at: "brain.client", kind: o.kind, model, requestId, latencyMs: Date.now() - t0, result }));
  const fail = (f: Fail): Traced<T> => { done(f.error, f.trace?.zgRequestId); return { ok: false, ...f }; };

  if (!apiKey || !model || !TIERS.includes(mode)) return fail({ error: "ZG_UNAVAILABLE" });
  const tier = mode as Tier;

  const client = new OpenAI({
    apiKey, baseURL: env.ZG_BASE_URL ?? "https://router-api.0g.ai/v1", maxRetries: 0,
    timeout: deps.timeoutMs ?? 30_000, fetch: deps.fetch,
    defaultHeaders: { "X-0G-Provider-Trust-Mode": mode },
  });
  const sleep = deps.sleep ?? sleepReal;

  const call = async (messages: Msg[]): Promise<Raw | Fail> => {
    for (let attempt = 0; ; attempt++) {
      const start = Date.now();
      try {
        const { data } = await client.chat.completions
          .create({
            model, temperature: 0.2, messages, max_tokens: o.maxTokens,
            verify_tee: verify, // extra body field: the SDK serialises the body whole (see docs/brain/SPIKE.md)
            ...(env.ZG_JSON_MODE === "true" ? { response_format: { type: "json_object" } } : {}),
          } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
          .withResponse();
        const t = (data as unknown as { x_0g_trace?: { request_id?: string; provider?: string; tee_verified?: boolean | null; billing?: { total_cost?: string | number } } }).x_0g_trace;
        const content = data.choices[0]?.message?.content ?? "";
        if (!t?.request_id) return { error: "ZG_UNAVAILABLE" };
        const raw: Raw = {
          content, requestId: t.request_id, provider: t.provider ?? "unknown", teeVerified: t.tee_verified ?? null,
          cost: Number(t.billing?.total_cost ?? 0) || 0, latencyMs: Date.now() - start,
        };
        if (raw.teeVerified === false || (verify && raw.teeVerified !== true)) {
          // Discard the content: only the trace survives.
          return { error: "TEE_NOT_VERIFIED", trace: traceOf(raw, raw) };
        }
        return raw;
      } catch (e) {
        if (e instanceof OpenAI.APIConnectionTimeoutError) return { error: "TIMEOUT" };
        if (e instanceof OpenAI.APIError && e.status === 503 && JSON.stringify(e.error ?? e.message).includes(NO_PROVIDER)) {
          if (attempt >= 2) return { error: "NO_PROVIDER_FOR_TRUST_MODE" };
          await sleep(2000);
          continue;
        }
        return { error: "ZG_UNAVAILABLE" };
      }
    }
  };

  const traceOf = (first: Raw, last: Raw, extra?: Raw): InferenceTrace => ({
    model, trustTier: tier, zgRequestId: last.requestId, provider: last.provider, teeVerified: last.teeVerified,
    totalCost: String(first.cost + (extra?.cost ?? 0)), latencyMs: first.latencyMs + (extra?.latencyMs ?? 0),
    inputHash: sha256Hex({ system: o.system, user: o.user }), outputHash: sha256Hex(last.content),
  });

  const parse = (content: string): { ok: true; value: T } | { ok: false; why: string } => {
    let json: unknown;
    try { json = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
    catch { return { ok: false, why: "output was not valid JSON" }; }
    const r = o.schema.safeParse(json);
    return r.success ? { ok: true, value: r.data } : { ok: false, why: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  };

  const messages: Msg[] = [{ role: "system", content: o.system }, { role: "user", content: o.user }];
  const a = await call(messages);
  if ("error" in a) return fail(a);
  const p = parse(a.content);
  if (p.ok) { done("ok", a.requestId); return { ok: true, value: p.value, trace: traceOf(a, a) }; }

  // One repair attempt: send the validation error back, then give up.
  const b = await call([...messages, { role: "assistant", content: a.content },
    { role: "user", content: `Your previous output was rejected: ${p.why}. Reply again with only the corrected JSON.` }]);
  if ("error" in b) return fail({ error: b.error, trace: b.trace });
  const p2 = parse(b.content);
  const trace = traceOf(a, b, b);
  if (p2.ok) { done("ok_after_repair", b.requestId); return { ok: true, value: p2.value, trace }; }
  return fail({ error: "SCHEMA_INVALID", trace });
}

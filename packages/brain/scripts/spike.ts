// Spike S2: prove a private, TEE-verified 0G Router call and pick ZG_MODEL.
// Run: cd packages/brain && npx tsx --env-file-if-exists=../../.env scripts/spike.ts
import OpenAI from "openai";

const baseURL = process.env.ZG_BASE_URL ?? "https://router-api.0g.ai/v1";
const apiKey = process.env.ZG_API_KEY;
if (!apiKey) { console.error("ZG_API_KEY is not set (put it in ../../.env or export it). Nothing was called."); process.exit(2); }

type Model = { id: string; verifiability?: string | string[] };
const hasTeeML = (m: Model) => [m.verifiability].flat().includes("TeeML");

const res = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
if (!res.ok) { console.error(`GET /models -> ${res.status}`); process.exit(1); }
const models = ((await res.json()) as { data: Model[] }).data;
for (const m of models) console.log(`${m.id}\t${[m.verifiability].flat().join(",") || "-"}`);
const candidates = models.filter(hasTeeML);
console.log(`\nTeeML models: ${candidates.map((m) => m.id).join(", ") || "none"}`);

const client = new OpenAI({ apiKey, baseURL, timeout: 30_000, maxRetries: 0 });
const rows: Record<string, unknown>[] = [];

for (const m of candidates.slice(0, 3)) {
  const t0 = Date.now();
  try {
    const { data, response } = await client.chat.completions
      .create(
        {
          model: m.id,
          temperature: 0.2,
          messages: [{ role: "user", content: 'Reply with only this JSON, no prose: {"ok": true, "n": 3}' }],
          verify_tee: true, // extra body field: the SDK serialises the whole body object as given
        } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        { headers: { "X-0G-Provider-Trust-Mode": "private" } },
      )
      .withResponse();
    const latencyMs = Date.now() - t0;
    const trace = (data as unknown as { x_0g_trace?: Record<string, any> }).x_0g_trace ?? {};
    const text = data.choices[0]?.message?.content ?? "";
    let json = false;
    try { JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); json = true; } catch {}
    const row = {
      model: m.id, latencyMs, request_id: trace.request_id ?? null, provider: trace.provider ?? null,
      billing: trace.billing ?? null, tee_verified: trace.tee_verified ?? null,
      zg_res_key: response.headers.get("ZG-Res-Key"), json,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  } catch (e) {
    const err = e as { status?: number; error?: { code?: string }; message?: string };
    const row = { model: m.id, latencyMs: Date.now() - t0, status: err.status ?? null, code: err.error?.code ?? null, error: err.message };
    rows.push(row);
    if (err.status === 503 && err.error?.code === "no_provider_for_trust_mode")
      console.log(`${m.id}: 503 no_provider_for_trust_mode (no TeeML provider available right now; the Router will not downgrade)`);
    else console.log(JSON.stringify(row));
  }
}

const best = rows.filter((r) => r.tee_verified === true && r.json && r.request_id).sort((a, b) => Number(a.latencyMs) - Number(b.latencyMs))[0];
console.log(best ? `\nCHOSEN ZG_MODEL=${best.model}` : "\nNo model passed (request_id + tee_verified=true + valid JSON).");
process.exit(best ? 0 : 1);

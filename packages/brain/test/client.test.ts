import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "@tollbooth/contracts";
import { callStructured } from "../src/client";

const KEY = "sk-secret-key-123";
const SYSTEM = "you are a planner";
const USER = "UNIQUE-PROMPT-TEXT-xyz";
const schema = z.object({ a: z.number() });
const good = JSON.stringify({ a: 1 });
const baseEnv = { ZG_BASE_URL: "https://zg.test/v1", ZG_API_KEY: KEY, ZG_MODEL: "m-1" };

const okBody = (o: Record<string, any> = {}, content = good) => ({
  id: "c1",
  object: "chat.completion",
  model: "m-1",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  x_0g_trace: {
    request_id: "req-1",
    provider: "0xprov",
    billing: { input_cost: "0.001", output_cost: "0.002", total_cost: "0.003" },
    tee_verified: true,
    ...o,
  },
  ...{},
});
const jsonResp = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noProvider = () => jsonResp(503, { error: { code: "no_provider_for_trust_mode", message: "none" } });

// Responses are consumed in order; the last one repeats.
function mockFetch(...steps: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: any; body: any }> = [];
  const fn = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return steps[Math.min(calls.length - 1, steps.length - 1)]!();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const reply = (content: string, trace: Record<string, any> = {}) => () => jsonResp(200, okBody(trace, content));
const hdr = (init: any, k: string) => new Headers(init.headers).get(k);

function run(f: typeof fetch, env: Record<string, string | undefined> = {}, extra: object = {}) {
  const sleep = vi.fn(async () => {});
  const p = callStructured(
    { kind: "PLAN", system: SYSTEM, user: USER, schema, maxTokens: 123 },
    { env: { ...baseEnv, ...env }, fetch: f, sleep, ...extra },
  );
  return { p, sleep };
}

afterEach(() => vi.restoreAllMocks());

describe("callStructured", () => {
  it("happy path: request shape and trace", async () => {
    const m = mockFetch(reply(good));
    const r = await run(m.fn).p;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ a: 1 });
    expect(m.calls).toHaveLength(1);
    const { url, init, body } = m.calls[0]!;
    expect(url).toBe("https://zg.test/v1/chat/completions");
    expect(hdr(init, "X-0G-Provider-Trust-Mode")).toBe("private");
    expect(body).toMatchObject({ model: "m-1", temperature: 0.2, verify_tee: true, max_tokens: 123 });
    expect(body.messages).toEqual([
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ]);
    expect(r.trace).toMatchObject({
      model: "m-1",
      trustTier: "private",
      zgRequestId: "req-1",
      provider: "0xprov",
      teeVerified: true,
      totalCost: "0.003",
      inputHash: sha256Hex(canonicalJson({ system: SYSTEM, user: USER })),
      outputHash: sha256Hex(good),
    });
    expect(typeof r.trace.latencyMs).toBe("number");
  });

  it("verified trust mode is sent and traced", async () => {
    const m = mockFetch(reply(good));
    const r = await run(m.fn, { ZG_TRUST_MODE: "verified" }).p;
    expect(hdr(m.calls[0]!.init, "X-0G-Provider-Trust-Mode")).toBe("verified");
    expect(r.ok && r.trace.trustTier).toBe("verified");
  });

  it("503 no_provider retries twice then NO_PROVIDER_FOR_TRUST_MODE, never downgrades", async () => {
    const m = mockFetch(noProvider);
    const { p, sleep } = run(m.fn);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("NO_PROVIDER_FOR_TRUST_MODE");
    expect(m.calls).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[2000], [2000]]);
    for (const c of m.calls) expect(hdr(c.init, "X-0G-Provider-Trust-Mode")).toBe("private");
  });

  it("503 then success returns ok", async () => {
    const m = mockFetch(noProvider, reply(good));
    const { p, sleep } = run(m.fn);
    expect((await p).ok).toBe(true);
    expect(m.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("tee_verified:false -> TEE_NOT_VERIFIED, content withheld", async () => {
    const r = await run(mockFetch(reply(good, { tee_verified: false })).fn).p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("TEE_NOT_VERIFIED");
    expect("value" in r).toBe(false);
  });

  it("tee_verified missing while verifying -> TEE_NOT_VERIFIED", async () => {
    const r = await run(mockFetch(reply(good, { tee_verified: undefined })).fn).p;
    expect(!r.ok && r.error).toBe("TEE_NOT_VERIFIED");
    expect("value" in r).toBe(false);
  });

  it("ZG_VERIFY_TEE=false sends verify_tee:false and tolerates missing tee_verified", async () => {
    const m = mockFetch(reply(good, { tee_verified: undefined }));
    const r = await run(m.fn, { ZG_VERIFY_TEE: "false" }).p;
    expect(m.calls[0]!.body.verify_tee).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("missing request_id -> ZG_UNAVAILABLE without trace", async () => {
    const r = await run(mockFetch(reply(good, { request_id: undefined })).fn).p;
    expect(!r.ok && r.error).toBe("ZG_UNAVAILABLE");
    expect(r.ok ? undefined : r.trace).toBeUndefined();
  });

  it("HTTP 500 -> ZG_UNAVAILABLE", async () => {
    const r = await run(mockFetch(() => jsonResp(500, { error: { message: "boom" } })).fn).p;
    expect(!r.ok && r.error).toBe("ZG_UNAVAILABLE");
  });

  it("fetch rejecting -> ZG_UNAVAILABLE", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const r = await run(f).p;
    expect(!r.ok && r.error).toBe("ZG_UNAVAILABLE");
  });

  it("hanging fetch -> TIMEOUT", async () => {
    const f = vi.fn(
      (_u: any, init: any) =>
        new Promise<Response>((_res, rej) =>
          init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))),
        ),
    ) as unknown as typeof fetch;
    const r = await run(f, {}, { timeoutMs: 50 }).p;
    expect(!r.ok && r.error).toBe("TIMEOUT");
  });

  it.each([
    ["invalid JSON", "not json{"],
    ["schema failure", JSON.stringify({ a: "x" })],
  ])("%s -> one repair call then success", async (_n, bad) => {
    const m = mockFetch(reply(bad), reply(good, { request_id: "req-2" }));
    const r = await run(m.fn).p;
    expect(m.calls).toHaveLength(2);
    const msgs = m.calls[1]!.body.messages as Array<{ role: string; content: string }>;
    expect(msgs.some((x) => x.role === "assistant" && x.content === bad)).toBe(true);
    const last = msgs[msgs.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content).toMatch(/invalid|error|valid/i);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ a: 1 });
    expect(r.trace.zgRequestId).toBe("req-2");
    expect(Number(r.trace.totalCost)).toBeCloseTo(0.006);
    expect(r.trace.inputHash).toBe(sha256Hex(canonicalJson({ system: SYSTEM, user: USER })));
    expect(r.trace.outputHash).toBe(sha256Hex(good));
  });

  it("two bad outputs -> SCHEMA_INVALID after exactly 2 calls", async () => {
    const m = mockFetch(reply("nope"), reply(JSON.stringify({ a: "still bad" })));
    const r = await run(m.fn).p;
    expect(!r.ok && r.error).toBe("SCHEMA_INVALID");
    expect(m.calls).toHaveLength(2);
  });

  it("never leaks the API key or logs the prompt", async () => {
    const spies = (["log", "info", "error", "warn", "debug"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {}),
    );
    const results = [
      await run(mockFetch(reply(good)).fn).p,
      await run(mockFetch(reply("bad"), reply("bad")).fn).p,
      await run(mockFetch(() => jsonResp(500, {})).fn).p,
    ];
    for (const r of results) expect(JSON.stringify(r)).not.toContain(KEY);
    for (const s of spies)
      for (const call of s.mock.calls) {
        const text = JSON.stringify(call);
        expect(text).not.toContain(USER);
        expect(text).not.toContain(KEY);
      }
  });
});

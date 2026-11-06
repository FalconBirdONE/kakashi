import { describe, expect, it, vi } from "vitest";
import type { Brain, RunView } from "@tollbooth/contracts";
import { activateMandate, makeServer, type Server } from "./helpers.js";

const run = async (s: Server, question = "Will it rain in Mumbai this week?") => {
  const { runId } = (await s.agent.post("/api/runs").send({ question }).expect(202)).body;
  await s.ctx.whenIdle();
  return { runId: runId as string, view: (await s.agent.get(`/api/runs/${runId}`).expect(200)).body as RunView };
};
const merchantOf = (v: RunView, qid: string) => v.quotes.find((q) => q.id === qid)?.merchantId;
const fault = (s: Server, merchantId: string, f: string) => s.agent.post("/api/demo/fault").send({ merchantId, fault: f }).expect(200);

/** Brain whose decide says BUY for the named merchants (or all offered quotes), then stops. */
const buying = (only?: string[]) => (b: ReturnType<typeof import("@tollbooth/contracts").createFakeBrain>): Brain => ({
  ...b,
  plan: (i) => b.plan(i),
  synthesize: (i) => b.synthesize(i),
  decide: async (i) => {
    const r = await b.decide(i);
    if (!r.ok) return r;
    return {
      ...r,
      value: {
        stop: true,
        decisions: i.quotes.map((q) => ({
          quoteId: q.quoteId, action: !only || only.includes(q.merchantId) ? ("BUY" as const) : ("SKIP" as const),
          reasonCode: "FILLS_NEED" as const, needId: i.needs[0]!.needId, expectedUsefulness: 0.9, rationale: "test",
        })),
      },
    };
  },
});

describe("research run on fakes", () => {
  it("happy path: auto-approved purchase is CONFIRMED + RECEIVED_VALID and the run is DONE", async () => {
    const s = await makeServer();
    await activateMandate(s);
    const { view } = await run(s);
    expect(view.run.state).toBe("DONE");
    expect(view.run.answer?.citations.length).toBe(1);
    const bought = view.purchases.filter((p) => p.state === "CONFIRMED");
    expect(bought).toHaveLength(1);
    expect(merchantOf(view, bought[0]!.quoteId)).toBe("quickcast");
    expect(bought[0]!.delivery).toBe("RECEIVED_VALID");
    expect(bought[0]!.hederaTxId).toMatch(/^0\.0\.9999@/);
    expect(view.inferenceCalls.map((c) => c.kind)).toEqual(["PLAN", "DECIDE", "SYNTHESIZE"]);
    const l = (await s.agent.get("/api/ledger")).body;
    expect([l.spentAtomic, l.reservedAtomic, l.dataSpendAtomic]).toEqual(["10000", "0", "10000"]);
  });

  it("the gouger quote is rejected by policy and never reaches brain.decide", async () => {
    const s = await makeServer();
    const spy = vi.spyOn(s.deps.brain, "decide");
    await activateMandate(s);
    const { view } = await run(s);
    const g = view.quotes.find((q) => q.merchantId === "gouger")!;
    expect(g.policyResult?.allowed).toBe(false);
    expect(g.policyResult?.reasons).toEqual(expect.arrayContaining(["OVER_PER_PAYMENT_CAP", "PRICE_ANOMALY"]));
    const offered = spy.mock.calls.flatMap(([i]) => i.quotes.map((q) => q.merchantId));
    expect(offered).not.toContain("gouger");
    expect(offered.length).toBeGreaterThan(0);
    expect(view.purchases.some((p) => p.quoteId === g.id)).toBe(false);
  });

  it("maxPurchasesPerRun=1 with BUY on everything: one purchase, the rest MAX_PURCHASES_REACHED", async () => {
    const s = await makeServer({ brain: buying() });
    await activateMandate(s, { maxPurchasesPerRun: 1 });
    const { view } = await run(s);
    const states = view.purchases.map((p) => p.state);
    expect(states.filter((x) => x === "CONFIRMED")).toHaveLength(1);
    const rejected = view.purchases.filter((p) => p.state === "POLICY_REJECTED");
    expect(rejected.length).toBe(states.length - 1);
    expect(rejected.length).toBeGreaterThan(0);
    for (const p of rejected) expect(p.policyResult?.reasons).toContain("MAX_PURCHASES_REACHED");
  });

  it("above-threshold purchase waits for approval, then pays once approved", async () => {
    const s = await makeServer({ brain: buying(["hourlypro"]) });
    await activateMandate(s);
    const { runId, view } = await run(s);
    const p = view.purchases.find((x) => merchantOf(view, x.quoteId) === "hourlypro")!;
    expect(p.state).toBe("AWAITING_APPROVAL");
    expect(view.run.state).toBe("PARTIAL");
    expect((await s.agent.get("/api/ledger")).body.reservedAtomic).toBe("50000");

    const att = (await s.agent.post(`/api/purchases/${p.id}/approve`).expect(202)).body;
    await s.agent.post(`/api/dev/complete-auth/${att.id}`).send({ result: "VERIFIED" }).expect(200);
    await s.ctx.whenIdle();
    const after = (await s.agent.get(`/api/runs/${runId}`)).body as RunView;
    const done = after.purchases.find((x) => x.id === p.id)!;
    expect(done.state).toBe("CONFIRMED");
    expect(done.delivery).toBe("RECEIVED_VALID");
    const l = (await s.agent.get("/api/ledger")).body;
    expect([l.spentAtomic, l.reservedAtomic]).toEqual(["50000", "0"]);
    await s.agent.post(`/api/purchases/${p.id}/approve`).expect(409); // no second approval / payment
  });

  it("a denied approval releases the budget", async () => {
    const s = await makeServer({ brain: buying(["hourlypro"]) });
    await activateMandate(s);
    const { runId, view } = await run(s);
    const p = view.purchases.find((x) => x.state === "AWAITING_APPROVAL")!;
    const att = (await s.agent.post(`/api/purchases/${p.id}/approve`).expect(202)).body;
    await s.agent.post(`/api/dev/complete-auth/${att.id}`).send({ result: "DENIED" }).expect(200);
    await s.ctx.whenIdle();
    const after = (await s.agent.get(`/api/runs/${runId}`)).body as RunView;
    expect(after.purchases.find((x) => x.id === p.id)!.state).toBe("APPROVAL_DENIED");
    const l = (await s.agent.get("/api/ledger")).body;
    expect([l.spentAtomic, l.reservedAtomic]).toEqual(["0", "0"]);
  });

  it("DROP_AFTER_SETTLE ends UNKNOWN with exactly one signPayment call", async () => {
    const s = await makeServer();
    const sign = vi.spyOn(s.deps.rails, "signPayment");
    await activateMandate(s);
    await fault(s, "quickcast", "DROP_AFTER_SETTLE");
    const { view } = await run(s);
    expect(sign).toHaveBeenCalledTimes(1);
    const p = view.purchases.find((x) => merchantOf(view, x.quoteId) === "quickcast")!;
    expect(p.state).toBe("UNKNOWN");
    expect(p.hederaTxId).toBeTruthy();
    expect(view.run.state).toBe("PARTIAL");
    expect((await s.agent.get("/api/ledger")).body.reservedAtomic).toBe("10000"); // UNKNOWN keeps the reservation
  });

  it("brain failure after a purchase was submitted: run is PARTIAL and the purchase is untouched", async () => {
    const s = await makeServer({
      brain: (b) => ({ ...b, plan: (i) => b.plan(i), synthesize: (i) => b.synthesize(i),
        decide: async (i) => { const r = await b.decide(i); b.failNext("ZG_UNAVAILABLE"); return r; } }),
    });
    await activateMandate(s);
    const { view } = await run(s);
    expect(view.run.state).toBe("PARTIAL");
    expect(view.run.failureReason).toBe("SYNTHESIZE_ZG_UNAVAILABLE");
    expect(view.run.answer).toBeUndefined();
    expect(view.purchases.filter((p) => p.state === "CONFIRMED" && p.delivery === "RECEIVED_VALID")).toHaveLength(1);
  });

  it("a brain failure before any purchase fails the run with nothing bought", async () => {
    const s = await makeServer();
    await activateMandate(s);
    s.deps.fakes.brain!.failNext("NO_PROVIDER_FOR_TRUST_MODE");
    const { view } = await run(s);
    expect(view.run.state).toBe("FAILED");
    expect(view.run.failureReason).toBe("PLAN_NO_PROVIDER_FOR_TRUST_MODE");
    expect(view.purchases).toHaveLength(0);
  });

  it("INJECT_TEXT: no extra purchases after synthesis, and the answer flags it", async () => {
    const s = await makeServer();
    await activateMandate(s);
    await fault(s, "quickcast", "INJECT_TEXT");
    const { view } = await run(s);
    const real = view.purchases.filter((p) => p.state !== "AGENT_SKIPPED");
    expect(real).toHaveLength(1);
    expect(real.some((p) => merchantOf(view, p.quoteId) === "gouger")).toBe(false);
    expect(view.run.answer?.suspiciousContent.length).toBeGreaterThan(0);
    expect((await s.agent.get("/api/ledger")).body.spentAtomic).toBe("10000");
  });

  it("STALE_DATA: payment confirmed but delivery invalid, so the run is PARTIAL", async () => {
    const s = await makeServer();
    await activateMandate(s);
    await fault(s, "quickcast", "STALE_DATA");
    const { view } = await run(s);
    const p = view.purchases.find((x) => x.state === "CONFIRMED")!;
    expect(p.delivery).toBe("RECEIVED_INVALID");
    expect(view.run.state).toBe("PARTIAL");
    expect((await s.agent.get("/api/ledger")).body.spentAtomic).toBe("10000"); // payment is not quality
  });

  it("history lists runs, rerun repeats the question, other users cannot see runs", async () => {
    const s = await makeServer();
    await activateMandate(s);
    const { runId } = await run(s, "first question");
    const again = (await s.agent.post(`/api/runs/${runId}/rerun`).expect(202)).body.runId;
    await s.ctx.whenIdle();
    const h = (await s.agent.get("/api/runs")).body.runs;
    expect(h.map((r: { id: string }) => r.id)).toEqual([again, runId]);
    expect(h[0].question).toBe("first question");
    const { default: request } = await import("supertest");
    const { otherUserCookie } = await import("./helpers.js");
    await request(s.app).get(`/api/runs/${runId}`).set("Cookie", otherUserCookie()).expect(404);
  });

  it("streams SSE events for a run", async () => {
    const s = await makeServer();
    const slow = s.deps.rails.getCatalog.bind(s.deps.rails);
    s.deps.rails.getCatalog = async () => { await new Promise((r) => setTimeout(r, 150)); return slow(); };
    await activateMandate(s);
    const server = s.app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const cookie = String((await fetch(`${base}/api/session`, { method: "POST" })).headers.getSetCookie()[0]).split(";")[0]!;
      // the agent's mandate belongs to the same demo user, so this cookie owns it
      const { runId } = await (await fetch(`${base}/api/runs`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ question: "rain?" }) })).json() as { runId: string };
      const res = await fetch(`${base}/api/runs/${runId}/events`, { headers: { cookie } });
      const reader = res.body!.getReader();
      let text = "";
      const t0 = Date.now();
      while (!text.includes('"kind":"answer"') && Date.now() - t0 < 5000) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      await reader.cancel();
      expect(text).toContain('"kind":"connected"');
      expect(text).toContain('"kind":"purchase"');
      expect(text).toContain('"kind":"answer"');
    } finally {
      server.closeAllConnections();
      server.close();
      await s.ctx.whenIdle();
    }
  });
});

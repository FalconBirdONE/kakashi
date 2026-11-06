import { createServer, type Server as HttpServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDeps } from "../src/wiring.js";
import request from "supertest";
import { activateMandate, draftBody, makeServer, SECRET } from "./helpers.js";

/** A stand-in for the merchants service /admin/fault. */
async function fakeMerchants(status = 200) {
  const calls: unknown[] = [];
  const srv: HttpServer = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => { calls.push({ url: req.url, body: JSON.parse(b || "{}") }); res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(status === 200 ? { ok: true } : { error: "nope" })); });
  });
  await new Promise<void>((r) => srv.listen(0, r));
  return { calls, url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => srv.close() };
}

async function realRailsApp(merchantsUrl: string) {
  const deps = await createDeps([], {}, () => {});
  deps.fakes.rails = undefined; // behave as real rails: the fault must be forwarded, not applied locally
  const { app } = createApp(deps, { demoMode: true, merchantsUrl, sessionSecret: SECRET, secureCookie: false });
  const agent = request.agent(app); await agent.post("/api/session");
  return { agent, deps };
}

describe("real-mode demo fault", () => {
  it("forwards the fault to the merchants service", async () => {
    const m = await fakeMerchants();
    const { agent } = await realRailsApp(m.url);
    await agent.post("/api/demo/fault").send({ merchantId: "quickcast", fault: "DROP_AFTER_SETTLE" }).expect(200);
    expect(m.calls).toEqual([{ url: "/admin/fault", body: { merchantId: "quickcast", fault: "DROP_AFTER_SETTLE" } }]);
    m.close();
  });
  it("reports a refusal or an unreachable merchants service plainly", async () => {
    const m = await fakeMerchants(400);
    const a = await realRailsApp(m.url);
    expect((await a.agent.post("/api/demo/fault").send({ merchantId: "quickcast", fault: "SWAP_PAYTO" }).expect(400)).body.error).toBe("FAULT_REJECTED");
    m.close();
    const b = await realRailsApp("http://127.0.0.1:1");
    expect((await b.agent.post("/api/demo/fault").send({ merchantId: "quickcast", fault: "NONE" }).expect(502)).body.error).toBe("MERCHANTS_UNREACHABLE");
  });
});

describe("policy results survive a trust that does not return them", () => {
  it("adds policyResult to quotes in the run view", async () => {
    const s = await makeServer();
    const real = s.deps.trust.getRunView.bind(s.deps.trust);
    s.deps.trust.getRunView = (id) => { const v = real(id); return { ...v, quotes: v.quotes.map(({ policyResult: _p, ...q }) => q) }; };
    await activateMandate(s);
    const { runId } = (await s.agent.post("/api/runs").send({ question: "q" }).expect(202)).body;
    await s.ctx.whenIdle();
    const v = (await s.agent.get(`/api/runs/${runId}`)).body;
    const g = v.quotes.find((q: { merchantId: string }) => q.merchantId === "gouger");
    expect(g.policyResult.allowed).toBe(false);
    expect(g.policyResult.reasons).toContain("OVER_PER_PAYMENT_CAP");
  });
});

describe("run window", () => {
  it("keeps the spec default on fakes", async () => {
    const s = await makeServer();
    expect((await s.agent.post("/api/mandates").send(draftBody()).expect(201)).body.maxRunDurationSeconds).toBe(120);
  });
});

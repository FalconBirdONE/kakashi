import request from "supertest";
import { describe, expect, it } from "vitest";
import { activateMandate, draftBody, makeServer, otherUserCookie } from "./helpers.js";

describe("mandate lifecycle on fakes", () => {
  it("draft -> activate -> VERIFIED -> ACTIVE", async () => {
    const s = await makeServer();
    const m = (await s.agent.post("/api/mandates").send(draftBody()).expect(201)).body;
    expect(m.state).toBe("DRAFT");
    const att = (await s.agent.post(`/api/mandates/${m.id}/activate`).expect(201)).body;
    expect(att.result).toBe("PENDING");
    expect(att).not.toHaveProperty("deviceCodeRef");
    expect((await s.agent.get("/api/mandate")).body.mandate.state).toBe("PENDING_APPROVAL");

    await s.agent.post(`/api/dev/complete-auth/${att.id}`).send({ result: "VERIFIED" }).expect(200);
    expect((await s.agent.get(`/api/auth-attempts/${att.id}`)).body.result).toBe("VERIFIED");
    expect((await s.agent.get("/api/mandate")).body.mandate.state).toBe("ACTIVE");

    await s.agent.post(`/api/mandates/${m.id}/revoke`).expect(200);
    expect((await s.agent.get("/api/mandate")).body.mandate.state).toBe("REVOKED");
  });

  it("CANCELLED leaves the mandate non-active and blocks runs", async () => {
    const s = await makeServer();
    const m = (await s.agent.post("/api/mandates").send(draftBody()).expect(201)).body;
    const att = (await s.agent.post(`/api/mandates/${m.id}/activate`).expect(201)).body;
    await s.agent.post(`/api/dev/complete-auth/${att.id}`).send({ result: "CANCELLED" }).expect(200);
    expect((await s.agent.get(`/api/auth-attempts/${att.id}`)).body.result).toBe("CANCELLED");
    expect((await s.agent.get("/api/mandate")).body.mandate.state).not.toBe("ACTIVE");
    const r = await s.agent.post("/api/runs").send({ question: "rain?" }).expect(409);
    expect(r.body.error).toBe("NO_ACTIVE_MANDATE");
  });

  it("validates bodies with a consistent error shape and keeps money as atomic strings", async () => {
    const s = await makeServer();
    for (const bad of [
      draftBody({ totalBudgetAtomic: "0.2" }), draftBody({ totalBudgetAtomic: 200000 }),
      draftBody({ perPaymentCapAtomic: "999999" }), draftBody({ allowedMerchantIds: ["evil"] }),
      draftBody({ expiresAt: "2001-01-01T00:00:00Z" }), draftBody({ extra: 1 }),
    ]) {
      const r = await s.agent.post("/api/mandates").send(bad).expect(400);
      expect(r.body).toEqual({ error: "BAD_REQUEST", message: expect.any(String) });
    }
  });

  it("stores preferences and serves the ledger", async () => {
    const s = await makeServer();
    await s.agent.put("/api/preferences").send({ text: "I cycle" }).expect(200);
    expect(s.deps.trust.getPreferences(s.demoUserId)?.text).toBe("I cycle");
    await activateMandate(s);
    const l = (await s.agent.get("/api/ledger")).body;
    expect([l.limitAtomic, l.spentAtomic, l.reservedAtomic, l.availableAtomic]).toEqual(["200000", "0", "0", "200000"]);
  });
});

describe("session ownership", () => {
  it("rejects requests with no cookie, a tampered cookie or another user's cookie", async () => {
    const s = await makeServer();
    const id = await activateMandate(s);

    await request(s.app).get("/api/mandate").expect(401);
    await request(s.app).get("/api/mandate").set("Cookie", "tb_session=" + s.demoUserId).expect(401); // unsigned
    const other = otherUserCookie();
    // another user sees none of the demo user's data
    expect((await request(s.app).get("/api/mandate").set("Cookie", other).expect(200)).body.mandate).toBeNull();
    await request(s.app).post(`/api/mandates/${id}/revoke`).set("Cookie", other).expect(404);
    await request(s.app).post(`/api/mandates/${id}/activate`).set("Cookie", other).expect(404);
    const att = (await s.agent.post(`/api/mandates/${id}/activate`)).body;
    if (att.id) await request(s.app).get(`/api/auth-attempts/${att.id}`).set("Cookie", other).expect(404);
    expect((await s.agent.get("/api/mandate")).body.mandate.id).toBe(id);
  });

  it("session cookie is signed, HttpOnly and SameSite=Lax", async () => {
    const s = await makeServer();
    const r = await request(s.app).post("/api/session").expect(200);
    const c = String(r.headers["set-cookie"]);
    expect(c).toMatch(/tb_session=s%3A/);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
  });
});

describe("demo gating and basics", () => {
  it("demo and dev routes are 404 when DEMO_MODE is off", async () => {
    const s = await makeServer({ demoMode: false });
    await s.agent.post("/api/demo/fault").send({ merchantId: "quickcast", fault: "NONE" }).expect(404);
    await s.agent.post("/api/dev/complete-auth/att_x").send({ result: "VERIFIED" }).expect(404);
  });

  it("demo fault works when DEMO_MODE is on; healthz and JSON 404", async () => {
    const s = await makeServer();
    await s.agent.post("/api/demo/fault").send({ merchantId: "quickcast", fault: "STALE_DATA" }).expect(200);
    await s.agent.post("/api/demo/fault").send({ merchantId: "nope", fault: "NONE" }).expect(400);
    expect((await request(s.app).get("/healthz").expect(200)).body.ok).toBe(true);
    expect((await request(s.app).get("/nope").expect(404)).body.error).toBe("NOT_FOUND");
  });
});

describe("ui support routes", () => {
  it("serves config without a session and per-purchase audit/delivery data with one", async () => {
    const s = await makeServer();
    const c = (await request(s.app).get("/api/config").expect(200)).body;
    expect(c).toMatchObject({ demoMode: true, devAuth: true });
    await request(s.app).get("/api/purchases").expect(401);
    await activateMandate(s);
    const { runId } = (await s.agent.post("/api/runs").send({ question: "q" }).expect(202)).body;
    await s.ctx.whenIdle();
    const view = (await s.agent.get(`/api/runs/${runId}`)).body;
    const bought = view.purchases.find((p: { state: string }) => p.state === "CONFIRMED");
    expect(view.audit[bought.id].state).toBe("PENDING");
    const rows = (await s.agent.get("/api/purchases")).body.purchases;
    const row = rows.find((x: { purchaseId: string }) => x.purchaseId === bought.id);
    expect(row).toMatchObject({ merchantId: "quickcast", delivery: "RECEIVED_VALID", amountAtomic: "10000" });
    expect(row.zgRequestId).toMatch(/^fake-/);
    expect((await s.agent.get("/api/runs")).body.runs[0].dataSpendAtomic).toBe("10000");
  });
});

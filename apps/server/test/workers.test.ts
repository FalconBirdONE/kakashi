import { describe, expect, it, vi } from "vitest";
import type { RunView } from "@tollbooth/contracts";
import { createAuditWorker } from "../src/workers/auditWorker.js";
import { createReconciler } from "../src/workers/reconciler.js";
import { activateMandate, makeServer, type Server } from "./helpers.js";

const run = async (s: Server) => {
  const { runId } = (await s.agent.post("/api/runs").send({ question: "rain?" }).expect(202)).body;
  await s.ctx.whenIdle();
  return (await s.agent.get(`/api/runs/${runId}`)).body as RunView;
};
const dropped = async (s: Server) => {
  await activateMandate(s);
  await s.agent.post("/api/demo/fault").send({ merchantId: "quickcast", fault: "DROP_AFTER_SETTLE" }).expect(200);
  const view = await run(s);
  const p = view.purchases.find((x) => x.state === "UNKNOWN")!;
  expect(p).toBeTruthy();
  return p;
};
const stateOf = (s: Server, id: string) => {
  for (const r of s.ctx.runs.keys()) {
    const p = s.deps.trust.getRunView(r).purchases.find((x) => x.id === id);
    if (p) return p;
  }
  throw new Error("purchase not found");
};

describe("reconciler", () => {
  it("A1: after a restart an UNKNOWN purchase resolves to CONFIRMED + RECOVERED", async () => {
    const s = await makeServer();
    const p = await dropped(s);
    expect((await s.agent.get("/api/ledger")).body.reservedAtomic).toBe("10000");

    // "Restart": a brand new orchestrator context (empty in-memory state) over the same trust and rails.
    const { createContext } = await import("../src/orchestrator/context.js");
    const fresh = createContext(s.deps);
    const rec = createReconciler(fresh, { autoStart: false });
    await rec.tick();

    const after = s.deps.trust.getRunView(p.runId).purchases.find((x) => x.id === p.id)!;
    expect(after.state).toBe("CONFIRMED");
    expect(after.delivery).toBe("RECOVERED");
    const l = (await s.agent.get("/api/ledger")).body;
    expect([l.spentAtomic, l.reservedAtomic]).toEqual(["10000", "0"]);
  });

  it("does not double-process when ticks overlap", async () => {
    const s = await makeServer();
    const p = await dropped(s);
    const check = vi.spyOn(s.deps.rails, "checkSettlement").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return "SUCCESS";
    });
    const recover = vi.spyOn(s.deps.rails, "recoverDelivery");
    const rec = createReconciler(s.ctx, { autoStart: false });
    await Promise.all([rec.tick(), rec.tick(), rec.tick()]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(stateOf(s, p.id).state).toBe("CONFIRMED");
  });

  it("FAILED/MISMATCH releases the reservation; NOT_FOUND waits for the deadline", async () => {
    const s = await makeServer();
    const p = await dropped(s);
    const check = vi.spyOn(s.deps.rails, "checkSettlement").mockResolvedValue("NOT_FOUND");
    let t = Date.now();
    const rec = createReconciler(s.ctx, { autoStart: false, now: () => t });
    await rec.tick();
    expect(stateOf(s, p.id).state).toBe("UNKNOWN"); // too early to give up
    t += 120_000 + 31_000; // maxTimeoutSeconds (120) + 30 s grace
    await rec.tick();
    expect(stateOf(s, p.id).state).toBe("FAILED_FINAL");
    expect((await s.agent.get("/api/ledger")).body.reservedAtomic).toBe("0");

    const s2 = await makeServer();
    const p2 = await dropped(s2);
    vi.spyOn(s2.deps.rails, "checkSettlement").mockResolvedValue("MISMATCH");
    await createReconciler(s2.ctx, { autoStart: false }).tick();
    expect(stateOf(s2, p2.id).state).toBe("FAILED_FINAL");
    void check;
  });

  it("leaves a fresh SIGNED/SUBMITTED purchase alone for 20 s", async () => {
    const s = await makeServer();
    await activateMandate(s);
    const check = vi.spyOn(s.deps.rails, "checkSettlement");
    // Force a SUBMITTED purchase by making submit never answer.
    s.deps.rails.submitPaidRequest = () => new Promise(() => {});
    await s.agent.post("/api/runs").send({ question: "q" }).expect(202);
    await new Promise((r) => setTimeout(r, 50));
    const rec = createReconciler(s.ctx, { autoStart: false });
    await rec.tick();
    expect(check).not.toHaveBeenCalled();
  });
});

describe("audit worker", () => {
  it("A3: audit outage does not block payments; events stay pending, then anchor in order", async () => {
    const s = await makeServer();
    let failing = true;
    const published: string[] = [];
    const real = s.deps.rails.publishAudit.bind(s.deps.rails);
    s.deps.rails.publishAudit = async (e) => {
      if (failing) throw new Error("HCS down");
      published.push(e.id);
      return real(e);
    };
    await activateMandate(s);
    const view = await run(s);
    expect(view.purchases.some((p) => p.state === "CONFIRMED")).toBe(true); // payment unaffected
    const all = s.deps.trust.listPendingAudit(100);
    expect(all.length).toBeGreaterThan(2);

    let t = 1_000_000;
    const w = createAuditWorker(s.ctx, { autoStart: false, now: () => t });
    await w.tick();
    expect(s.deps.trust.listPendingAudit(100)).toHaveLength(all.length); // nothing anchored
    const head = s.deps.trust.listPendingAudit(1)[0]!;
    expect(head.state).toBe("RETRYING");

    failing = false;
    await w.tick(); // still inside the backoff window
    expect(published).toHaveLength(0);

    t += 61_000; // beyond any backoff (capped at 60 s)
    await w.tick();
    expect(published).toEqual(all.map((e) => e.id)); // original order preserved
    expect(s.deps.trust.listPendingAudit(100)).toHaveLength(0);
  });

  it("backs off exponentially, capped at 60 s", async () => {
    const s = await makeServer();
    const pub = vi.fn(async () => { throw new Error("down"); });
    s.deps.rails.publishAudit = pub;
    await activateMandate(s); // queues MANDATE_ACTIVATED
    let t = 0;
    const w = createAuditWorker(s.ctx, { autoStart: false, now: () => t });
    const gaps: number[] = [];
    let last = -1;
    for (let i = 0; i < 9; i++) {
      const before = pub.mock.calls.length;
      for (let step = 0; step < 100_000 && pub.mock.calls.length === before; step++) { await w.tick(); if (pub.mock.calls.length === before) t += 500; }
      if (last >= 0) gaps.push(t - last);
      last = t;
    }
    expect(gaps[0]).toBeGreaterThanOrEqual(1000);
    expect(gaps.at(-1)).toBeLessThanOrEqual(61_000);
    expect(gaps.at(-1)).toBeGreaterThanOrEqual(60_000);
  });

  it("overlapping ticks publish each event once", async () => {
    const s = await makeServer();
    await activateMandate(s);
    const pub = vi.spyOn(s.deps.rails, "publishAudit");
    const w = createAuditWorker(s.ctx, { autoStart: false });
    await Promise.all([w.tick(), w.tick(), w.tick()]);
    const ids = pub.mock.calls.map(([e]) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

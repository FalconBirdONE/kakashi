import { createHmac } from "node:crypto";
import request from "supertest";
import { createFakeBrain, newId, type Brain } from "@tollbooth/contracts";
import { createApp } from "../src/app.js";
import { createDeps, type Deps } from "../src/wiring.js";

export const SECRET = "test-secret";

export async function makeServer(o: { demoMode?: boolean; brain?: (b: ReturnType<typeof createFakeBrain>) => Brain } = {}) {
  const deps: Deps = await createDeps([], {}, () => {});
  if (o.brain) deps.brain = o.brain(deps.fakes.brain!);
  const { app, ctx, demoUserId } = createApp(
    deps,
    { demoMode: o.demoMode ?? true, merchantsUrl: "http://127.0.0.1:4200", sessionSecret: SECRET, secureCookie: false },
    { approvalPollMs: 10 },
  );
  const agent = request.agent(app);
  await agent.post("/api/session").expect(200);
  return { app, ctx, deps, agent, demoUserId };
}

export type Server = Awaited<ReturnType<typeof makeServer>>;

export const draftBody = (over: Record<string, unknown> = {}) => ({
  totalBudgetAtomic: "200000", perPaymentCapAtomic: "100000", autoApproveCapAtomic: "20000",
  allowedMerchantIds: ["quickcast", "hourlypro", "groundtruth", "gouger"],
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), ...over,
});

/** Create, activate and (via the dev route) verify a mandate. */
export async function activateMandate(s: Server, over: Record<string, unknown> = {}) {
  const m = (await s.agent.post("/api/mandates").send(draftBody(over)).expect(201)).body;
  const att = (await s.agent.post(`/api/mandates/${m.id}/activate`).expect(201)).body;
  await s.agent.post(`/api/dev/complete-auth/${att.id}`).send({ result: "VERIFIED" }).expect(200);
  return m.id as string;
}

export const cookieFor = (userId: string) =>
  `tb_session=${encodeURIComponent("s:" + userId + "." + createHmac("sha256", SECRET).update(userId).digest("base64").replace(/=+$/, ""))}`;

export const otherUserCookie = () => cookieFor(newId("usr_"));

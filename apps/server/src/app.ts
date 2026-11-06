import { AuthStore } from "./auth/store.js";
import { authRoutes, security, type LoginConfig } from "./auth/routes.js";
import express from "express";
import cookieParser from "cookie-parser";
import { newId } from "@tollbooth/contracts";
import type { Config } from "./config.js";
import type { Deps } from "./wiring.js";
import { createContext, type OrchContext } from "./orchestrator/context.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { loadSession } from "./session.js";
import { accountRoutes } from "./routes/account.js";
import { demoRoutes } from "./routes/demo.js";
import { runRoutes } from "./routes/runs.js";
import { configRoute, purchaseListRoute } from "./routes/meta.js";

export function createApp(
  deps: Deps,
  config: Pick<Config, "demoMode" | "merchantsUrl" | "sessionSecret" | "secureCookie">,
  opts: { approvalPollMs?: number; heartbeatMs?: number; demoUserId?: string; authStore?: AuthStore; login?: LoginConfig } = {},
): { app: express.Express; ctx: OrchContext; demoUserId: string } {
  const ctx: OrchContext = createContext(deps, opts);
  if (config.demoMode && (deps.modes.trust === "real" || deps.modes.rails === "real")) throw new Error("demo authority requires fake trust and rails");
  const auth = opts.authStore ?? new AuthStore(":memory:");
  const demoUserId = opts.demoUserId ?? newId("usr_"); // the one demo user, created at start

  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_req, res) => void res.json({ ok: true, modes: deps.modes }));
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser(config.sessionSecret));
  app.use(loadSession);

  const api = express.Router();
  api.use(configRoute(ctx, config));
  api.use(security(auth, config.demoMode));
  api.use(authRoutes(auth, opts.login, config.secureCookie));
  if (!config.demoMode) api.post("/session", (_req,res) => { res.status(404).json({error:"NOT_FOUND"}); });
  api.use(accountRoutes(ctx, { demoUserId, secureCookie: config.secureCookie, demoMode: config.demoMode }));
  if (config.demoMode) api.use(demoRoutes(ctx, { merchantsUrl: config.merchantsUrl }));
  api.use(purchaseListRoute(ctx));
  api.use(runRoutes(ctx, { heartbeatMs: opts.heartbeatMs }));
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, ctx, demoUserId };
}

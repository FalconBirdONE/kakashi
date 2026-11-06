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

export function createApp(
  deps: Deps,
  config: Pick<Config, "demoMode" | "merchantsUrl" | "sessionSecret" | "secureCookie">,
  opts: { approvalPollMs?: number; heartbeatMs?: number; demoUserId?: string } = {},
): { app: express.Express; ctx: OrchContext; demoUserId: string } {
  const ctx: OrchContext = createContext(deps, opts);
  const demoUserId = opts.demoUserId ?? newId("usr_"); // the one demo user, created at start

  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_req, res) => void res.json({ ok: true, modes: deps.modes }));
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser(config.sessionSecret));
  app.use(loadSession);

  const api = express.Router();
  api.use(accountRoutes(ctx, { demoUserId, secureCookie: config.secureCookie }));
  if (config.demoMode) api.use(demoRoutes(ctx, { merchantsUrl: config.merchantsUrl }));
  api.use(runRoutes(ctx, { heartbeatMs: opts.heartbeatMs }));
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, ctx, demoUserId };
}

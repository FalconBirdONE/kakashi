import { validateComponents } from "./readiness.js";
import { AuthStore } from "./auth/store.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDeps } from "./wiring.js";
import { startWorkers } from "./workers/index.js";

async function main() {
  const config = loadConfig();
  validateComponents(config.useReal,process.env);
  const deps = await createDeps(config.useReal);
  const auth = new AuthStore(config.authDbPath);
  for (const email of config.invites) auth.invite(email);
  const { app, ctx } = createApp(deps, config, {authStore:auth,login:config.login,paymentsEnabled:process.env.PAYMENTS_ENABLED==="true",staticDir:process.env.WEB_ROOT});
  const stopWorkers = startWorkers(ctx,{allowSpending:config.demoMode||process.env.PAYMENTS_ENABLED==="true"});
  const server = app.listen(config.port, () => {
    console.log(`[server] listening on :${config.port} (demoMode=${config.demoMode})`);
    process.send?.({ ready: true, port: (server.address() as { port: number }).port });
  });

  let closing = false;
  const shutdown = (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${sig}, shutting down`);
    ctx.stop();
    stopWorkers();
    server.close(() => { auth.close(); process.exit(0); });
    server.closeAllConnections(); // SSE streams would otherwise hold the server open
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[server] failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});

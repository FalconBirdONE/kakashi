import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDeps } from "./wiring.js";

async function main() {
  const config = loadConfig();
  const deps = await createDeps(config.useReal);
  const { app, ctx } = createApp(deps, config);
  const server = app.listen(config.port, () => console.log(`[server] listening on :${config.port} (demoMode=${config.demoMode})`));

  let closing = false;
  const shutdown = (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${sig}, shutting down`);
    ctx.stop();
    server.close(() => process.exit(0));
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

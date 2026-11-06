import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createApp } from "./app.js";
import { loadEnv, parseConfig } from "./config.js";
import { openStore } from "./store.js";

const config = parseConfig(loadEnv());
mkdirSync(dirname(config.dbPath), { recursive: true });
const store = openStore(config.dbPath);
const app = await createApp({ config, store, facilitator: new HTTPFacilitatorClient({ url: config.facilitatorUrl }) });

app.listen(config.port, "127.0.0.1", () => {
  console.log(
    `merchants on http://127.0.0.1:${config.port} asset ${config.asset}` +
      `${config.demoMode ? " DEMO_MODE" : ""}${config.fixtureMode ? " FIXTURE_MODE" : ""}`,
  );
});

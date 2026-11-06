import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app.js";
import { loadSignerConfig } from "./config.js";
import { createSigner, hederaPaymentBuilder } from "./sign.js";
import { openPermitStore } from "./store.js";

const c = loadSignerConfig();
mkdirSync(dirname(c.dbPath), { recursive: true });
const sign = createSigner({
  permitSecret: c.PERMIT_SECRET,
  agentAccountId: c.AGENT_ACCOUNT_ID,
  network: c.HEDERA_NETWORK,
  maxPerTx: BigInt(c.SIGNER_MAX_PER_TX_ATOMIC),
  maxTotal: BigInt(c.SIGNER_MAX_TOTAL_ATOMIC),
  store: openPermitStore(c.dbPath),
  build: hederaPaymentBuilder(c.AGENT_ACCOUNT_ID, c.agentKey, c.HEDERA_NETWORK),
});

createApp(sign, (m) => console.log(m)).listen(c.port, c.host, () => {
  console.log(`signer for ${c.AGENT_ACCOUNT_ID} on http://${c.host}:${c.port}`);
});

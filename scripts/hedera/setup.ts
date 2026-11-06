// Idempotent testnet setup (SPEC §8.1). Run: pnpm --filter @kakashi/hedera-scripts setup
import {
  AccountCreateTransaction,
  Client,
  Hbar,
  PrivateKey,
  Status,
  StatusError,
  TokenAssociateTransaction,
  TopicCreateTransaction,
} from "@hiero-ledger/sdk";
import {
  ACCOUNT_KEYS,
  GENERATED_PATH,
  SIGNER_ENV_PATH,
  loadEnv,
  need,
  parseKey,
  readEnvFile,
  upsertEnvFile,
} from "./env.js";

const GENERATED_HEADER =
  "# Written by scripts/hedera/setup.ts. Public IDs only. Copy these values into .env.\n";
const SIGNER_HEADER =
  "# Written by scripts/hedera/setup.ts. Signer process only. Never copy into the server env.\n";

const env = loadEnv();
const operatorId = need(env, "HEDERA_OPERATOR_ID");
const operatorKey = parseKey(need(env, "HEDERA_OPERATOR_KEY"));
const usdc = env.USDC_TOKEN_ID ?? "0.0.429274";
const client = Client.forTestnet().setOperator(operatorId, operatorKey);

async function associate(accountId: string, key: PrivateKey): Promise<string> {
  try {
    const tx = new TokenAssociateTransaction().setAccountId(accountId).setTokenIds([usdc]).freezeWith(client);
    await (await (await tx.sign(key)).execute(client)).getReceipt(client);
    return "associated";
  } catch (err) {
    if (err instanceof StatusError && err.status === Status.TokenAlreadyAssociatedToAccount) return "already associated";
    throw err;
  }
}

async function createAccount(name: string): Promise<void> {
  const key = PrivateKey.generateECDSA();
  const receipt = await (
    await new AccountCreateTransaction()
      .setKeyWithoutAlias(key.publicKey)
      .setInitialBalance(new Hbar(1))
      .setMaxAutomaticTokenAssociations(10)
      .execute(client)
  ).getReceipt(client);
  const id = receipt.accountId!.toString();
  const assoc = await associate(id, key);
  // Persist the agent key before its ID, so a crash never leaves an ID without a usable key.
  if (name === "AGENT_ACCOUNT_ID") {
    upsertEnvFile(SIGNER_ENV_PATH, { AGENT_ACCOUNT_ID: id, AGENT_PRIVATE_KEY: key.toStringDer() }, SIGNER_HEADER);
  }
  upsertEnvFile(GENERATED_PATH, { [name]: id }, GENERATED_HEADER);
  env[name] = id;
  console.log(`${name}=${id} created, USDC ${usdc} ${assoc}`);
}

async function ensureAccounts(): Promise<void> {
  for (const name of ACCOUNT_KEYS) {
    const existing = env[name];
    if (!existing) {
      await createAccount(name);
      continue;
    }
    if (name === "AGENT_ACCOUNT_ID") {
      const signer = readEnvFile(SIGNER_ENV_PATH);
      if (signer.AGENT_ACCOUNT_ID !== existing || !signer.AGENT_PRIVATE_KEY) {
        throw new Error(
          `AGENT_ACCOUNT_ID=${existing} is set but apps/signer/.env.local has no matching key. ` +
            "Remove AGENT_ACCOUNT_ID from .env and .env.generated to create a new agent.",
        );
      }
      const assoc = await associate(existing, parseKey(signer.AGENT_PRIVATE_KEY));
      console.log(`${name}=${existing} reused, USDC ${usdc} ${assoc}`);
    } else {
      // Merchant keys are not kept (they only receive). check.ts verifies the association.
      console.log(`${name}=${existing} reused`);
    }
  }
}

async function ensureTopic(): Promise<void> {
  if (env.HCS_TOPIC_ID) {
    console.log(`HCS_TOPIC_ID=${env.HCS_TOPIC_ID} reused`);
    return;
  }
  const receipt = await (
    await new TopicCreateTransaction()
      .setTopicMemo("kakashi audit log")
      .setSubmitKey(operatorKey.publicKey) // only the operator can append audit events
      .execute(client)
  ).getReceipt(client);
  const id = receipt.topicId!.toString();
  upsertEnvFile(GENERATED_PATH, { HCS_TOPIC_ID: id }, GENERATED_HEADER);
  console.log(`HCS_TOPIC_ID=${id} created`);
}

type SupportedKind = { x402Version?: number; scheme?: string; network?: string; extra?: { feePayer?: string } };

async function readFacilitator(): Promise<void> {
  const url = env.FACILITATOR_URL ?? "https://x402.org/facilitator";
  const configured = env.FACILITATOR_FEEPAYER ?? "0.0.9185802";
  try {
    const res = await fetch(`${url}/supported`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { kinds?: SupportedKind[] };
    const hedera = (body.kinds ?? []).filter((k) => k.network?.startsWith("hedera"));
    console.log(`\n${url}/supported, hedera entries:\n${JSON.stringify(hedera, null, 2)}`);
    const observed = hedera.find((k) => k.network === "hedera:testnet")?.extra?.feePayer;
    if (!observed) {
      console.warn(`\n!!! WARNING: ${url} lists no hedera:testnet fee payer. Try a fallback facilitator (SPEC §4.1).`);
      return;
    }
    if (observed !== configured) {
      console.warn(`\n!!! WARNING: facilitator fee payer is ${observed}, but FACILITATOR_FEEPAYER is ${configured}.`);
    }
    upsertEnvFile(GENERATED_PATH, { FACILITATOR_FEEPAYER: observed }, GENERATED_HEADER);
    console.log(`FACILITATOR_FEEPAYER=${observed} (observed)`);
  } catch (err) {
    console.warn(`\n!!! WARNING: could not read ${url}/supported: ${(err as Error).message}`);
  }
}

try {
  await ensureAccounts();
  await ensureTopic();
  await readFacilitator();
  console.log(`
Done. Public IDs are in .env.generated. The agent key is only in apps/signer/.env.local.

Manual steps:
  1. Copy the values from .env.generated into .env.
  2. Fund AGENT (${env.AGENT_ACCOUNT_ID}) with testnet USDC at https://faucet.circle.com
     Network: Hedera Testnet. Paste the 0.0.x account ID, NOT the EVM address.
  3. Keep the operator (${operatorId}) funded with HBAR at https://portal.hedera.com
  4. Run: pnpm --filter @kakashi/hedera-scripts check`);
} finally {
  client.close();
}

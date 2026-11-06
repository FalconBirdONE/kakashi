// Prints balances, USDC associations and topic info via the mirror node. Exits 1 if anything required is missing.
import { ACCOUNT_KEYS, SIGNER_ENV_PATH, loadEnv, mirrorGet, parseKey, readEnvFile } from "./env.js";

type MirrorAccount = { account: string; balance: { balance: number }; key: { key: string } | null };
type MirrorTokens = { tokens: { token_id: string; balance: number }[] };
type MirrorTopic = { topic_id: string; memo: string; submit_key: { key: string } | null };

const env = loadEnv();
const usdc = env.USDC_TOKEN_ID ?? "0.0.429274";
const usdcRequired = (env.ASSET_MODE ?? "usdc") === "usdc";
const problems: string[] = [];
const fmt = (atomic: number, decimals: number) => (atomic / 10 ** decimals).toFixed(decimals);

const accounts: [string, string | undefined][] = [
  ["OPERATOR", env.HEDERA_OPERATOR_ID],
  ...ACCOUNT_KEYS.map((k): [string, string | undefined] => [k, env[k]]),
];

for (const [name, id] of accounts) {
  if (!id) {
    problems.push(`${name} is not set`);
    console.log(`${name.padEnd(27)} MISSING`);
    continue;
  }
  const acct = await mirrorGet<MirrorAccount>(env, `/api/v1/accounts/${id}`);
  if (!acct) {
    problems.push(`${name} ${id} not found on mirror node`);
    console.log(`${name.padEnd(27)} ${id} NOT FOUND`);
    continue;
  }
  const rel = await mirrorGet<MirrorTokens>(env, `/api/v1/accounts/${id}/tokens?token.id=${usdc}`);
  const usdcRel = rel?.tokens.find((t) => t.token_id === usdc);
  const usdcText = usdcRel ? `USDC ${fmt(usdcRel.balance, 6)}` : "USDC not associated";
  console.log(`${name.padEnd(27)} ${id.padEnd(12)} HBAR ${fmt(acct.balance.balance, 8)}  ${usdcText}`);
  if (name !== "OPERATOR" && usdcRequired && !usdcRel) problems.push(`${name} ${id} is not associated with USDC ${usdc}`);
  if (name === "AGENT_ACCOUNT_ID") {
    if (usdcRel?.balance === 0) console.log("  (agent USDC balance is 0: run the faucet step)");
    const signerKey = readEnvFile(SIGNER_ENV_PATH).AGENT_PRIVATE_KEY;
    if (!signerKey) problems.push("AGENT_PRIVATE_KEY missing from apps/signer/.env.local");
    else if (parseKey(signerKey).publicKey.toStringRaw() !== acct.key?.key) {
      problems.push("apps/signer/.env.local key does not match the agent account's public key");
    }
  }
}

const topicId = env.HCS_TOPIC_ID;
const topic = topicId ? await mirrorGet<MirrorTopic>(env, `/api/v1/topics/${topicId}`) : null;
if (!topicId) problems.push("HCS_TOPIC_ID is not set");
else if (!topic) problems.push(`HCS topic ${topicId} not found on mirror node`);
else console.log(`HCS topic                   ${topic.topic_id}  memo "${topic.memo}"  submit key ${topic.submit_key ? "set" : "none"}`);

if (problems.length) {
  console.error(`\nFAIL (${problems.length}):\n- ${problems.join("\n- ")}`);
  console.error("Note: the mirror node lags consensus by a few seconds. Re-run if setup just finished.");
  process.exit(1);
}
console.log("\nOK: all accounts exist" + (usdcRequired ? " and are associated with USDC." : "."));

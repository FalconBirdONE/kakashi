import { randomBytes } from "node:crypto";

export const ID_PREFIXES = [
  "usr_", "agt_", "mdt_", "att_", "apv_", "run_", "qte_", "pur_", "inf_", "evt_", "pmt_",
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = -1;
let lastRand = 0n;

export function newId(prefix: IdPrefix): string {
  let t = Date.now();
  if (t <= lastTime) {
    // monotonic within the same ms (or clock going backwards): increment randomness
    t = lastTime;
    lastRand = (lastRand + 1n) & ((1n << 80n) - 1n);
    if (lastRand === 0n) t = ++lastTime;
  } else {
    lastRand = BigInt("0x" + randomBytes(10).toString("hex"));
  }
  lastTime = t;
  let n = (BigInt(t) << 80n) | lastRand;
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = ALPHABET[Number(n & 31n)]! + out;
    n >>= 5n;
  }
  return prefix + out;
}

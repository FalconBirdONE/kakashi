// All money is integer atomic units as decimal strings (SPEC §7.1). These are the only allowed arithmetic.
export type Atomic = string;

const ATOMIC = /^\d+$/;
const chk = (a: string) => {
  if (!ATOMIC.test(a)) throw new Error(`not an atomic amount: ${a}`);
  return BigInt(a);
};

export const addA = (a: Atomic, b: Atomic): Atomic => (chk(a) + chk(b)).toString();
export const subA = (a: Atomic, b: Atomic): Atomic => {
  const r = chk(a) - chk(b);
  if (r < 0n) throw new Error("negative atomic amount");
  return r.toString();
};
export const cmpA = (a: Atomic, b: Atomic): -1 | 0 | 1 => {
  const x = chk(a), y = chk(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

export function toAtomic(display: string, decimals: number): Atomic {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(display);
  if (!m || (m[2]?.length ?? 0) > decimals) throw new Error(`bad amount: ${display}`);
  return BigInt((m[1] as string) + (m[2] ?? "").padEnd(decimals, "0")).toString();
}

export function fromAtomic(a: Atomic, decimals: number): string {
  const s = chk(a).toString().padStart(decimals + 1, "0");
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return s.slice(0, s.length - decimals) + (frac ? "." + frac : "");
}

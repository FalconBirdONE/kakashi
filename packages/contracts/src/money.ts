export type Atomic = string;

const DEC = /^\d+$/;

export function isAtomic(x: unknown): x is Atomic {
  return typeof x === "string" && /^(0|[1-9]\d*)$/.test(x);
}

function big(a: string): bigint {
  if (typeof a !== "string" || !DEC.test(a)) throw new Error(`invalid atomic amount: ${String(a)}`);
  return BigInt(a);
}

export function toAtomic(display: string, decimals: number): Atomic {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error("invalid decimals");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(display);
  if (!m) throw new Error(`invalid decimal amount: ${String(display)}`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error("too many fractional digits");
  return (BigInt(m[1]! + frac.padEnd(decimals, "0"))).toString();
}

export function fromAtomic(a: Atomic, decimals: number): string {
  const v = big(a);
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error("invalid decimals");
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export const addA = (a: Atomic, b: Atomic): Atomic => (big(a) + big(b)).toString();

export function subA(a: Atomic, b: Atomic): Atomic {
  const r = big(a) - big(b);
  if (r < 0n) throw new Error("negative result");
  return r.toString();
}

export function cmpA(a: Atomic, b: Atomic): -1 | 0 | 1 {
  const x = big(a), y = big(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

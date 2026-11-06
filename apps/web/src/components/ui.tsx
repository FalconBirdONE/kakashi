import type { ButtonHTMLAttributes, ReactNode } from "react";
import { fromAtomic } from "@tollbooth/contracts/money";

export const USDC_DECIMALS = 6;
export const usdc = (a: string): string => `${fromAtomic(a, USDC_DECIMALS)} USDC`;
export const shortCode = (hash: string): string => hash.slice(0, 6).toUpperCase();
export const hashscanTx = (txId: string): string => `https://hashscan.io/testnet/transaction/${txId}`;
export const fmtTime = (iso: string): string => new Date(iso).toLocaleString();

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-700 bg-slate-900 p-4 ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold text-slate-100">{title}</h2>}
      {children}
    </section>
  );
}

const tones = {
  gray: "bg-slate-700 text-slate-100", green: "bg-emerald-900 text-emerald-200", yellow: "bg-amber-900 text-amber-200",
  red: "bg-rose-900 text-rose-200", blue: "bg-sky-900 text-sky-200",
} as const;
export type Tone = keyof typeof tones;
export const Badge = ({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
);

export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = { primary: "bg-sky-600 hover:bg-sky-500 text-white", ghost: "border border-slate-600 hover:bg-slate-800 text-slate-100", danger: "bg-rose-700 hover:bg-rose-600 text-white" }[variant];
  return <button {...p} className={`rounded px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`} />;
}

export const inputCls = "w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500";
export const Label = ({ children }: { children: ReactNode }) => <span className="mb-1 block text-sm text-slate-300">{children}</span>;
export const ErrorText = ({ children }: { children: ReactNode }) => <p role="alert" className="text-sm text-rose-300">{children}</p>;

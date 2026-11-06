import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { fromAtomic } from "@tollbooth/contracts/money";

export const USDC_DECIMALS = 6;
export const usdc = (a: string): string => `${fromAtomic(a, USDC_DECIMALS)} USDC`;
export const shortCode = (hash: string): string => hash.slice(0, 6).toUpperCase();
export const hashscanTx = (txId: string): string => `https://hashscan.io/testnet/transaction/${txId}`;
export const fmtTime = (iso: string): string => new Date(iso).toLocaleString();

const frames = {
  plain: "border-white/[0.08] bg-white/[0.02]",
  gold: "border-gold-400/25 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(240,185,85,0.07),transparent_60%)]",
  green: "border-emerald-400/20 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(52,211,153,0.07),transparent_60%)]",
} as const;

export function Card({ title, children, className = "", frame = "plain" }: { title?: string; children: ReactNode; className?: string; frame?: keyof typeof frames }) {
  return (
    <section className={`rounded-2xl border p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:p-6 ${frames[frame]} ${className}`}>
      {title && <h2 className="mb-4 text-[15px] font-semibold tracking-tight text-zinc-100">{title}</h2>}
      {children}
    </section>
  );
}

const tones = {
  gray: "bg-white/[0.06] text-zinc-300 ring-white/10",
  green: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  yellow: "bg-amber-400/10 text-amber-200 ring-amber-400/25",
  red: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
  blue: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
} as const;
// Blue means "in flight", so its dot pulses.
const dots = { gray: "bg-zinc-400", green: "bg-emerald-400", yellow: "bg-amber-300", red: "bg-rose-400", blue: "bg-sky-400 animate-pulse" } as const;
export type Tone = keyof typeof tones;
export const Badge = ({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
    <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dots[tone]}`} />
    {children}
  </span>
);

type Variant = "primary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-zinc-50 text-zinc-950 hover:bg-white shadow-[0_8px_30px_-12px_rgba(255,255,255,0.35)]",
  ghost: "border border-white/[0.12] bg-white/[0.03] text-zinc-100 hover:border-white/20 hover:bg-white/[0.07]",
  danger: "bg-rose-500/90 text-white hover:bg-rose-500",
};
const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "h-11 px-6 text-[15px]" } as const;
type Size = keyof typeof sizes;
/** Button classes, also used on links that look like buttons. */
export const btn = (variant: Variant = "primary", size: Size = "md"): string =>
  `group inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,border-color,transform] duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:pointer-events-none disabled:opacity-40 ${sizes[size]} ${variants[variant]}`;

export function Button({ variant = "primary", size = "md", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button {...p} className={`${btn(variant, size)} ${className}`} />;
}

export const Arrow = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 transition-transform duration-300 group-hover:translate-x-0.5">
    <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// text-base below sm stops iOS Safari zooming into focused fields.
export const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-base text-zinc-100 sm:text-sm placeholder-zinc-500 transition-[border-color,box-shadow] duration-200 focus:border-gold-400/50 focus:outline-none focus:ring-4 focus:ring-gold-400/10";
export const Label = ({ children }: { children: ReactNode }) => <span className="mb-1.5 block text-[13px] font-medium text-zinc-300">{children}</span>;
export const ErrorText = ({ children }: { children: ReactNode }) => <p role="alert" className="text-sm text-rose-300">{children}</p>;
export const Muted = ({ children }: { children: ReactNode }) => <p className="text-sm text-zinc-500">{children}</p>;
export const listCls = "divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.015]";

/** Title block for app pages. The eyebrow tells the user where they are in the flow. */
export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 sm:mb-10">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-gold-400">{eyebrow}</p>
      <h1 className="mt-2 text-balance text-3xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-4xl">{title}</h1>
      {children && <div className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-400">{children}</div>}
    </div>
  );
}

/** Fades its children in the first time they scroll into view. */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${shown ? "is-shown" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

import type { ReactNode } from "react";
import { Arrow, btn, hashscanTx, Reveal } from "../components/ui";

const PROOF_TX = "0.0.9185802@1793984794.908601245"; // README "Proof of payment"

const STACK = [
  ["Human authorization", "World ID Agent Pass"],
  ["Decisions", "Sealed TEE inference on 0G"],
  ["Payments", "x402 in USDC on Hedera"],
  ["Audit trail", "Hedera Consensus Service"],
] as const;

const icon = (d: string) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const STEPS = [
  { title: "Approve a mandate", icon: icon("M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3zM9 12l2 2 4-4"),
    body: "Set a total budget, a per-payment cap, an auto-approve threshold and the merchants allowed. Activate it with World ID." },
  { title: "Ask a question", icon: icon("M4 5h16v11H9l-5 4V5zM8 9h8M8 12h5"),
    body: "The agent turns it into specific evidence needs and collects x402 price quotes from paid data APIs." },
  { title: "Buy only what's worth it", icon: icon("M3 5h18l-7 8v6l-4-2v-4L3 5z"),
    body: "Sealed inference on 0G picks which quotes to buy, with a reason for each. A deterministic policy engine checks every purchase." },
  { title: "Get an answer with receipts", icon: icon("M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6"),
    body: "Each citation links to its Hedera transaction and its 0G decision. Audit events are anchored to an HCS topic." },
];

const PRINCIPLES = [
  { title: "The model can't reach the money", body: "It never sees keys, URLs or raw merchant text, and can only pick from IDs the server generated." },
  { title: "Deterministic policy", body: "Merchant, recipient, asset, caps, budget, expiry, price and duplicates are checked in code. The budget is reserved in one database transaction." },
  { title: "An isolated signer", body: "A separate process holds the key. It signs only against a single-use permit bound to the exact payment, with its own hard ceilings." },
  { title: "A human for anything that matters", body: "Activating a mandate, and any purchase above the auto-approve threshold, needs a fresh World ID authentication bound to that exact request." },
];

type Verdict = { text: string; cls: string };
const DEMO: { name: string; offer: string; price: string; verdict: Verdict }[] = [
  { name: "QuickCast", offer: "Daily forecast, city", price: "0.01", verdict: { text: "Buy", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" } },
  { name: "HourlyPro", offer: "Hourly, by neighbourhood", price: "0.05", verdict: { text: "Buy · World ID approved", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" } },
  { name: "GroundTruth", offer: "Station observations", price: "0.03", verdict: { text: "Skip · redundant", cls: "bg-white/[0.06] text-zinc-300 ring-white/10" } },
  { name: "PriceGouger", offer: "“Premium” global forecast", price: "0.50", verdict: { text: "Blocked by policy", cls: "bg-rose-400/10 text-rose-300 ring-rose-400/20" } },
];

/** Illustrative run in the hero. Static content, animated in once. */
function ExampleRun() {
  return (
    <div className="glow-border shadow-[0_40px_120px_-40px_rgba(240,185,85,0.28)]">
      <div className="rounded-[calc(1.25rem-1px)] bg-[#0b0c0f] text-left">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 sm:px-5">
          <div aria-hidden="true" className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-white/10" /><span className="size-2.5 rounded-full bg-white/10" /><span className="size-2.5 rounded-full bg-white/10" />
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Example run</span>
          <span className="w-10" />
        </div>
        <div className="p-4 sm:p-6">
          <p className="text-xs text-zinc-500">Question</p>
          <p className="mt-1 text-lg font-medium text-zinc-100 sm:text-xl">Will it rain in Mumbai tomorrow afternoon?</p>

          <div className="mt-6 overflow-hidden rounded-xl border border-white/[0.06]">
            <div className="grid grid-cols-[1fr_auto] gap-x-4 bg-white/[0.02] px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500 sm:grid-cols-[1fr_1.3fr_auto_11rem]">
              <span>Merchant</span><span className="hidden sm:block">Offer</span><span className="hidden text-right sm:block">Quote</span><span className="text-right">Decision</span>
            </div>
            {DEMO.map((q, i) => (
              <div key={q.name} className="animate-rise grid grid-cols-[1fr_auto] items-center gap-x-4 border-t border-white/[0.05] px-4 py-3 text-sm sm:grid-cols-[1fr_1.3fr_auto_11rem]"
                style={{ animationDelay: `${700 + i * 140}ms` }}>
                <span className="font-medium text-zinc-200">{q.name}<span className="block font-mono text-xs font-normal text-zinc-500 sm:hidden">{q.price} USDC</span></span>
                <span className="hidden text-zinc-400 sm:block">{q.offer}</span>
                <span className="hidden text-right font-mono text-zinc-300 sm:block">{q.price} USDC</span>
                <span className="text-right">
                  <span className={`animate-pop inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${q.verdict.cls}`} style={{ animationDelay: `${1200 + i * 140}ms` }}>
                    {q.verdict.text}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="animate-rise mt-5 rounded-xl border border-gold-400/15 bg-gold-400/[0.04] p-4" style={{ animationDelay: "1900ms" }}>
            <p className="text-xs font-medium text-gold-300">Answer · high confidence</p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">
              Light showers are likely between 2 pm and 5 pm, heaviest near Bandra. <span className="text-gold-300">[1]</span> <span className="text-gold-300">[2]</span>
            </p>
            <p className="mt-3 font-mono text-[11px] text-zinc-500">Data spend 0.06 USDC · Inference in 0G credits · 2 receipts on Hedera</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const Eyebrow = ({ children }: { children: ReactNode }) => <p className="text-xs font-medium uppercase tracking-[0.16em] text-gold-400">{children}</p>;
const H2 = ({ children }: { children: ReactNode }) => <h2 className="mt-3 text-balance text-3xl font-semibold tracking-[-0.03em] text-zinc-50 sm:text-5xl">{children}</h2>;
const Accent = ({ children }: { children: ReactNode }) => <span className="font-serif font-normal italic text-zinc-400">{children}</span>;

export default function LandingScreen() {
  return (
    <>
      <section className="relative -mt-16 overflow-hidden pt-16">
        <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-300px] h-[600px] w-[min(1000px,140vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(240,185,85,0.16),transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-14 text-center sm:px-6 sm:pb-28 sm:pt-24">
          <p className="animate-rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-300">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(240,185,85,0.5)]" />
            Built on World ID, 0G and Hedera
          </p>
          <h1 className="text-sheen animate-rise mx-auto mt-6 max-w-4xl text-balance text-[clamp(2.6rem,8vw,5.25rem)] font-semibold leading-[1.02] tracking-[-0.04em] [animation-delay:80ms]">
            Answers worth <span className="font-serif font-normal italic tracking-[-0.02em] text-gold-300">paying</span> for.
          </h1>
          <p className="animate-rise mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg [animation-delay:160ms]">
            Tollbooth is a research agent that buys only the evidence it needs, spends only inside a budget a verified human approved,
            and can prove every decision and payment.
          </p>
          <div className="animate-rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row [animation-delay:240ms]">
            <a href="#/mandate" className={`${btn("primary", "lg")} w-full sm:w-auto`}>Set up a mandate <Arrow /></a>
            <button type="button" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}
              className={`${btn("ghost", "lg")} w-full sm:w-auto`}>How it works</button>
          </div>
          <div className="animate-rise mx-auto mt-16 max-w-4xl sm:mt-20 [animation-delay:400ms]">
            <ExampleRun />
          </div>
        </div>
      </section>

      <section aria-label="Built on" className="border-y border-white/[0.06]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-white/[0.06] lg:grid-cols-4">
          {STACK.map(([k, v], i) => (
            <Reveal key={k} delay={i * 80} className="bg-ink px-4 py-7 sm:px-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{k}</p>
              <p className="mt-2 text-sm font-medium text-zinc-100 sm:text-[15px]">{v}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <Reveal className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <H2>From question to receipt, <Accent>in four steps.</Accent></H2>
          <p className="mt-4 text-lg leading-relaxed text-zinc-400">You set the limits once. The agent does the shopping, and you can check every purchase it made.</p>
        </Reveal>
        <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 110} className="h-full">
                <div className="h-full rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 transition-colors duration-300 hover:border-white/[0.14] hover:bg-white/[0.035]">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-gold-300">0{i + 1}</span>
                    <span className="flex size-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300">{s.icon}</span>
                  </div>
                  <h3 className="mt-8 text-lg font-semibold tracking-tight text-zinc-50">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 sm:pb-32">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <Reveal>
            <Eyebrow>Security model</Eyebrow>
            <H2>The model only proposes.</H2>
            <p className="mt-4 text-lg leading-relaxed text-zinc-400">
              Plain code decides, and a separate process signs. Untrusted model output can't bypass the spending rules.
            </p>
            <a href={hashscanTx(PROOF_TX)} target="_blank" rel="noreferrer"
              className="group mt-8 block rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors duration-300 hover:border-gold-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70">
              <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Proof of payment</span>
              <span className="mt-2 block text-sm text-zinc-300">0.01 USDC through quote, permit, isolated signer and x402 settlement, confirmed on the Hedera mirror node.</span>
              <span className="mt-3 flex items-center gap-2 break-all font-mono text-xs text-gold-300">{PROOF_TX} <Arrow /></span>
            </a>
          </Reveal>
          <ul className="divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {PRINCIPLES.map((p, i) => (
              <li key={p.title}>
                <Reveal delay={i * 90} className="flex gap-4 py-6">
                  <span aria-hidden="true" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gold-400/10 text-gold-300 ring-1 ring-inset ring-gold-400/20">
                    <svg viewBox="0 0 16 16" className="size-3.5"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <div>
                    <h3 className="font-semibold text-zinc-100">{p.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-400">{p.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 sm:pb-32">
        <Reveal className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(120%_120%_at_50%_0%,rgba(240,185,85,0.14),transparent_60%)] px-6 py-16 text-center sm:py-24">
          <h2 className="mx-auto max-w-3xl text-balance text-3xl font-semibold tracking-[-0.03em] text-zinc-50 sm:text-5xl">
            Set the budget once. <span className="font-serif font-normal italic text-gold-300">Keep every receipt.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-zinc-400">Create a mandate, activate it with World ID, then ask your first question.</p>
          <a href="#/mandate" className={`${btn("primary", "lg")} mt-8`}>Get started <Arrow /></a>
        </Reveal>
      </section>
    </>
  );
}

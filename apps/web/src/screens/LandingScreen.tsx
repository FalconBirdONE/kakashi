import { useState, type ReactNode } from "react";
import { BuiltOn, SPONSORS, SPONSOR_ORDER, SponsorLogo, SponsorMark, SponsorTag, type SponsorId } from "../components/Brand";
import { Arrow, btn, hashscanTx, Reveal } from "../components/ui";
import DeckNav from "./landing/Deck";
import { CursorFx, HeroDust, ScrollProgress } from "./landing/Fx";
import { AttackLab, AuditChain, DecideDemo, EvalBars, PayOnceDemo, WorldDemo } from "./landing/Demos";
import Flow from "./landing/Flow";
import { Accent, Check, Cross, Eyebrow, H2, Lead, Slide, Wrap } from "./landing/kit";

// Proofs from docs/rails/PROOF.md and docs/brain/EVALS.md.
const PROOF_TX = "0.0.9185802@1793984794.908601245";
const RECOVERY_TX = "0.0.9185802@1793984803.504843327";
const HCS_TOPIC = "0.0.11341856";
const USDC = "0.0.429274";
const REPO = "https://github.com/FalconBirdONE/kakashi";
const hashscan = (kind: "topic" | "token" | "account", id: string) => `https://hashscan.io/testnet/${kind}/${id}`;

type Verdict = { text: string; cls: string };
const DEMO: { name: string; offer: string; price: string; verdict: Verdict }[] = [
  { name: "KeyScan", offer: "Issuer keys and fees", price: "0.01", verdict: { text: "Buy", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" } },
  { name: "HolderMap", offer: "Wallets above 1% of supply", price: "0.03", verdict: { text: "Buy · World ID approved", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" } },
  { name: "TreasuryWatch", offer: "Treasury selling and mints", price: "0.05", verdict: { text: "Buy · World ID approved", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20" } },
  { name: "InsiderAlpha", offer: "“Insider” calls", price: "0.50", verdict: { text: "Blocked by policy", cls: "bg-rose-400/10 text-rose-300 ring-rose-400/20" } },
];

/** Illustrative run in the hero. Static content, animated in once. */
function ExampleRun() {
  return (
    <div data-tilt className="glow-border shadow-[0_40px_120px_-40px_rgba(240,185,85,0.28)]">
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
          <p className="mt-1 text-lg font-medium text-zinc-100 sm:text-xl">I'm about to put 2,000 USDC into SAUCE (0.0.731861). Safe?</p>

          <div className="mt-6 overflow-hidden rounded-xl border border-white/[0.06]">
            <div className="grid grid-cols-[1fr_auto] gap-x-4 bg-white/[0.02] px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-zinc-500 sm:grid-cols-[1fr_1.3fr_auto_11rem]">
              <span>Merchant</span><span className="hidden sm:block">Offer</span><span className="hidden text-right sm:block">Quote</span><span className="text-right">Decision</span>
            </div>
            {DEMO.map((q, i) => (
              <div key={q.name} className="animate-rise grid grid-cols-[1fr_auto] items-center gap-x-4 border-t border-white/[0.05] px-4 py-3 text-sm sm:grid-cols-[1fr_1.3fr_auto_11rem]"
                style={{ animationDelay: `${350 + i * 90}ms` }}>
                <span className="font-medium text-zinc-200">{q.name}<span className="block font-mono text-xs font-normal text-zinc-500 sm:hidden">{q.price} USDC</span></span>
                <span className="hidden text-zinc-400 sm:block">{q.offer}</span>
                <span className="hidden text-right font-mono text-zinc-300 sm:block">{q.price} USDC</span>
                <span className="text-right">
                  <span className={`animate-pop inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${q.verdict.cls}`} style={{ animationDelay: `${650 + i * 90}ms` }}>
                    {q.verdict.text}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="animate-rise mt-5 rounded-xl border border-gold-400/15 bg-gold-400/[0.04] p-4" style={{ animationDelay: "1000ms" }}>
            <p className="text-xs font-medium text-gold-300">Answer · high confidence</p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">
              CAUTION. The issuer holds admin and supply keys and can mint more; 9 wallets each hold over 1%. <span className="text-gold-300">[1]</span> <span className="text-gold-300">[2]</span> <span className="text-gold-300">[3]</span>
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] text-zinc-500">
              <span>Check spend 0.09 USDC</span>
              <span className="inline-flex items-center gap-1.5"><SponsorMark id="hedera" className="h-3" />3 receipts on Hedera</span>
              <span className="inline-flex items-center gap-1.5"><SponsorMark id="0g" className="h-2.5" />decided in a TEE</span>
              <span className="inline-flex items-center gap-1.5"><SponsorMark id="world" className="h-3" />2 human approvals</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const PROBLEMS = [
  { t: "A wallet is a blank cheque", b: "Give an agent a key and it spends whatever a prompt, a bug or a merchant talks it into." },
  { t: "Nobody signed off", b: "There is no record that a real person approved this budget, this merchant or this amount." },
  { t: "No receipts", b: "You can't see what it bought or why, and you can't prove any of it afterwards." },
];

const JOBS: Record<SponsorId, { points: string[]; without: string }> = {
  world: {
    points: ["World decides who may spend.", "Activates each mandate version", "Step-up approval for any check above the auto-approve cap", "Validated on the server and bound to the exact mandate or purchase hash"],
    without: "Anyone holding the session could hand the agent a budget. No human would stand behind a spend.",
  },
  "0g": {
    points: ["0G decides which checks this trade size justifies.", "Plans which risks matter for this token and trade", "Decides BUY or SKIP for every eligible check, with a reason", "Writes BUY, CAUTION or AVOID from the purchased checks, with no tools"],
    without: "Kakashi can't tell which checks a trade is worth paying for, and your token and trade size go to an ordinary provider in plaintext.",
  },
  hedera: {
    points: ["Hedera pays per check, proves it, and supplies the HTS-specific risks.", "x402 quotes and USDC settlement on testnet, with mirror-node reconciliation so a lost response is never paid twice", "Issuer keys, custom fees, holders and treasury moves read from the mainnet mirror node", "A hash-chained audit trail anchored to HCS"],
    without: "No pay-per-check data, no token risks to check, and no tamper-evident record of what the agent bought.",
  },
};

const PRINCIPLES = [
  { t: "The model can't reach the money", b: "It never sees keys, URLs or raw merchant text, and can only pick from IDs the server generated." },
  { t: "Deterministic policy", b: "Merchant, recipient, asset, caps, budget, expiry, price and duplicates are checked in code. The budget is reserved in one database transaction." },
  { t: "An isolated signer", b: "A separate process holds the key. It signs only against a single-use permit bound to the exact payment, with its own hard ceilings." },
  { t: "A human for anything that matters", b: "Activating a mandate, and any purchase above the auto-approve cap, needs a fresh World ID authentication bound to that exact request." },
];

const SCRIPT: { at: string; title: string; steps: string; by: SponsorId[]; q?: string; href?: string; cta?: string }[] = [
  { at: "0:00", title: "A human grants the budget", steps: "Create a mandate → Activate with World ID → verified → Active.", by: ["world"], href: "#/mandate", cta: "Open mandate" },
  { at: "0:35", title: "A small trade, a paid check with no human", steps: "Ask the question → plan → quotes, InsiderAlpha blocked by policy → 0G buys KeyScan on its own, under the auto-approve cap → HashScan link and 0G request ID.", by: ["0g", "hedera"], q: "Should I put 20 USDC into 0.0.731861?", href: "#/research", cta: "Open research" },
  { at: "1:10", title: "A bigger trade, and a step-up", steps: "Same token, a hundred times the size → the agent adds HolderMap and TreasuryWatch, both above the auto-approve cap → approve the step-up with World ID → paid → a verdict with receipts.", by: ["0g", "world"], q: "I'm about to put 2,000 USDC into 0.0.731861.", href: "#/research", cta: "Open research" },
  { at: "1:50", title: "Receipts", steps: "Ledger → the HashScan transaction, the HCS topic and the 0G trace for every check.", by: ["hedera", "0g"], href: "#/ledger", cta: "Open ledger" },
  { at: "2:20", title: "The reason to come back", steps: "History → Run again: the same checks on fresh mainnet data before your next trade.", by: ["world", "0g", "hedera"], href: "#/history", cta: "Open history" },
];

const LIMITS = [
  "Spending limits are enforced by our backend and the isolated signer, not on-chain. In this demo the operator holds the agent key, so Kakashi is custodial.",
  "World authenticates the human, and we record their approval of a specific mandate or purchase. The user does not sign the payment: the agent's key does. World proofs are mocked for this event.",
  "The 0G Router reports TEE verification for each decision. We record that report and the trace ID; we don't verify the attestation independently.",
  "Untrusted model output can't bypass the spending rules. Prompt injection in merchant data can still distort the written answer, so Kakashi flags suspicious content.",
  "HCS makes our recorded history tamper-evident. It doesn't make it a complete, trustless audit.",
  "The check sellers are demo APIs paid on Hedera testnet, and one of them is deliberately adversarial.",
  "Checks read public Hedera mainnet data; what you pay for is the indexing and the judgment. Payments run on testnet. Merchants see only the token ID, never your trade size.",
];

const STACK = [
  ["Frontend", "React 18 · Vite · Tailwind CSS 4"], ["Backend", "Express 5 · server-sent events · workers"],
  ["Data", "SQLite · atomic reservations · append-only migrations"], ["Validation", "zod at every boundary, model output included"],
  ["Identity", "World ID Agent Pass · OIDC device flow · jose"], ["AI", "0G Router · private TEE tier · versioned prompts"],
  ["Payments", "x402 v2 · @x402/hedera · USDC on testnet"], ["Audit", "Hedera Consensus Service · mirror node"],
] as const;

function ProofLink({ label, value, href, by, note }: { label: string; value: string; href?: string; by: SponsorId; note: string }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{label}</span>
        <SponsorMark id={by} className={by === "0g" ? "h-3 text-zinc-500" : "h-4 text-zinc-500"} />
      </span>
      <span className="mt-2 block text-sm text-zinc-300">{note}</span>
      <span className="mt-3 flex items-center gap-2 break-all font-mono text-xs text-gold-300">{value}{href && <Arrow />}</span>
    </>
  );
  const cls = "fx-card group block h-full rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors duration-300";
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:border-gold-400/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70`}>{body}</a>
    : <div className={cls}>{body}</div>;
}

function CopyChip({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" title="Copy question"
      onClick={() => void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {})}
      className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-left text-xs text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-50">
      <span className="truncate">“{text}”</span><span className="shrink-0 text-zinc-500">{done ? "copied" : "copy"}</span>
    </button>
  );
}

const SponsorFacts = ({ items }: { items: ReactNode[] }) => (
  <ul className="mt-8 space-y-3">
    {items.map((x, i) => (
      <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-zinc-300">
        <span aria-hidden="true" className="mt-1.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-gold-400/10 text-gold-300 ring-1 ring-inset ring-gold-400/20"><Check className="size-2.5" /></span>
        <span>{x}</span>
      </li>
    ))}
  </ul>
);
const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-200">{children}</code>;

export default function LandingScreen() {
  return (
    <>
      <DeckNav />
      <CursorFx />
      <ScrollProgress />

      {/* 01 · Intro */}
      <Slide id="intro" label="Intro" className="-mt-16 overflow-hidden pt-16">
        <div aria-hidden="true" className="fx-parallax pointer-events-none absolute -inset-8 [--depth:-14px]"><div className="hero-grid absolute inset-0" /></div>
        <HeroDust />
        <div aria-hidden="true" className="fx-parallax pointer-events-none absolute left-1/2 top-[-300px] [--depth:40px] h-[600px] w-[min(1000px,140vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(240,185,85,0.16),transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-14 text-center sm:px-6 sm:pb-28 sm:pt-20">
          <p className="animate-rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-300">
            <span aria-hidden="true" className="fx-ping size-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(240,185,85,0.5)]" />
            ETHGlobal Mumbai 2026 · Token checks with receipts
          </p>
          <h1 className="text-sheen animate-rise mx-auto mt-6 max-w-4xl text-balance text-[clamp(2.6rem,8vw,5.25rem)] font-semibold leading-[1.02] tracking-[-0.04em] [animation-delay:50ms]">
            Check a token <span className="text-shimmer font-serif font-normal italic tracking-[-0.02em] text-gold-300">before</span> you buy it.
          </h1>
          <p className="animate-rise mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg [animation-delay:100ms]">
            Kakashi is a pre-trade check for Hedera tokens. It buys only the checks your trade size justifies, spends only inside a budget a verified human approved,
            and can prove every decision and payment.
          </p>
          <div className="animate-rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row [animation-delay:150ms]">
            <a data-magnetic href="#/mandate" className={`${btn("primary", "lg")} w-full sm:w-auto`}>Set up a mandate <Arrow /></a>
            <button type="button" onClick={() => document.getElementById("flow")?.scrollIntoView({ behavior: "smooth" })}
              data-magnetic className={`${btn("ghost", "lg")} w-full sm:w-auto`}>See how it works</button>
          </div>
          <div className="animate-rise mt-12 flex flex-col items-center gap-4 [animation-delay:200ms]">
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Built on</p>
            <BuiltOn className="justify-center gap-x-10" logo="h-7" />
          </div>
          <div className="animate-rise mx-auto mt-14 max-w-4xl sm:mt-16 [animation-delay:260ms]">
            <ExampleRun />
          </div>
        </div>
      </Slide>

      {/* 02 · Problem */}
      <Slide id="problem" label="Problem" className="border-t border-white/[0.06] py-20 sm:py-24">
        <Wrap>
          <Reveal className="max-w-3xl">
            <Eyebrow n="02">The problem</Eyebrow>
            <H2>Tokens hide risks. <Accent>Most traders never check.</Accent></H2>
            <Lead>
              Tokens on Hedera can carry issuer keys that freeze, wipe or pause balances, or mint more supply, and they can carry hidden transfer fees.
              Most traders never check. The free mirror node can't tell you who the top holders are, because it lists balances by account id, not by size.
              You pay cents per check, scaled to what you're putting in, instead of a monthly analytics subscription.
              Paying per check means an agent spends one request at a time, and that is exactly where things go wrong.
            </Lead>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PROBLEMS.map((p, i) => (
              <Reveal key={p.t} delay={i * 100} className="h-full">
                <div className="fx-card h-full rounded-2xl border border-rose-400/[0.12] bg-[radial-gradient(120%_120%_at_0%_0%,rgba(251,113,133,0.06),transparent_60%)] p-6">
                  <span className="flex size-8 items-center justify-center rounded-full bg-rose-400/10 text-rose-300 ring-1 ring-inset ring-rose-400/20"><Cross /></span>
                  <h3 className="mt-6 text-lg font-semibold tracking-tight text-zinc-50">{p.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">{p.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={200} className="mt-6">
            <div className="fx-card flex flex-col gap-5 rounded-2xl border border-gold-400/20 bg-gold-400/[0.04] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <p className="max-w-2xl text-xl font-medium leading-snug tracking-tight text-zinc-50 sm:text-2xl">
                The model only <span className="text-gold-300">proposes</span>. Plain code <span className="text-gold-300">decides</span>. A separate process <span className="text-gold-300">signs</span>. A verified human <span className="text-gold-300">approves</span> anything that matters.
              </p>
              <span className="shrink-0 font-mono text-xs text-zinc-500">Kakashi's answer</span>
            </div>
          </Reveal>
        </Wrap>
      </Slide>

      {/* 03 · Three sponsors, three jobs */}
      <Slide id="jobs" label="Three jobs" className="py-20 sm:py-24">
        <Wrap>
          <Reveal className="max-w-3xl">
            <Eyebrow n="03">Three sponsors · three jobs</Eyebrow>
            <H2>Each sponsor does one thing <Accent>no one else can.</Accent></H2>
            <Lead>Take any one away and the product stops working. That is the test we designed against.</Lead>
          </Reveal>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {SPONSOR_ORDER.map((id, i) => {
              const s = SPONSORS[id];
              return (
                <Reveal key={id} delay={i * 120} className="h-full">
                  <article className={`fx-card group flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 transition-all duration-500 hover:-translate-y-1 hover:bg-white/[0.035] ${s.hover}`}>
                    <div className="flex items-center justify-between">
                      <SponsorLogo id={id} className="h-7 text-zinc-50" />
                      <span className="font-mono text-xs text-zinc-500">0{i + 1}</span>
                    </div>
                    <p className={`mt-8 text-xs font-medium uppercase tracking-[0.16em] ${s.text}`}>{s.job}</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">{s.product}</h3>
                    <ul className="mt-4 space-y-2">
                      {JOBS[id].points.map((p) => (
                        <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-zinc-300">
                          <span className={`mt-1 ${s.text}`}><Check className="size-3.5" /></span>{p}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-auto border-t border-white/[0.06] pt-4 text-sm leading-relaxed text-zinc-500"><span className="text-zinc-300">Without it: </span>{JOBS[id].without}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </Wrap>
      </Slide>

      {/* 04 · How it works */}
      <Slide id="flow" label="How it works" className="border-t border-white/[0.06] py-20 sm:py-24">
        <Wrap>
          <Reveal className="max-w-3xl">
            <Eyebrow n="04">How it works · eight steps from question to verdict</Eyebrow>
            <H2>One token check, <Accent>end to end.</Accent></H2>
          </Reveal>
          <Flow />
        </Wrap>
      </Slide>

      {/* 05 · 0G */}
      <Slide id="zerog" label="0G" className="py-20 sm:py-24">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(50%_60%_at_80%_0%,rgba(232,121,249,0.08),transparent)]" />
        <Wrap>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
            <Reveal>
              <SponsorLogo id="0g" className="mb-6 h-9 text-zinc-50" />
              <Eyebrow n="05">Decisions · 0G Private Computer</Eyebrow>
              <H2>The AI decides <Accent>what is worth buying.</Accent></H2>
              <Lead>Not a chat wrapper. Remove the model and the agent can't spend sensibly: it would buy the cheapest thing, or everything.</Lead>
              <SponsorFacts items={[
                <>Plan, decide and synthesize all run on the 0G Router, private trust mode, with <Code>verify_tee: true</Code>.</>,
                <>Every scored call on <Code>0gm-1.0-35b-a3b-sia</Code> returned <Code>tee_verified: true</Code> and a request ID, shown next to each purchase.</>,
                <>At most 4 inference calls per run. Inference is billed in 0G credits, kept apart from the data budget.</>,
              ]} />
            </Reveal>
            <Reveal delay={120}><DecideDemo /></Reveal>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <Reveal delay={120}>
              <blockquote className="fx-card h-full rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.04] p-6 sm:p-8">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-fuchsia-300">What breaks without 0G</p>
                <p className="mt-3 font-serif text-xl leading-snug text-zinc-100 sm:text-2xl">
                  “Without 0G, Kakashi can't tell which checks a trade is worth paying for (a cheapest-first rule buys KeyScan every time and misses whales and treasury dumps), and your token and trade size would go to an ordinary model provider in plaintext instead of sealed TEE inference that returns a trace ID for every decision.”
                </p>
              </blockquote>
            </Reveal>
            <Reveal delay={200}>
              <div className="fx-card h-full rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-zinc-100">Token eval questions</p>
                  <span className="text-xs text-zinc-500">exact match on what it buys</span>
                </div>
                <div className="mt-5"><EvalBars /></div>
                <p className="mt-4 text-xs leading-relaxed text-zinc-500">The eval set now covers token checks. Live scores are pending a re-run on the 0G Router.</p>
              </div>
            </Reveal>
          </div>
        </Wrap>
      </Slide>

      {/* 06 · World */}
      <Slide id="world" label="World" className="border-t border-white/[0.06] py-20 sm:py-24">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(50%_60%_at_20%_0%,rgba(125,211,252,0.07),transparent)]" />
        <Wrap>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
            <Reveal>
              <SponsorLogo id="world" className="mb-6 h-8 text-zinc-50" />
              <Eyebrow n="06">Human authorization · World ID Agent Pass</Eyebrow>
              <H2>World is never a login. <Accent>It grants spending authority.</Accent></H2>
              <Lead>A verified human approves one specific mandate version, and any single purchase above the auto-approve cap.</Lead>
              <SponsorFacts items={[
                <>OIDC device flow. The <Code>device_code</Code> and client secret stay on the server; the browser only sees a link and a code.</>,
                <>Every failure (denied, cancelled, expired, error, a different human) leaves the protected action undone.</>,
                <>13 seconds from device-flow start to a validated approval in our live test. World proofs are mocked for this event.</>,
              ]} />
            </Reveal>
            <Reveal delay={120}>
              <p className="mb-3 text-xs text-zinc-500">Try it: approve, or cancel to see the failure path.</p>
              <WorldDemo />
            </Reveal>
          </div>
        </Wrap>
      </Slide>

      {/* 07 · Hedera */}
      <Slide id="hedera" label="Hedera" className="py-20 sm:py-24">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(50%_60%_at_80%_0%,rgba(110,231,183,0.07),transparent)]" />
        <Wrap>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
            <Reveal>
              <SponsorLogo id="hedera" className="mb-6 h-8 text-zinc-50" />
              <Eyebrow n="07">Payments and audit · x402 on Hedera</Eyebrow>
              <H2>Pay per request. <Accent>Pay exactly once.</Accent></H2>
              <Lead>Merchants quote with HTTP 402. The isolated signer pays in USDC. If the response is lost, the mirror node settles the question, never a second payment.</Lead>
              <div className="mt-8 space-y-2">
                {[
                  ["PAYMENT-REQUIRED", "402 quote: price, recipient, asset, expiry"],
                  ["PAYMENT-SIGNATURE", "Signed transfer from the isolated signer"],
                  ["PAYMENT-RESPONSE", "Settlement transaction, checked against ours"],
                ].map(([h, d]) => (
                  <div key={h} className="flex flex-col gap-1 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <code className="font-mono text-xs text-emerald-300">{h}</code><span className="text-sm text-zinc-400">{d}</span>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={120}><PayOnceDemo /></Reveal>
          </div>
          <Reveal delay={120} className="mt-6">
            <div className="fx-card rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-zinc-100">Tamper-evident audit on the Hedera Consensus Service</p>
                <a href={hashscan("topic", HCS_TOPIC)} target="_blank" rel="noreferrer" className="text-link font-mono text-xs">topic {HCS_TOPIC}</a>
              </div>
              <p className="mt-1 text-sm text-zinc-400">Each event is written in the same transaction as the state change it describes, hash-chained to the one before, then anchored. No question text, preferences or World identifiers.</p>
              <div className="mt-4"><AuditChain /></div>
            </div>
          </Reveal>
        </Wrap>
      </Slide>

      {/* 08 · Attack lab */}
      <Slide id="security" label="Attack lab" className="border-t border-white/[0.06] py-20 sm:py-24">
        <Wrap>
          <Reveal className="max-w-3xl">
            <Eyebrow n="08">Security model</Eyebrow>
            <H2>Try to break it. <Accent>Six attacks, six walls.</Accent></H2>
            <Lead>Each scenario is a live fault on the demo merchants. Here is the layer that stops it and what you see in the app.</Lead>
          </Reveal>
          <div className="mt-12"><AttackLab /></div>
          <ul className="mt-10 grid gap-x-10 gap-y-6 border-t border-white/[0.06] pt-10 sm:grid-cols-2">
            {PRINCIPLES.map((p, i) => (
              <li key={p.t}>
                <Reveal delay={i * 80} className="flex gap-4">
                  <span aria-hidden="true" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-gold-400/10 text-gold-300 ring-1 ring-inset ring-gold-400/20"><Check /></span>
                  <div><h3 className="font-semibold text-zinc-100">{p.t}</h3><p className="mt-1 text-sm leading-relaxed text-zinc-400">{p.b}</p></div>
                </Reveal>
              </li>
            ))}
          </ul>
        </Wrap>
      </Slide>

      {/* 09 · Proof */}
      <Slide id="proof" label="Proof" className="py-20 sm:py-24">
        <Wrap>
          <Reveal className="max-w-3xl">
            <Eyebrow n="09">Proof</Eyebrow>
            <H2>Don't trust us. <Accent>Check.</Accent></H2>
            <Lead>Real transactions and trace IDs from the full stack on Hedera testnet and the live 0G Router.</Lead>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              <ProofLink key="tx" by="hedera" label="Settled payment" value={PROOF_TX} href={hashscanTx(PROOF_TX)} note="0.01 USDC through quote, permit, isolated signer and x402 settlement, confirmed on the mirror node." />,
              <ProofLink key="rec" by="hedera" label="Pay-once recovery" value={RECOVERY_TX} href={hashscanTx(RECOVERY_TX)} note="Response dropped after settlement. Confirmed on the mirror node, data recovered, one transfer only." />,
              <ProofLink key="hcs" by="hedera" label="Audit topic" value={HCS_TOPIC} href={hashscan("topic", HCS_TOPIC)} note="Hash-chained audit events anchored to the Hedera Consensus Service." />,
              <ProofLink key="usdc" by="hedera" label="Settlement asset" value={`USDC ${USDC}`} href={hashscan("token", USDC)} note="Testnet USDC, 6 decimals. No contracts deployed: Hedera native services only." />,
              <ProofLink key="zg" by="0g" label="0G decision trace" value="b6e49d9d-4973-40b2-bc4d-60bec63beb54" note="x_0g_trace.request_id of a live decide call (eval run 2, case 2, merchant hourlypro)." />,
              <ProofLink key="world" by="world" label="World integration" value="docs/WORLD_DEBRIEF.md" href={`${REPO}/blob/main/docs/WORLD_DEBRIEF.md`} note="Time to first success, friction, missing docs and our top improvement for Agent Pass." />,
            ].map((el, i) => <Reveal key={i} delay={i * 70} className="h-full">{el}</Reveal>)}
          </div>
        </Wrap>
      </Slide>

      {/* 10 · Live demo */}
      <Slide id="demo" label="Live demo" className="border-t border-white/[0.06] py-20 sm:py-24">
        <Wrap>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <Reveal className="max-w-3xl">
              <Eyebrow n="10">Live demo</Eyebrow>
              <H2>Now watch it <Accent>pay.</Accent></H2>
              <Lead>The script we run in front of you, under three minutes. Every scene maps to a sponsor requirement.</Lead>
            </Reveal>
            <a data-magnetic href="#/mandate" className={`${btn("primary", "lg")} shrink-0`}>Launch the app <Arrow /></a>
          </div>
          <ol className="mt-12 divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {SCRIPT.map((s, i) => (
              <li key={s.at}>
                <Reveal delay={i * 60} className="grid gap-3 py-6 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:gap-6">
                  <span className="font-mono text-sm text-gold-300">{s.at}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="mr-1 font-semibold text-zinc-100">{s.title}</h3>
                      {s.by.map((b) => <SponsorTag key={b} id={b} />)}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{s.steps}</p>
                    {s.q && <CopyChip text={s.q} />}
                  </div>
                  {s.href && (
                    <a href={s.href} {...(s.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                      onClick={s.href.startsWith("#") && !s.href.startsWith("#/") ? (e) => { e.preventDefault(); document.getElementById(s.href!.slice(1))?.scrollIntoView({ behavior: "smooth" }); } : undefined}
                      className={`${btn("ghost", "sm")} self-start`}>{s.cta} <Arrow /></a>
                  )}
                </Reveal>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-zinc-500">Demo drawer: bottom-right button on any app page while the server runs in demo mode.</p>
        </Wrap>
      </Slide>

      {/* 11 · Honest limits */}
      <Slide id="limits" label="Honest limits" className="py-20 sm:py-24">
        <Wrap>
          <Reveal className="max-w-3xl">
            <Eyebrow n="11">Honest limits</Eyebrow>
            <H2>What we don't claim.</H2>
            <Lead>We would rather you hear it from us.</Lead>
          </Reveal>
          <ul className="mt-12 grid gap-4 md:grid-cols-2">
            {LIMITS.map((l, i) => (
              <li key={i}>
                <Reveal delay={i * 70} className="fx-card h-full rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5 text-sm leading-relaxed text-zinc-300">{l}</Reveal>
              </li>
            ))}
          </ul>
        </Wrap>
      </Slide>

      {/* 12 · Stack and close */}
      <Slide id="close" label="Stack" className="border-t border-white/[0.06] py-20 sm:py-24">
        <Wrap>
          <Reveal className="max-w-3xl">
            <Eyebrow n="12">Under the hood</Eyebrow>
            <H2>Strict TypeScript, <Accent>four processes.</Accent></H2>
            <Lead>Server, isolated signer, demo merchants and the web app, on shared contracts in one pnpm workspace. 475 automated tests pass on fakes.</Lead>
          </Reveal>
          <dl className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-2 lg:grid-cols-4">
            {STACK.map(([k, v]) => (
              <div key={k} className="fx-card bg-ink px-5 py-5"><dt className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{k}</dt><dd className="mt-2 text-sm text-zinc-200">{v}</dd></div>
            ))}
          </dl>
          <Reveal className="relative mt-16 overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(120%_120%_at_50%_0%,rgba(240,185,85,0.14),transparent_60%)] px-6 py-16 text-center sm:py-24">
            <h2 className="mx-auto max-w-3xl text-balance text-3xl font-semibold tracking-[-0.03em] text-zinc-50 sm:text-5xl">
              Set the budget once. <span className="font-serif font-normal italic text-gold-300">Keep every receipt.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-zinc-400">Create a mandate, activate it with World ID, then check your first token.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a data-magnetic href="#/mandate" className={btn("primary", "lg")}>Get started <Arrow /></a>
              <a data-magnetic href={REPO} target="_blank" rel="noreferrer" className={btn("ghost", "lg")}>Source on GitHub</a>
            </div>
            <BuiltOn className="mt-12 justify-center gap-x-9" logo="h-6" />
          </Reveal>
        </Wrap>
      </Slide>
    </>
  );
}

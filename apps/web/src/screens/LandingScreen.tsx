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

/** Monochrome marks of the sponsors whose tracks Tollbooth targets. They inherit the text color. */
const SPONSORS: { name: string; href: string; logo: ReactNode }[] = [
  { name: "World", href: "https://world.org", logo: (
    <svg viewBox="0 0 96 24" className="h-6 w-auto sm:h-7" fill="currentColor"><path d="M12 24C9.83092 24 7.82536 23.4627 5.98665 22.3849C4.14794 21.3103 2.68966 19.8521 1.61513 18.0133C0.537264 16.1713 0 14.1691 0 12C0 9.83092 0.537264 7.82536 1.61513 5.98665C2.68966 4.14794 4.14794 2.68966 5.98665 1.61513C7.82536 0.537264 9.83092 0 12 0C14.1691 0 16.1746 0.537264 18.0133 1.61513C19.8521 2.69299 21.3103 4.14794 22.3849 5.98665C23.4594 7.82536 24 9.83092 24 12C24 14.1691 23.4627 16.1746 22.3849 18.0133C21.3103 19.8521 19.8521 21.3103 18.0133 22.3849C16.1746 23.4594 14.1691 24 12 24ZM1.01446 13.2747V10.7753H23.0089V13.2747H1.01446ZM12 21.4472C13.7019 21.4472 15.267 21.0267 16.6986 20.1858C18.1301 19.3448 19.2581 18.2002 20.0823 16.7486C20.9066 15.3003 21.317 13.7152 21.317 11.9967C21.317 10.2781 20.9032 8.69633 20.0823 7.24805C19.2581 5.79978 18.1301 4.65517 16.6986 3.8109C15.267 2.96997 13.7019 2.5495 12 2.5495C10.2981 2.5495 8.73304 2.96997 7.30145 3.8109C5.86985 4.65184 4.74194 5.79644 3.91769 7.24805C3.09344 8.69633 2.67964 10.2814 2.67964 11.9967C2.67964 13.7119 3.0901 15.297 3.91769 16.7486C4.74194 18.1969 5.86985 19.3415 7.30145 20.1858C8.73304 21.0267 10.2981 21.4472 12 21.4472ZM5.59622 12.1802V11.8665C5.59622 10.6352 5.88988 9.52058 6.48053 8.5228C7.07119 7.52503 7.89878 6.74082 8.96663 6.16685C10.0345 5.59288 11.2525 5.30923 12.624 5.30923H20.6663L21.7075 7.75528H12.6741C11.356 7.75528 10.2914 8.14238 9.48721 8.91324C8.67964 9.68409 8.27586 10.6685 8.27586 11.8665V12.1802C8.27586 13.3949 8.67964 14.3826 9.48721 15.1468C10.2948 15.911 11.356 16.2914 12.6741 16.2914H21.7075L20.6663 18.7375H12.624C11.2525 18.7375 10.0345 18.4505 8.96663 17.8799C7.89878 17.3059 7.07119 16.5217 6.48053 15.5239C5.88988 14.5261 5.59622 13.4116 5.59622 12.1802Z" /><path d="M31.4474 16.865L28.0078 5.30887H31.2893L34.5169 17.2555H33.7562L36.4083 7.0775C36.5665 6.47016 36.866 5.98962 37.3137 5.63256C37.7613 5.2755 38.2897 5.09863 38.9022 5.09863C39.5148 5.09863 40.0701 5.2755 40.5177 5.63256C40.9653 5.98962 41.2649 6.47016 41.423 7.0775L44.102 17.2555H43.3684L46.5455 5.30887H49.8L46.3873 16.865C45.9666 18.2866 45.1016 19.0007 43.7891 19.0007C42.4765 19.0007 41.5577 18.29 41.1908 16.865L38.5657 6.68706H39.2489L36.5968 16.865C36.4218 17.5258 36.129 18.0464 35.7184 18.4268C35.3078 18.8072 34.7524 19.0007 34.0524 19.0007C32.723 19.0007 31.8547 18.29 31.4542 16.865H31.4474Z" /><path d="M53.7762 18.1567C52.6655 17.5226 51.7938 16.6683 51.1645 15.5938C50.5351 14.5193 50.2188 13.328 50.2188 12.0265C50.2188 10.7251 50.5351 9.53708 51.1645 8.45922C51.7938 7.38469 52.6655 6.53041 53.7762 5.89637C54.8868 5.26233 56.1254 4.94531 57.4918 4.94531C58.8582 4.94531 60.1203 5.26233 61.2309 5.89637C62.3416 6.53041 63.2133 7.38469 63.8426 8.45922C64.472 9.53708 64.7884 10.7251 64.7884 12.0265C64.7884 13.328 64.472 14.5159 63.8426 15.5938C63.2133 16.6683 62.3416 17.526 61.2309 18.1567C60.1203 18.7907 58.8717 19.1077 57.4918 19.1077C56.1119 19.1077 54.8868 18.7907 53.7762 18.1567ZM59.6559 15.774C60.2785 15.3936 60.7631 14.873 61.1132 14.2123C61.4632 13.5515 61.6382 12.8241 61.6382 12.0265C61.6382 11.229 61.4632 10.4781 61.1132 9.8274C60.7631 9.17668 60.2785 8.65944 59.6559 8.27902C59.0332 7.89859 58.3197 7.70505 57.5153 7.70505C56.711 7.70505 55.9975 7.89526 55.3748 8.27902C54.7522 8.65944 54.2675 9.18002 53.9175 9.84075C53.5675 10.5015 53.3925 11.229 53.3925 12.0265C53.3925 12.8241 53.5675 13.5749 53.9175 14.2256C54.2675 14.8763 54.7522 15.3936 55.3748 15.774C55.9975 16.1544 56.7076 16.348 57.5153 16.348C58.3231 16.348 59.0332 16.1578 59.6559 15.774Z" /><path d="M66.5742 5.30951H69.6706V9.1371L69.435 8.82342C69.6436 7.62542 70.1788 6.71107 71.037 6.07703C71.8952 5.443 72.9083 5.12598 74.0828 5.12598H74.1872V8.22275H74.1098C72.6929 8.23944 71.6024 8.59984 70.8418 9.30395C70.0812 10.0081 69.7009 11.156 69.7009 12.7511V18.7378H66.5776V5.30951H66.5742Z" /><path d="M77.2555 17.7668C76.468 17.0627 76.0742 15.9681 76.0742 14.4731V0.157227H79.1975V14.0827C79.1975 14.7935 79.3422 15.3207 79.6316 15.6578C79.9211 15.9948 80.4226 16.175 81.1428 16.1917V18.8213H80.8264C79.2345 18.8213 78.0431 18.4709 77.2555 17.7668Z" /><path d="M84.8065 18.1939C83.7665 17.5866 82.9588 16.7457 82.39 15.6678C81.8212 14.5933 81.5352 13.3786 81.5352 12.0237C81.5352 10.6689 81.8246 9.47758 82.4001 8.39304C82.979 7.30851 83.7867 6.46423 84.8267 5.85689C85.8667 5.24955 87.0615 4.94588 88.4111 4.94588C89.69 4.94588 90.7939 5.2629 91.7329 5.89694C92.6685 6.53098 93.2508 7.35189 93.4796 8.35634L92.8772 8.25289V0.157227H96.0004V18.7412H92.8772V15.4108L93.4561 15.6978C93.3147 16.3385 93.0084 16.9259 92.5373 17.4564C92.0661 17.987 91.4704 18.3942 90.7535 18.6811C90.0366 18.9681 89.2558 19.1116 88.4178 19.1116C87.0514 19.1116 85.8498 18.808 84.8099 18.2006L84.8065 18.1939ZM90.9622 15.8246C91.5915 15.4442 92.0829 14.917 92.4329 14.2496C92.783 13.5821 92.958 12.8413 92.958 12.0237C92.958 11.2062 92.783 10.4653 92.4329 9.79794C92.0829 9.13053 91.5915 8.60662 90.9622 8.22286C90.3328 7.84243 89.6058 7.64888 88.7846 7.64888C87.9634 7.64888 87.2432 7.8391 86.6307 8.22286C86.0181 8.60328 85.5436 9.13053 85.2137 9.79794C84.8806 10.4653 84.7156 11.2095 84.7156 12.0237C84.7156 12.838 84.8806 13.5821 85.2137 14.2496C85.5469 14.917 86.0181 15.4442 86.6307 15.8246C87.2432 16.2051 87.9601 16.3986 88.7846 16.3986C89.6092 16.3986 90.3328 16.2084 90.9622 15.8246Z" /></svg>
  ) },
  { name: "0G", href: "https://0g.ai", logo: (
    <svg viewBox="0 0 80 38" className="h-7 w-auto sm:h-8" fill="currentColor"><path d="M80 19.9789C79.4954 30.0147 71.0221 38 60.6439 38C49.9409 38 41.2642 29.5068 41.2642 19.0302C41.2642 8.5534 49.9409 0.0605275 60.6439 0.0605275C70.6932 0.0605275 78.9559 7.54735 79.9282 17.1333H71.1274C70.2159 12.2768 65.869 8.597 60.6442 8.597C54.7572 8.597 49.9852 13.2681 49.9852 19.0302C49.9852 24.7925 54.7572 29.4636 60.6442 29.4636C65.1636 29.4636 69.0255 26.7104 70.5763 22.8243H55.7991V19.9789H80Z" /><path d="M6.37827 33.0376C13.9852 39.7845 25.7448 39.5663 33.0835 32.3833C40.6516 24.9751 40.6516 12.9643 33.0835 5.55603C25.5151 -1.85201 13.2445 -1.85201 5.67623 5.55603C-1.42961 12.5115 -1.8638 23.5243 4.37357 30.9758L10.5967 24.8844C7.73298 20.8195 8.1483 15.2087 11.8429 11.5923C16.0054 7.51782 22.7543 7.51782 26.917 11.5923C31.0793 15.6668 31.0793 22.2728 26.917 26.3473C23.7212 29.4754 19.0012 30.2021 15.0973 28.527L25.5464 18.2989L23.491 16.2871L6.37827 33.0376Z" /></svg>
  ) },
  { name: "Hedera", href: "https://hedera.com", logo: (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 24 24" className="size-7 sm:size-8" fill="currentColor"><path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm4.9571 17.3963h-1.5812V14.01H8.6224v3.3777H7.0498V6.6037H8.631v3.3845h6.7535V6.6037h1.5812zm-1.5812-6.2592H8.6224v1.7241h6.7535Z" /></svg>
      <span className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">Hedera</span>
    </span>
  ) },
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
            Kakashi is a research agent that buys only the evidence it needs, spends only inside a budget a verified human approved,
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

      <section aria-label="Sponsor tracks" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
        <Reveal>
          <p className="text-center text-[11px] uppercase tracking-[0.14em] text-zinc-500">Built for the sponsor tracks of</p>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-6 sm:gap-x-20">
            {SPONSORS.map((s) => (
              <li key={s.name}>
                <a href={s.href} target="_blank" rel="noreferrer" aria-label={s.name}
                  className="flex items-center rounded-lg text-zinc-400 transition-colors duration-300 hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 focus-visible:ring-offset-4 focus-visible:ring-offset-ink">
                  <span aria-hidden="true">{s.logo}</span>
                </a>
              </li>
            ))}
          </ul>
        </Reveal>
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

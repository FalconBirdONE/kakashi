import { useState, type ReactNode } from "react";
import { BuiltOn, SPONSORS, SPONSOR_ORDER, SponsorLogo, SponsorMark, SponsorTag, type SponsorId } from "../components/Brand";
import { Arrow, btn, hashscanTx, Reveal } from "../components/ui";
import DeckNav from "./landing/Deck";
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
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px] text-zinc-500">
              <span>Data spend 0.06 USDC</span>
              <span className="inline-flex items-center gap-1.5"><SponsorMark id="hedera" className="h-3" />2 receipts on Hedera</span>
              <span className="inline-flex items-center gap-1.5"><SponsorMark id="0g" className="h-2.5" />decided in a TEE</span>
              <span className="inline-flex items-center gap-1.5"><SponsorMark id="world" className="h-3" />1 human approval</span>
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
    points: ["Activates each mandate version", "Step-up approval for any purchase above the auto-approve cap", "Validated on the server and bound to the exact mandate or purchase hash"],
    without: "Anyone holding the session could hand the agent a budget. No human would stand behind a spend.",
  },
  "0g": {
    points: ["Plans the evidence a question needs", "Decides BUY or SKIP for every eligible quote, with a reason", "Writes the answer from purchased data, with no tools"],
    without: "Kakashi can't tell which evidence is worth paying for, and your private question goes to an ordinary provider in plaintext.",
  },
  hedera: {
    points: ["x402 quotes and USDC settlement on testnet", "Mirror-node reconciliation, so a lost response is never paid twice", "A hash-chained audit trail anchored to HCS"],
    without: "No pay-per-request data, and no tamper-evident record of what the agent bought.",
  },
};

const PRINCIPLES = [
  { t: "The model can't reach the money", b: "It never sees keys, URLs or raw merchant text, and can only pick from IDs the server generated." },
  { t: "Deterministic policy", b: "Merchant, recipient, asset, caps, budget, expiry, price and duplicates are checked in code. The budget is reserved in one database transaction." },
  { t: "An isolated signer", b: "A separate process holds the key. It signs only against a single-use permit bound to the exact payment, with its own hard ceilings." },
  { t: "A human for anything that matters", b: "Activating a mandate, and any purchase above the auto-approve cap, needs a fresh World ID authentication bound to that exact request." },
];

const SCRIPT: { at: string; title: string; steps: string; by: SponsorId[]; q?: string; href?: string; cta?: string }[] = [
  { at: "0:00", title: "Hook", steps: "Agents can't pay for data safely. Kakashi fixes that. Show the three jobs slide.", by: [] },
  { at: "0:12", title: "Mandate, failure path, then success", steps: "Create a mandate → Activate with World ID → cancel → the mandate stays inactive and a run is blocked → retry → verified → Active.", by: ["world"], href: "#/mandate", cta: "Open mandate" },
  { at: "0:35", title: "A paid request with no human", steps: "Ask the question → plan → quotes, PriceGouger rejected by policy → 0G buys QuickCast on its own → HashScan link and 0G request ID.", by: ["0g", "hedera"], q: "Will it rain in Mumbai this week?", href: "#/research", cta: "Open research" },
  { at: "1:10", title: "A different choice, and a step-up", steps: "0G picks HourlyPro, which is above the auto-approve cap → Approve with World ID → paid.", by: ["0g", "world"], q: "Is 6–8 am tomorrow good for a run in Bandra?", href: "#/research", cta: "Open research" },
  { at: "1:35", title: "No double pay", steps: "Demo drawer → QuickCast → DROP_AFTER_SETTLE → buy → “Pending reconciliation” → mirror node confirms → data recovered → one payment on HashScan.", by: ["hedera"], href: "#/research", cta: "Open research" },
  { at: "2:05", title: "Injection and audit", steps: "Demo drawer → QuickCast → INJECT_TEXT → rerun → the answer flags the embedded instructions, no extra purchases → open the HCS topic.", by: ["0g", "hedera"], href: hashscan("topic", HCS_TOPIC), cta: "Open HCS topic" },
  { at: "2:25", title: "Close", steps: "Three sponsors, three jobs. The 0G sentence. The honest limits.", by: ["world", "0g", "hedera"], href: "#limits", cta: "Jump to limits" },
];

const LIMITS = [
  "Spending limits are enforced by our backend and the isolated signer, not on-chain. In this demo the operator holds the agent key, so Kakashi is custodial.",
  "World authenticates the human, and we record their approval of a specific mandate or purchase. The user does not sign the payment: the agent's key does. World proofs are mocked for this event.",
  "The 0G Router reports TEE verification for each decision. We record that report and the trace ID; we don't verify the attestation independently.",
  "Untrusted model output can't bypass the spending rules. Prompt injection in merchant data can still distort the written answer, so Kakashi flags suspicious content.",
  "HCS makes our recorded history tamper-evident. It doesn't make it a complete, trustless audit.",
  "The data merchants are demo APIs on Hedera testnet, and one of them is deliberately adversarial.",
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
  const cls = "group block h-full rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition-colors duration-300";
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

      {/* 01 · Intro */}
      <Slide id="intro" label="Intro" className="-mt-16 overflow-hidden pt-16">
        <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-300px] h-[600px] w-[min(1000px,140vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(240,185,85,0.16),transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-14 text-center sm:px-6 sm:pb-28 sm:pt-20">
          <p className="animate-rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-300">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-gold-400 shadow-[0_0_10px_2px_rgba(240,185,85,0.5)]" />
            ETHGlobal Mumbai 2026 · Research with receipts
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
            <button type="button" onClick={() => document.getElementById("flow")?.scrollIntoView({ behavior: "smooth" })}
              className={`${btn("ghost", "lg")} w-full sm:w-auto`}>See how it works</button>
          </div>
          <div className="animate-rise mt-12 flex flex-col items-center gap-4 [animation-delay:320ms]">
            <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Built on</p>
            <BuiltOn className="justify-center gap-x-10" logo="h-7" />
          </div>
          <div className="animate-rise mx-auto mt-14 max-w-4xl sm:mt-16 [animation-delay:420ms]">
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
            ))}
          </div>
          <Reveal delay={200} className="mt-6">
            <div className="flex flex-col gap-5 rounded-2xl border border-gold-400/20 bg-gold-400/[0.04] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
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
                  <article className={`group flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 transition-all duration-500 hover:-translate-y-1 hover:bg-white/[0.035] ${s.hover}`}>
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
            <Eyebrow n="04">How it works · eight steps from question to receipt</Eyebrow>
            <H2>One research run, <Accent>end to end.</Accent></H2>
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
              <blockquote className="h-full rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/[0.04] p-6 sm:p-8">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-fuchsia-300">What breaks without 0G</p>
                <p className="mt-3 font-serif text-xl leading-snug text-zinc-100 sm:text-2xl">
                  “Without 0G, Kakashi can't decide which evidence is worth paying for, and the user's private question, preferences and spending limits would go to an ordinary model provider in plaintext instead of sealed TEE inference that returns a trace ID for every purchase decision.”
                </p>
              </blockquote>
            </Reveal>
            <Reveal delay={200}>
              <div className="h-full rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-zinc-100">Six eval questions</p>
                  <span className="text-xs text-zinc-500">exact match on what it buys</span>
                </div>
                <div className="mt-5"><EvalBars /></div>
                <p className="mt-4 text-xs leading-relaxed text-zinc-500">Our target was 5/6 in both runs. Run 1 lost one case to a 30 s provider timeout. Both runs beat the rule.</p>
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
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6">
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
              <ProofLink key="zg" by="0g" label="0G decision trace" value="b6e49d9d-4973-40b2-bc4d-60bec63beb54" note="x_0g_trace.request_id of a live decide call (eval run 2, case 2: HourlyPro)." />,
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
            <a href="#/mandate" className={`${btn("primary", "lg")} shrink-0`}>Launch the app <Arrow /></a>
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
                <Reveal delay={i * 70} className="h-full rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5 text-sm leading-relaxed text-zinc-300">{l}</Reveal>
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
              <div key={k} className="bg-ink px-5 py-5"><dt className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{k}</dt><dd className="mt-2 text-sm text-zinc-200">{v}</dd></div>
            ))}
          </dl>
          <Reveal className="relative mt-16 overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(120%_120%_at_50%_0%,rgba(240,185,85,0.14),transparent_60%)] px-6 py-16 text-center sm:py-24">
            <h2 className="mx-auto max-w-3xl text-balance text-3xl font-semibold tracking-[-0.03em] text-zinc-50 sm:text-5xl">
              Set the budget once. <span className="font-serif font-normal italic text-gold-300">Keep every receipt.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-zinc-400">Create a mandate, activate it with World ID, then ask your first question.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#/mandate" className={btn("primary", "lg")}>Get started <Arrow /></a>
              <a href={REPO} target="_blank" rel="noreferrer" className={btn("ghost", "lg")}>Source on GitHub</a>
            </div>
            <BuiltOn className="mt-12 justify-center gap-x-9" logo="h-6" />
          </Reveal>
        </Wrap>
      </Slide>
    </>
  );
}

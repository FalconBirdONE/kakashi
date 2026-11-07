import { useRef, useState } from "react";
import { MARKS, SPONSORS, SponsorTag, type SponsorId } from "../../components/Brand";
import { Controls, reducedMotion, useInView, useTicker, Wire } from "./kit";

type NodeId = "you" | "server" | "world" | "zg" | "merchants" | "signer" | "hedera" | "facilitator";
type Box = { x: number; y: number; w: number; h: number; title: string; sub: string; mark?: SponsorId };

// Three rows on a 960 x 520 canvas: sponsors that think and approve on top, money at the bottom.
const NODES: Record<NodeId, Box> = {
  world: { x: 250, y: 30, w: 200, h: 76, title: "World ID", sub: "Agent Pass · OIDC", mark: "world" },
  zg: { x: 490, y: 30, w: 200, h: 76, title: "0G Router", sub: "Private TEE tier", mark: "0g" },
  you: { x: 16, y: 218, w: 170, h: 84, title: "You", sub: "Browser · no secrets" },
  server: { x: 250, y: 208, w: 440, h: 104, title: "Kakashi server", sub: "Orchestrator · Policy engine · SQLite ledger" },
  merchants: { x: 754, y: 218, w: 190, h: 84, title: "Check sellers", sub: "4 paid checks over x402" },
  signer: { x: 250, y: 414, w: 200, h: 76, title: "Isolated signer", sub: "Agent key only" },
  hedera: { x: 490, y: 414, w: 200, h: 76, title: "Hedera testnet", sub: "USDC · mirror · HCS", mark: "hedera" },
  facilitator: { x: 754, y: 414, w: 190, h: 76, title: "x402 facilitator", sub: "verify · settle" },
};

// Straight edges between box borders. Order of the pair is the default packet direction.
const EDGES = {
  youServer: "M186 260 H250",
  serverWorld: "M350 208 V106",
  serverZg: "M590 208 V106",
  serverMerchants: "M690 260 H754",
  serverSigner: "M350 312 V414",
  serverHedera: "M590 312 V414",
  merchantsFacilitator: "M849 302 V414",
  facilitatorHedera: "M754 452 H690",
} as const;
type EdgeId = keyof typeof EDGES;

type Step = {
  title: string; by: SponsorId[]; nodes: NodeId[]; edges: [EdgeId, "fwd" | "back" | "both"][];
  body: string; wire: string;
};

const STEPS: Step[] = [
  {
    title: "A human approves the mandate", by: ["world"], nodes: ["you", "server", "world"], edges: [["youServer", "fwd"], ["serverWorld", "both"]],
    body: "You set a total budget, a per-payment cap, an auto-approve cap, the allowed check sellers and an expiry. World ID runs an OIDC device flow. The server validates the ID token and records an approval bound to this exact mandate version.",
    wire: `POST /api/mandates/:id/activate
← verificationUri, userCode        (device_code stays on the server)
ID token ✓ JWKS · iss · aud · exp · auth_time ≥ start − 5 s
Approval(APPROVED, targetHash = mandateHash)   → mandate ACTIVE`,
  },
  {
    title: "0G plans which risks matter", by: ["0g"], nodes: ["server", "zg"], edges: [["serverZg", "both"]],
    body: "Your question, preferences and the mandate summary go to sealed inference on the 0G Router's private TEE tier. It returns the risks worth checking and a normalized query: the token ID and your trade size. Every call returns a trace ID.",
    wire: `POST router-api.0g.ai/v1/chat/completions
X-0G-Provider-Trust-Mode: private      verify_tee: true
← query: { "tokenId": "0.0.731861", "tradeUsd": 2000 }
← needs: [ "issuer keys", "whale wallets", "treasury selling" ]
← x_0g_trace.request_id   b15b4d21-465a-4540-…   tee_verified: true`,
  },
  {
    title: "Check sellers quote over x402", by: ["hedera"], nodes: ["server", "merchants"], edges: [["serverMerchants", "both"]],
    body: "Kakashi calls every allowed check seller without paying. Only the token ID leaves the server, never the trade size. Each one answers 402 Payment Required with a price, recipient, asset and expiry. Quotes are free, and the quote is hashed so a purchase is bound to its exact fields.",
    wire: `GET /m/quickcast/keys?tokenId=0.0.731861
← 402 Payment Required
PAYMENT-REQUIRED: { "scheme": "exact", "network": "hedera:testnet",
  "asset": "0.0.429274", "amount": "10000", "payTo": "0.0.11341852" }`,
  },
  {
    title: "Policy screens every quote", by: [], nodes: ["server"], edges: [],
    body: "Plain code checks merchant, recipient, asset, fee payer, caps, budget, price range, expiry and duplicates. InsiderAlpha's 0.50 USDC quote fails, so the model never sees it as something it could buy.",
    wire: `quickcast    0.01 USDC   ✓ eligible
hourlypro    0.05 USDC   ✓ eligible · above auto-approve (0.02)
groundtruth  0.03 USDC   ✓ eligible · above auto-approve (0.02)
gouger       0.50 USDC   ✗ OVER_PER_PAYMENT_CAP, PRICE_ANOMALY`,
  },
  {
    title: "0G decides which checks the trade justifies", by: ["0g"], nodes: ["server", "zg"], edges: [["serverZg", "both"]],
    body: "The model sees eligible quotes as structured fields only: no keys, no URLs, no merchant text. It weighs each check's price against the trade size and answers BUY or SKIP for each server-generated quote ID, with a reason code and expected usefulness.",
    wire: `q_quickcast    BUY    FILLS_NEED   issuer keys first, 0.01 on 2,000 USD
q_groundtruth  BUY    FILLS_NEED   whales matter at this size
q_hourlypro    BUY    FILLS_NEED   mints or treasury selling would dilute
trace b6e49d9d-4973-40b2-…   tee_verified: true`,
  },
  {
    title: "A human approves the bigger checks", by: ["world"], nodes: ["you", "server", "world"], edges: [["youServer", "both"], ["serverWorld", "both"]],
    body: "The budget is reserved in one SQLite transaction. KeyScan sits under the auto-approve cap and goes straight through. TreasuryWatch costs more, so it waits for a fresh World ID approval bound to this purchase. Deny it and nothing is paid.",
    wire: `UPDATE mandates SET reserved = reserved + 50000
 WHERE state = 'ACTIVE' AND spent + reserved + 50000 <= totalBudget
→ AWAITING_APPROVAL     short code 3F9A2C (purchaseHash)
World ID ✓ → RESERVED, single-use signing permit issued`,
  },
  {
    title: "An isolated signer pays on Hedera", by: ["hedera"], nodes: ["server", "signer", "merchants", "facilitator", "hedera"],
    edges: [["serverSigner", "both"], ["serverMerchants", "fwd"], ["merchantsFacilitator", "fwd"], ["facilitatorHedera", "fwd"]],
    body: "A separate process that holds only the agent key signs against an HMAC-signed, single-use permit matching the exact payment. The transaction ID is saved before anything is sent. The facilitator settles USDC on Hedera.",
    wire: `signer ✓ permit: MAC · unexpired · unused · amount · payTo · feePayer
SIGNED     tx 0.0.9185802@<seconds>.<nanos>   (stored before sending)
GET /m/hourlypro/treasury?tokenId=0.0.731861   PAYMENT-SIGNATURE: <signed transfer>
← 200   PAYMENT-RESPONSE: { "success": true, "transaction": <same tx> }`,
  },
  {
    title: "A verdict with receipts, anchored on HCS", by: ["0g", "hedera"], nodes: ["you", "server", "zg", "hedera"],
    edges: [["serverHedera", "both"], ["serverZg", "both"], ["youServer", "back"]],
    body: "The mirror node confirms the transfer. 0G writes BUY, CAUTION or AVOID from the purchased checks, wrapped as untrusted and with no tools, and cites each purchase. Hash-chained audit events are anchored to an HCS topic.",
    wire: `mirror  SUCCESS   AGENT −50000 · hourlypro +50000   (0.05 USDC)
answer  **CAUTION** cites [pur_…]   suspiciousContent: []
HCS     topic 0.0.11341856  { "type": "PURCHASE_CONFIRMED",
        "tx": "0.0.9185802@…", "zg": "…", "prev": "<hash>" }`,
  },
];

const STEP_MS = 6500; // one step at 1× speed
const SPEEDS = [0.5, 1, 1.5, 2, 3] as const;
const GOLD = "#f0b955";

function Node({ id, box, on, color }: { id: NodeId; box: Box; on: boolean; color: string }) {
  const m = box.mark ? MARKS[box.mark] : null;
  const markH = box.mark === "0g" ? 14 : 18;
  const markW = m ? (m.w / m.h) * markH : 0;
  const tx = box.x + 16;
  return (
    <g data-node={id} className="transition-opacity duration-500" opacity={on ? 1 : 0.42}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={14} fill={on ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.015)"}
        stroke={on ? color : "rgba(255,255,255,0.1)"} strokeOpacity={on ? 0.75 : 1} strokeWidth={on ? 1.5 : 1} className="transition-[stroke,fill] duration-500" />
      {m && (
        <svg x={tx} y={box.y + 18} width={markW} height={markH} viewBox={m.viewBox} fill={on ? "#fafafa" : "#a1a1aa"} aria-hidden="true">
          <path d={m.d} />
        </svg>
      )}
      <text x={m ? tx + markW + 8 : tx} y={box.y + 32} fontSize={15} fontWeight={600} fill={on ? "#fafafa" : "#d4d4d8"}>{box.title}</text>
      <text x={tx} y={box.y + 54} fontSize={12} fill="#a1a1aa">{box.sub}</text>
      {id === "server" && (
        <g fontSize={11} fontFamily="Geist Mono, ui-monospace, monospace" fill="#a1a1aa">
          {["orchestrator", "policy · 12 rules", "ledger · outbox"].map((t, i) => (
            <g key={t}>
              <rect x={box.x + 16 + i * 140} y={box.y + 68} width={128} height={22} rx={6} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" />
              <text x={box.x + 26 + i * 140} y={box.y + 83}>{t}</text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
}

/** Architecture diagram plus an 8-step walkthrough of one token check. Autoplays while on screen. */
export default function Flow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [paused, setPaused] = useState(reducedMotion);
  const playing = inView && !paused;
  const [speed, setSpeed] = useState(1.5);
  const stepMs = Math.round(STEP_MS / speed);
  const [i, setI] = useTicker(STEPS.length, stepMs, playing);
  const step = STEPS[i]!;
  const color = step.by[0] ? SPONSORS[step.by[0]].hex : GOLD;
  const pick = (n: number) => { setI((n + STEPS.length) % STEPS.length); setPaused(true); };

  return (
    <div ref={ref} className="mt-8 space-y-4">
      <div className="rounded-2xl border border-white/[0.07] bg-[#0a0b0e] p-3 sm:p-5">
        <svg viewBox="0 0 960 520" className="mx-auto h-auto max-h-[50vh] w-full font-sans" role="img"
          aria-label={`Architecture diagram. Step ${i + 1}: ${step.title}`}>
          <defs>
            <pattern id="flow-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.05)" /></pattern>
          </defs>
          <rect width="960" height="520" fill="url(#flow-dots)" />
          {/* trust boundary around the signer: it holds the key and nothing else */}
          <rect x={238} y={402} width={224} height={100} rx={20} fill="none" stroke="rgba(240,185,85,0.35)" strokeDasharray="4 6" />
          <text x={244} y={516} fontSize={11} fill="rgba(240,185,85,0.7)">separate process · HMAC permits</text>
          {(Object.keys(EDGES) as EdgeId[]).map((e) => {
            const hit = step.edges.find(([id]) => id === e);
            return (
              <g key={e}>
                <path d={EDGES[e]} stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} fill="none" />
                {hit && (
                  <path key={`${e}-${i}`} d={EDGES[e]} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray="6 10"
                    className={hit[1] === "back" ? "flow-dash-back" : hit[1] === "both" ? "flow-dash-both" : "flow-dash"} />
                )}
              </g>
            );
          })}
          {(Object.keys(NODES) as NodeId[]).map((n) => <Node key={n} id={n} box={NODES[n]} on={step.nodes.includes(n)} color={color} />)}
        </svg>
      </div>

      <div className="grid grid-cols-1 gap-x-10 gap-y-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" aria-live="polite">
        <div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-zinc-500">Step {String(i + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}</span>
          <div className="flex flex-wrap justify-end gap-1.5">
            {step.by.length === 0 ? <span className="rounded-full border border-gold-400/25 bg-gold-400/[0.06] px-2 py-0.5 text-[11px] font-medium text-gold-300">Kakashi policy</span>
              : step.by.map((s) => <SponsorTag key={s} id={s} />)}
          </div>
        </div>
        <h3 key={`t${i}`} className="animate-rise mt-4 text-xl font-semibold tracking-tight text-zinc-50 sm:text-2xl">{step.title}</h3>
        <p key={`b${i}`} className="animate-rise mt-3 text-[15px] leading-relaxed text-zinc-400 [animation-delay:60ms]">{step.body}</p>
        </div>
        <Wire key={`w${i}`} className="animate-rise self-center whitespace-pre [animation-delay:120ms]">{step.wire}</Wire>
        <div className="lg:col-span-2">
          <div className="flex gap-1" aria-hidden="true">
            {STEPS.map((_, n) => (
              <span key={n} className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                {n < i && <span className="block h-full w-full rounded-full bg-white/30" />}
                {n === i && <span key={`p${i}-${playing}-${stepMs}`} className="block h-full rounded-full"
                  style={{ background: color, width: playing ? undefined : "100%", animation: playing ? `fill-x ${stepMs}ms linear both` : undefined }} />}
              </span>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <Controls label="Walkthrough" playing={playing} onToggle={() => setPaused(playing)} onPrev={() => pick(i - 1)} onNext={() => pick(i + 1)} />
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                Speed
                <input type="range" min={0} max={SPEEDS.length - 1} step={1} value={SPEEDS.indexOf(speed as (typeof SPEEDS)[number])}
                  onChange={(e) => setSpeed(SPEEDS[Number(e.target.value)]!)} aria-valuetext={`${speed}×`}
                  className="w-20 accent-gold-400 sm:w-24" />
                <span className="w-7 font-mono text-zinc-300">{speed}×</span>
              </label>
            </div>
            <ol className="flex flex-wrap justify-end gap-1">
              {STEPS.map((s, n) => (
                <li key={s.title}>
                  <button type="button" onClick={() => pick(n)} aria-label={`Step ${n + 1}: ${s.title}`} aria-current={n === i ? "step" : undefined}
                    className={`size-7 rounded-full font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 ${n === i ? "bg-white/[0.12] text-zinc-50" : "text-zinc-500 hover:text-zinc-200"}`}>
                    {n + 1}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import type { MerchantFault } from "@kakashi/contracts";
import { MERCHANT_REGISTRY } from "@kakashi/contracts/registry";
import { api } from "../api";
import { Button, ErrorText } from "./ui";

const FAULTS: MerchantFault[] = ["NONE", "DROP_AFTER_SETTLE", "SWAP_PAYTO", "STALE_DATA", "INJECT_TEXT"];

/** Demo-only controls (rendered only when the server reports DEMO_MODE). Fault state is write-only: the server has no getter. */
export default function DemoDrawer() {
  const [open, setOpen] = useState(false);
  const [faults, setFaults] = useState<Record<string, MerchantFault>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function guarded(f: () => Promise<void>) {
    setErr(null); setMsg(null);
    try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : "request failed"); }
  }
  const setFault = (id: string, fault: MerchantFault) =>
    guarded(async () => { await api.setFault(id, fault); setFaults((s) => ({ ...s, [id]: fault })); });
  const revokeNow = () => guarded(async () => {
    const { mandate } = await api.getMandate();
    if (!mandate || mandate.state === "REVOKED") { setMsg("No mandate to revoke."); return; }
    await api.revokeMandate(mandate.id);
    setMsg("Mandate revoked.");
  });
  const active = Object.values(faults).filter((f) => f !== "NONE").length;

  return (
    <aside className="fixed bottom-4 right-4 z-30 flex flex-col items-end gap-3 text-sm" aria-label="Demo controls">
      {open && (
        <div id="demo-panel" className="animate-menu-in max-h-[70vh] w-[min(360px,calc(100vw-2rem))] space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <p className="text-xs text-zinc-500">Merchant faults (write-only; reload shows None even if one is active).</p>
          <ul className="space-y-2.5">
            {MERCHANT_REGISTRY.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3">
                <label htmlFor={`fault-${m.id}`} className="text-zinc-200">{m.name}</label>
                <select id={`fault-${m.id}`} value={faults[m.id] ?? "NONE"} onChange={(e) => void setFault(m.id, e.target.value as MerchantFault)}
                  className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-zinc-200 focus:border-gold-400/50 focus:outline-none">
                  {FAULTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
            <Button variant="ghost" size="sm" onClick={() => void Promise.all(MERCHANT_REGISTRY.map((m) => setFault(m.id, "NONE")))}>Clear all faults</Button>
            <Button variant="danger" size="sm" onClick={() => void revokeNow()}>Revoke mandate now</Button>
          </div>
          {msg && <p className="text-emerald-300">{msg}</p>}
          {err && <ErrorText>{err}</ErrorText>}
        </div>
      )}
      <button aria-expanded={open} aria-controls="demo-panel" onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/90 px-4 py-2 text-xs font-medium text-zinc-300 shadow-lg shadow-black/40 backdrop-blur-xl transition-colors hover:text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70">
        <span aria-hidden="true" className={`size-1.5 rounded-full ${active ? "bg-amber-400" : "bg-zinc-500"}`} />
        Demo controls {open ? "▾" : "▴"}
      </button>
    </aside>
  );
}

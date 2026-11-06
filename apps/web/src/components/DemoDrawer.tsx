import { useState } from "react";
import type { MerchantFault } from "@tollbooth/contracts";
import { MERCHANT_REGISTRY } from "@tollbooth/contracts/registry";
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

  return (
    <aside className="fixed inset-x-0 bottom-0 border-t border-slate-700 bg-slate-900 text-sm" aria-label="Demo controls">
      <div className="mx-auto max-w-3xl px-4">
        <button className="w-full py-2 text-left text-slate-300" aria-expanded={open} onClick={() => setOpen(!open)}>
          Demo controls {open ? "▾" : "▴"}
        </button>
        {open && (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pb-4">
            <p className="text-xs text-slate-400">Merchant faults (write-only; reload shows None even if one is active).</p>
            <ul className="space-y-2">
              {MERCHANT_REGISTRY.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`fault-${m.id}`}>{m.name}</label>
                  <select id={`fault-${m.id}`} value={faults[m.id] ?? "NONE"} onChange={(e) => void setFault(m.id, e.target.value as MerchantFault)}
                    className="rounded border border-slate-600 bg-slate-950 px-2 py-1">
                    {FAULTS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void Promise.all(MERCHANT_REGISTRY.map((m) => setFault(m.id, "NONE")))}>Clear all faults</Button>
              <Button variant="danger" onClick={() => void revokeNow()}>Revoke mandate now</Button>
            </div>
            {msg && <p className="text-emerald-300">{msg}</p>}
            {err && <ErrorText>{err}</ErrorText>}
          </div>
        )}
      </div>
    </aside>
  );
}

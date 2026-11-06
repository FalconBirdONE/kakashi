import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AuthAttemptPublic, AuthAttemptResult, Mandate } from "@tollbooth/contracts";
import { toAtomic, cmpA } from "@tollbooth/contracts/money";
import { MERCHANT_REGISTRY } from "@tollbooth/contracts/registry";
import { api, ApiError } from "../api";
import { AuthFlow } from "../components/AuthFlow";
import MandateSummary from "../components/MandateSummary";
import { Button, Card, ErrorText, inputCls, Label, usdc } from "../components/ui";

const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");

function parse(label: string, v: string): { a?: string; err?: string } {
  try {
    const a = toAtomic(v.trim(), 6);
    return a === "0" ? { err: `${label} must be more than zero.` } : { a };
  } catch {
    return { err: `${label} must be a number like 0.10 with at most 6 decimals.` };
  }
}

export default function MandateScreen() {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<AuthAttemptPublic | null>(null);
  const [lastResult, setLastResult] = useState<AuthAttemptResult | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const [total, setTotal] = useState("0.20");
  const [cap, setCap] = useState("0.10");
  const [auto, setAuto] = useState("0.02");
  const [merchants, setMerchants] = useState<string[]>(MERCHANT_REGISTRY.map((m) => m.id));
  const [maxPurchases, setMaxPurchases] = useState("3");
  const [minutes, setMinutes] = useState("30");
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const [prefs, setPrefs] = useState("");
  const [prefsMsg, setPrefsMsg] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try { setMandate((await api.getMandate()).mandate); setError(null); } catch (e) { setError(errMsg(e)); }
    setLoaded(true);
  }, []);
  useEffect(() => { void refetch(); }, [refetch]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    const t = parse("Total budget", total), c = parse("Per-payment cap", cap), a = parse("Auto-approve cap", auto);
    [t, c, a].forEach((x) => x.err && errs.push(x.err));
    if (t.a && c.a && a.a && !(cmpA(a.a, c.a) <= 0 && cmpA(c.a, t.a) <= 0)) errs.push("Auto-approve cap must not exceed the per-payment cap, which must not exceed the total budget.");
    const mp = Number(maxPurchases), mins = Number(minutes);
    if (!Number.isInteger(mp) || mp < 1) errs.push("Max purchases per run must be a whole number, at least 1.");
    if (!Number.isFinite(mins) || mins <= 0) errs.push("Expiry must be a number of minutes greater than zero.");
    if (merchants.length === 0) errs.push("Pick at least one merchant.");
    setFormErrors(errs);
    if (errs.length) return;
    try {
      setMandate(await api.createMandate({
        totalBudgetAtomic: t.a!, perPaymentCapAtomic: c.a!, autoApproveCapAtomic: a.a!, allowedMerchantIds: merchants,
        maxPurchasesPerRun: mp, expiresAt: new Date(Date.now() + mins * 60_000).toISOString(),
      }));
      setError(null); setAttempt(null); setLastResult(null);
    } catch (e2) { setError(errMsg(e2)); }
  }

  async function activate() {
    if (!mandate) return;
    try { setAttempt(await api.activateMandate(mandate.id)); setLastResult(null); setError(null); } catch (e) { setError(errMsg(e)); }
  }
  async function revoke() {
    if (!mandate) return;
    try { await api.revokeMandate(mandate.id); setConfirmRevoke(false); await refetch(); } catch (e) { setError(errMsg(e)); }
  }
  async function savePrefs() {
    try { await api.setPreferences(prefs); setPrefsMsg("Saved."); setError(null); } catch (e) { setPrefsMsg(null); setError(errMsg(e)); }
  }

  const activatable = mandate && (mandate.state === "DRAFT" || mandate.state === "PENDING_APPROVAL");
  const failed = lastResult !== null && lastResult !== "VERIFIED";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Mandate</h1>
      <p className="text-sm text-slate-300">World authenticates the human. Tollbooth records their approval of this specific mandate.</p>
      <p className="text-xs text-slate-400">World proofs are mocked for this event.</p>
      {error && <ErrorText>{error}</ErrorText>}

      {mandate && (
        <>
          <MandateSummary mandate={mandate} />
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              {activatable && !attempt && <Button onClick={activate}>Activate with World ID</Button>}
              {activatable && failed && <Button onClick={activate}>Try again</Button>}
              {mandate.state === "ACTIVE" && !confirmRevoke && <Button variant="danger" onClick={() => setConfirmRevoke(true)}>Revoke</Button>}
              {mandate.state === "ACTIVE" && confirmRevoke && (
                <>
                  <span className="text-sm text-slate-100">Revoke this mandate?</span>
                  <Button variant="danger" onClick={revoke}>Yes</Button>
                  <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>No</Button>
                </>
              )}
            </div>
            {activatable && attempt && (
              <div className="mt-3">
                <AuthFlow key={attempt.id} attempt={attempt} onResult={(r) => { setLastResult(r); if (r !== "SUPERSEDED") { void refetch(); } }} />
                {failed && <div className="mt-2"><Button onClick={activate}>Try again</Button></div>}
              </div>
            )}
          </Card>
        </>
      )}

      {loaded && (!mandate || !["DRAFT", "PENDING_APPROVAL", "ACTIVE"].includes(mandate.state)) && (
        <Card title="Create a mandate">
          <form onSubmit={create} className="space-y-3" aria-label="Create mandate">
            {([["Total budget (USDC)", total, setTotal], ["Per-payment cap (USDC)", cap, setCap], ["Auto-approve cap (USDC)", auto, setAuto]] as const).map(([l, v, set]) => (
              <label key={l} className="block"><Label>{l}</Label><input className={inputCls} inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} /></label>
            ))}
            <fieldset>
              <legend className="mb-1 text-sm text-slate-300">Allowed merchants</legend>
              {MERCHANT_REGISTRY.map((m) => (
                <label key={m.id} className="flex items-center gap-2 py-1 text-sm text-slate-100">
                  <input type="checkbox" checked={merchants.includes(m.id)}
                    onChange={(e) => setMerchants(e.target.checked ? [...merchants, m.id] : merchants.filter((x) => x !== m.id))} />
                  {m.name} <span className="text-slate-400">({usdc(m.priceAtomic)})</span>
                </label>
              ))}
            </fieldset>
            <label className="block"><Label>Max purchases per run</Label><input className={inputCls} inputMode="numeric" value={maxPurchases} onChange={(e) => setMaxPurchases(e.target.value)} /></label>
            <label className="block"><Label>Expires in (minutes)</Label><input className={inputCls} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
            {formErrors.map((x) => <ErrorText key={x}>{x}</ErrorText>)}
            <Button type="submit">Create mandate</Button>
          </form>
        </Card>
      )}

      <Card title="Preferences">
        <label className="block">
          <Label>Used by the AI, not enforced</Label>
          <textarea className={inputCls} rows={3} value={prefs} onChange={(e) => { setPrefs(e.target.value); setPrefsMsg(null); }} />
        </label>
        <div className="mt-2 flex items-center gap-3">
          <Button variant="ghost" onClick={savePrefs}>Save preferences</Button>
          {prefsMsg && <span role="status" className="text-sm text-emerald-300">{prefsMsg}</span>}
        </div>
      </Card>
    </div>
  );
}

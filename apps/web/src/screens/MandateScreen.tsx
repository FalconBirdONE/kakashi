import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AuthAttemptPublic, AuthAttemptResult, Mandate } from "@kakashi/contracts";
import { toAtomic, cmpA } from "@kakashi/contracts/money";
import { MERCHANT_REGISTRY } from "@kakashi/contracts/registry";
import { api, ApiError } from "../api";
import { AuthFlow } from "../components/AuthFlow";
import MandateSummary from "../components/MandateSummary";
import { SponsorMark } from "../components/Brand";
import { Arrow, btn, Button, Card, ErrorText, inputCls, Label, PageHeader, usdc } from "../components/ui";

const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");
const humanize = (slug = "") => slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");

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
  const canCreate = loaded && (!mandate || !["DRAFT", "PENDING_APPROVAL", "ACTIVE"].includes(mandate.state));

  return (
    <div>
      <PageHeader eyebrow="Step 1 of 3 · Authorize" title="Mandate">
        <p>Set the limits the agent must spend within. World authenticates the human. Kakashi records their approval of this specific mandate.</p>
        <p className="mt-1 text-xs text-zinc-500">World proofs are mocked for this event.</p>
      </PageHeader>
      {error && <div className="mb-6"><ErrorText>{error}</ErrorText></div>}
      {!loaded && <div className="h-64 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {mandate && (
            <>
              <MandateSummary mandate={mandate} />
              {activatable && (
                <Card frame="gold">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-zinc-100"><SponsorMark id="world" className="h-4 text-sky-300" />Activate with your World ID</h2>
                      <p className="mt-1 text-sm text-zinc-400">Check the short code, then approve this exact mandate version.</p>
                    </div>
                    {!attempt && <Button onClick={activate} className="shrink-0"><SponsorMark id="world" className="h-4" />Activate with World ID</Button>}
                  </div>
                  {attempt && (
                    <div className="mt-5 border-t border-white/[0.06] pt-5">
                      <AuthFlow key={attempt.id} attempt={attempt} onResult={(r) => { setLastResult(r); if (r !== "SUPERSEDED") { void refetch(); } }} />
                      {failed && <Button className="mt-4" onClick={activate}>Try again</Button>}
                    </div>
                  )}
                </Card>
              )}
              {mandate.state === "ACTIVE" && (
                <Card frame="green" className="animate-page-in">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-[15px] font-semibold text-zinc-100">You're ready to research</h2>
                      <p className="mt-1 text-sm text-zinc-400">The agent can now spend inside these limits. Purchases above the auto-approve cap still need your approval.</p>
                    </div>
                    <a href="#/research" className={`${btn("primary")} shrink-0`}>Ask a question <Arrow /></a>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
                    {!confirmRevoke ? (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(true)}>Revoke</Button>
                    ) : (
                      <>
                        <span className="mr-1 text-sm text-zinc-100">Revoke this mandate?</span>
                        <Button variant="danger" size="sm" onClick={revoke}>Yes</Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)}>No</Button>
                      </>
                    )}
                  </div>
                </Card>
              )}
            </>
          )}

          {canCreate && (
            <Card>
              <h2 className="text-lg font-semibold tracking-tight text-zinc-50">Create a mandate</h2>
              <p className="mt-1 text-sm text-zinc-400">Policy code enforces these limits on every purchase. The model can't change them.</p>
              <form onSubmit={create} className="mt-6 space-y-6" aria-label="Create mandate">
                <div className="grid gap-4 sm:grid-cols-3">
                  {([["Total budget (USDC)", total, setTotal], ["Per-payment cap (USDC)", cap, setCap], ["Auto-approve cap (USDC)", auto, setAuto]] as const).map(([l, v, set]) => (
                    <label key={l} className="block"><Label>{l}</Label><input className={`${inputCls} font-mono`} inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} /></label>
                  ))}
                </div>
                <fieldset>
                  <legend className="mb-2 text-[13px] font-medium text-zinc-300">Allowed merchants</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {MERCHANT_REGISTRY.map((m) => {
                      const on = merchants.includes(m.id);
                      return (
                        <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors duration-200 ${on ? "border-gold-400/35 bg-gold-400/[0.05]" : "border-white/[0.08] bg-white/[0.015] hover:border-white/15"}`}>
                          <input type="checkbox" className="mt-0.5 size-4 accent-gold-400" checked={on}
                            onChange={(e) => setMerchants(e.target.checked ? [...merchants, m.id] : merchants.filter((x) => x !== m.id))} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-medium text-zinc-100">{m.name}</span>
                              <span className="font-mono text-xs text-zinc-400">{usdc(m.priceAtomic)}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-zinc-500">
                              {humanize(m.capabilities[0])} · {m.coverage}
                              {m.demoRole === "adversarial" && <span className="ml-1.5 text-rose-300/80">· adversarial demo merchant</span>}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block"><Label>Max purchases per run</Label><input className={inputCls} inputMode="numeric" value={maxPurchases} onChange={(e) => setMaxPurchases(e.target.value)} /></label>
                  <label className="block"><Label>Expires in (minutes)</Label><input className={inputCls} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
                </div>
                {formErrors.length > 0 && <div className="space-y-1">{formErrors.map((x) => <ErrorText key={x}>{x}</ErrorText>)}</div>}
                <Button type="submit" className="w-full sm:w-auto">Create mandate</Button>
              </form>
            </Card>
          )}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <Card title="Preferences">
            <label className="block">
              <Label>Used by the AI, not enforced</Label>
              <textarea className={`${inputCls} resize-none`} rows={4} placeholder="e.g. Prefer hourly data over daily forecasts" value={prefs}
                onChange={(e) => { setPrefs(e.target.value); setPrefsMsg(null); }} />
            </label>
            <div className="mt-3 flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={savePrefs}>Save preferences</Button>
              {prefsMsg && <span role="status" className="text-sm text-emerald-300">{prefsMsg}</span>}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

# Trust notes

## Manual World run

End-to-end check of trust's World integration against the real issuer: activate a mandate with World ID, then approve one over-cap purchase (hourlypro, 50000 > 20000 auto-approve cap) and receive its signing permit. Uses a scratch SQLite DB in the OS temp dir; prints no `sub`, tokens, device codes, secrets or permit MAC.

```
# needs WORLD_CLIENT_ID / WORLD_CLIENT_SECRET in the repo-root .env (exits 2 without them)
cd packages/trust && npx tsx --env-file-if-exists=../../.env scripts/world-manual.ts
```

Run it once approving both prompts, then again denying / cancelling / letting the code expire to record the failure codes.

## Live run through the app (2026-11-06)

Run through the web UI, not the script above: server with `USE_REAL=trust` (rails and brain on fakes), real issuer `https://auth.world.org`, a client registered in the portal with **Client secret (POST body)**, default accepted accounts **Selfie Check**, **Ask for Face Auth off**. Values below are read from the server DB (`auth_attempts`, `approvals`, `purchases`, `mandates`) and the `{"at":"world"}` log lines. No `sub`, token or secret was recorded.

| Item | Observed |
|---|---|
| Activation result | `VERIFIED` (4 activations, all verified). Mandate `DRAFT` -> `ACTIVE`, approval `APPROVED`, World identity linked on the first one. |
| Purchase approval result | `VERIFIED`. HourlyPro 50000 (over the 20000 cap) went `AWAITING_APPROVAL` -> paid `CONFIRMED`; mandate `spent` 50000. |
| Time to first success (attempt start -> mandate ACTIVE) | **13 s** (attempt 18:20:59 UTC, approval recorded 18:21:12 UTC). |
| `acr` / `amr` observed | `acr = https://world.org/oidc/acr/orb`, `amr = ["pop","user","mfa"]`, same on every verified attempt. |
| `auth_time` freshness | Fresh every time: `auth_time` was 6-23 s **after** each attempt start, for activations and the purchase step-up. No session reuse seen, so the `auth_time >= start - 5 s` check never rejected a real login. |
| Deny | World token endpoint: HTTP 400 `access_denied` -> `DENIED`. Purchase `APPROVAL_DENIED`, `reserved` back to 0, nothing signed. |
| Cancel | _not tried_ |
| Expire | _pending_ |
| Superseded | Starting a second activation for the same mandate marked the first attempt `SUPERSEDED` as designed. |

Poll pacing: World answered `authorization_pending` (HTTP 400) while waiting; no `slow_down` was seen.

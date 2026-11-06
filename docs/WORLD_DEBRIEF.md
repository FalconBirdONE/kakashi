# World ID Agent Pass: integration debrief

## Time to first success
- **Code to first validated login: 13 seconds** once a client existed (device-flow start 18:20:59 UTC, approval recorded 18:21:12 UTC on 2026-11-06).
- **Wall clock:** the clock started at 21:37 on 2026-11-06 with the first discovery fetch. The first validated login was at 23:51 IST, about **2 h 14 min** later if 21:37 was IST. Nearly all of that was getting a portal client. Discovery and the device-flow code took about 3 minutes.
- The integration code (device flow, ID token validation, mandate activation, purchase step-up) worked on the first live login with no changes.

## Friction
- **Good:** the discovery document is public, complete and correct (device flow, PKCE S256, acr values, jwks), so the code needed no guesswork about endpoints.
- **Biggest blocker: portal sign-in.** The portal only accepts Google sign-in. Our first attempt with a personal Google account returned "invalid login". A university Google Workspace account got in straight away. The portal shows no message saying which accounts are eligible, so a participant can't tell whether to retry, switch accounts or go to the booth. The docs cover this only as `account_not_eligible` in a troubleshooting table.
- **Two different "World" sites look alike.** Signing in at `auth.world.org` lands on the end-user IdP dashboard (Proof of human, Passkeys, Connect agents), not the developer portal. The developer portal is `auth.world.org/portal` ("Platform Portal", with Apps and Agents tabs). It took a round trip to realise we were on the wrong page.
- **Create app form, good:** "Client secret (POST body)" is clearly labelled, and the form warns that the method can't be changed later. "Default accepted accounts" (Orb, Selfie Check, Any account) answers part of our earlier question about requesting an `acr` level: it is set per client, not per device request.
- **Create app form, unclear:**
  - A redirect URI is required even for a device-only client.
  - "Ask for Face Auth" says "An existing session can still be reused", which made us worry that step-ups would come back with an old `auth_time`. We turned it off because the event uses mocked proofs. In practice `auth_time` was fresh on every login (see below).
- **Docs gap:** no device-flow walkthrough and no description of how the event's mocked proofs are produced. Nothing explains how to trigger deny, cancel or expiry on purpose.
- **Ambiguity:** `sub` is sector-scoped, not client-scoped. The portal gives a new app its own sector by default, which settles it for us, but the docs should say this next to the ID token claims.

## What we observed live (2026-11-06)
- **Claims:** `acr = https://world.org/oidc/acr/orb`, `amr = ["pop","user","mfa"]` on every verified login, with the client's accepted accounts set to Selfie Check.
- **Fresh authentication:** `auth_time` was 6-23 s after each attempt start, for mandate activation and for the purchase step-up. World did not reuse an older session. Our `auth_time >= attempt start - 5 s` rule never rejected a real login.
- **Deny:** the token endpoint returns HTTP 400 `access_denied`. Trust maps it to `DENIED`, the purchase becomes `APPROVAL_DENIED`, the reserved amount is released and nothing is signed.
- **Pending:** `authorization_pending` (HTTP 400) while waiting. No `slow_down` seen.
- **Cancel:** not tried, so whether cancel is a separate code from deny is still unknown.
- **Expire:** _pending_.

## Missing capabilities / docs
- **Device-flow terminal errors are not documented.** We map the RFC 8628 codes (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`) and treat anything else as an error. Live, `authorization_pending` and `access_denied` behaved as RFC 8628 describes. There is still no World-specific list, and no statement on whether deny and cancel are distinct.
- **No per-request `acr`.** The accepted-accounts level is a client default. The device authorization request has no documented `acr_values` (or `claims`) parameter, so a protected action can't ask for a stronger level than the client default. We still check `acr`/`amr` after the token arrives (`WORLD_REQUIRED_ACR`, `WORLD_REQUIRED_AMR`); both are empty in our setup.
- **No stated `auth_time` guarantee.** The docs ask for "fresh authentication" on important actions but document no `max_age` or `prompt=login` for the device flow. We saw fresh `auth_time` values, but nothing promises it, and the Face Auth wording suggests session reuse can happen.
- **No guidance on which Google accounts are eligible** for the portal, and no clear error when one is not.

## Single most impactful improvement
One device-flow reference page with three parts:
1. Which Google accounts can register a client at an event, and what the portal shows when an account can't.
2. A 10-line device-flow example with the exact terminal error codes and how to trigger each one (deny, cancel, expire) with mocked proofs.
3. A guarantee about fresh authentication for protected actions (`max_age` / `prompt=login`, or a promise about `auth_time`), stated next to the fact that `sub` is sector-scoped.

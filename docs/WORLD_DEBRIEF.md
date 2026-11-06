# World ID Agent Pass: integration debrief (in progress)

## Time to first success
**Not reached yet.** Clock started 21:37 (2026-11-06) with the first discovery fetch. Discovery and the device-flow script took about 3 minutes; the login itself is blocked on a registered client and a human approval (see below). This section gets the real number once one validated login completes.

## Friction so far
- **Good:** the discovery document is public, complete and correct (device flow, PKCE S256, acr values, jwks), so the script needed no guesswork about endpoints.
- **Registration blocker:** the Agent Pass portal prompts for an enterprise Google account. The local `.env` has neither World client credential. [World's troubleshooting guide](https://auth.world.org/docs/guides/oidc#troubleshooting) directs participants with portal eligibility or registration errors to the organizer or operator. Ask the World event team to enable registration for the participant's Google account or provide an event test client with `client_secret_post`, its issuer, and the approval instructions.
- **Event test setup:** the [Mumbai prize page](https://ethglobal.com/events/mumbai/prizes) links to `auth.world.org/portal` and says the event uses mocked proofs without the sandbox app. The portal registration and device-flow approval and denial are still pending.
- **Docs gap:** the public docs page is a conceptual overview ("human continuity", private identifiers per sector, fresh authentication). I found no concrete device-flow walkthrough, no description of how the event's mocked proofs are produced, and nothing on how to trigger deny, cancel or expiry on purpose. The OAuth Playground link is the closest thing to a hands-on guide.
- **Ambiguity:** `sub` being sector-scoped (not client-scoped) is easy to miss and affects how identity binding should be described.
- **Ambiguity:** `acr` values are full URIs and it is not clear whether they can be requested at login or only read afterwards.
- **Ambiguity:** whether deny and cancel are separate error codes or both `access_denied`.

## Missing capabilities / docs (so far)
What building the full integration (device flow, server-side validation, mandate activation and purchase step-up) showed. All of it comes from the public docs and the discovery document. **None of it has been checked against a live login yet**: we still have no client credentials.

- **Device-flow terminal errors are not documented.** We map the RFC 8628 codes (`authorization_pending`, `slow_down`, `access_denied`, `expired_token`) and treat anything else as an error. We found no World-specific list, no statement on whether deny and cancel are distinct codes, and no documented way to trigger deny, cancel or expiry in the sandbox or with the event's mocked proofs. Our `CANCELLED` result may never occur in practice. Not verified live.
- **No way found to request an `acr` level in the device flow.** `acr_values_supported` lists two URIs, but the device authorization request has no documented `acr_values` (or `claims`) parameter. We can only check `acr`/`amr` after the token arrives and reject the login (`WORLD_REQUIRED_ACR`, `WORLD_REQUIRED_AMR`). That costs the user a wasted approval. The actual `acr`/`amr` values issued at this event are unknown.
- **`sub` is sector-scoped, not client-scoped.** Apps in the same sector see the same `sub`. This changes what an `(iss, sub)` binding means and should be stated prominently next to the ID token claims, not only in the conceptual overview.
- **No stated ID token lifetime or `auth_time` semantics for re-authentication.** The docs say important actions need "fresh authentication", but there is no documented `max_age`, `prompt=login` or equivalent for the device flow. We cannot ask World for a fresh authentication. Instead we require `auth_time >= attempt start - 5 s` and reject anything older. If World reuses a session and returns an older `auth_time`, every step-up would fail. We do not yet know whether it does. Not verified live.
- A sandbox walkthrough with the expected `acr`/`amr` values is still missing.

## Single most impactful improvement (provisional)
One device-flow reference page with three parts. First, a 10-line example using a sandbox or event client. Second, the exact terminal error codes and how to trigger each one (deny, cancel, expire) with mocked proofs. Third, how to force a fresh authentication for a protected action (`max_age` / `prompt=login` semantics, or a guarantee about `auth_time`), stated next to the fact that `sub` is sector-scoped.

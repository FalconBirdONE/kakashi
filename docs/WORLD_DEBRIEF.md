# World ID Agent Pass: integration debrief (in progress)

## Time to first success
**Not reached yet.** Clock started 21:37 (2026-11-06) with the first discovery fetch. Discovery and the device-flow script took about 3 minutes; the login itself is blocked on a registered client and a human approval (see below). This section gets the real number once one validated login completes.

## Friction so far
- **Good:** the discovery document is public, complete and correct (device flow, PKCE S256, acr values, jwks), so the script needed no guesswork about endpoints.
- **Blocker for automation:** a first success needs a client registered in the portal (the portal page loads an app shell and "Opening your workspace…", so I could not tell from outside what registration involves or whether event sandbox clients are pre-made) and a human approving in the World app. An agent-run script alone cannot reach "success".
- **Docs gap:** the public docs page is a conceptual overview ("human continuity", private identifiers per sector, fresh authentication). I found no concrete device-flow walkthrough, no description of how the event's mocked proofs are produced, and nothing on how to trigger deny, cancel or expiry on purpose. The OAuth Playground link is the closest thing to a hands-on guide.
- **Ambiguity:** `sub` being sector-scoped (not client-scoped) is easy to miss and affects how identity binding should be described.
- **Ambiguity:** `acr` values are full URIs and it is not clear whether they can be requested at login or only read afterwards.
- **Ambiguity:** whether deny and cancel are separate error codes or both `access_denied`.

## Missing capabilities / docs (so far)
A sandbox walkthrough with expected acr/amr values, and an explicit list of failure outcomes.

## Single most impactful improvement (provisional)
A short "device flow in 10 lines" example with the sandbox client, and the exact list of terminal errors and how to trigger each one.

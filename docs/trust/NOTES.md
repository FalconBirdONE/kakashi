# Trust notes

## Manual World run

End-to-end check of trust's World integration against the real issuer: activate a mandate with World ID, then approve one over-cap purchase (hourlypro, 50000 > 20000 auto-approve cap) and receive its signing permit. Uses a scratch SQLite DB in the OS temp dir; prints no `sub`, tokens, device codes, secrets or permit MAC.

```
# needs WORLD_CLIENT_ID / WORLD_CLIENT_SECRET in the repo-root .env (exits 2 without them)
cd packages/trust && npx tsx --env-file-if-exists=../../.env scripts/world-manual.ts
```

Run it once approving both prompts, then again denying / cancelling / letting the code expire to record the failure codes.

_pending: no World credentials in this environment_

| Item | Observed |
|---|---|
| Activation result | _pending_ |
| Purchase approval result | _pending_ |
| Time to first success (script start -> mandate ACTIVE) | _pending_ |
| `acr` / `amr` observed | _pending_ |
| Failure codes observed (deny / cancel / expire) | _pending_ |

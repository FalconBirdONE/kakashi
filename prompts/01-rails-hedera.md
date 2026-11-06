# Branch: rails (B1 — Hedera)

Read SPEC.md §0–8 (shared contract) and your branch section in §9 closely; skim the rest. If code and SPEC disagree, SPEC wins. Rules (SPEC §6.3): write ONLY inside your owned paths; packages/contracts is frozen; do not add dependencies (all pre-installed in commit 0); notes go in docs/<branch>/; export exactly one factory from your package src/index.ts, replacing the stub that throws; run on the fakes in packages/contracts/src/fakes until your real pieces exist. Each merge into main must pass `pnpm -r build && pnpm -r test`. Do the spike first, and record findings in your docs folder.

**Owns:** apps/merchants/**, apps/signer/**, packages/rails/**, scripts/hedera/**, docs/rails/**
**Spec:** §9.1, plus §4 (compat contract), §7.6 (Rails), §7.7 (SigningPermit), §8.1, §8.4–8.6, §10.
**First task:** spike S1 (≤2 h): one real x402 paid request on hedera:testnet with USDC 0.0.429274; fill docs/rails/COMPAT.md. If USDC is blocked, switch to ASSET_MODE=hbar and tell the lead immediately.
**Done when:** tests R1–R7 (§13) pass, and docs/rails/PROOF.md has a real transaction ID and HashScan link for the app branch.

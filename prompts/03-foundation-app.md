# Branch: app (Commit 0 + B4 — server, orchestrator, UI, demo, submission)

Read SPEC.md §0–8 (shared contract) and your branch section in §9 closely; skim the rest. If code and SPEC disagree, SPEC wins. Rules (SPEC §6.3): write ONLY inside your owned paths; packages/contracts is frozen; do not add dependencies (all pre-installed in commit 0); notes go in docs/<branch>/; export exactly one factory from your package src/index.ts, replacing the stub that throws; run on the fakes in packages/contracts/src/fakes until your real pieces exist. Each merge into main must pass `pnpm -r build && pnpm -r test`. Do the spike first, and record findings in your docs folder.

**Owns:** after commit 0: apps/server/**, apps/web/**, docs/app/**, docs/DEMO_SCRIPT.md, README.md
**Spec:** §9.4, plus §5, §8.3–8.6, §11.3 (copy rules), §12, §14, §15.
**Start:** wire apps/server with fakes (USE_REAL empty) so the whole UI works on day one, then flip to real implementations per package with USE_REAL=rails,brain,trust as each branch merges (order: brain-trust → rails → app).
**Done when:** A1–A5 (§13) pass and the demo script (§14) runs twice in a row on real services; README includes proof of payment from docs/rails/PROOF.md.

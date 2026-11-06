# Branch: brain-trust (B2 — 0G, and B3 — World, policy, ledger)

Read SPEC.md §0–8 (shared contract) and your branch section in §9 closely; skim the rest. If code and SPEC disagree, SPEC wins. Rules (SPEC §6.3): write ONLY inside your owned paths; packages/contracts is frozen; do not add dependencies (all pre-installed in commit 0); notes go in docs/<branch>/; export exactly one factory from your package src/index.ts, replacing the stub that throws; run on the fakes in packages/contracts/src/fakes until your real pieces exist. Each merge into main must pass `pnpm -r build && pnpm -r test`. Do the spike first, and record findings in your docs folder.

**Owns:** packages/brain/**, evals/**, docs/brain/**, packages/trust/**, docs/trust/**, docs/WORLD_DEBRIEF.md
**Spec:** §9.2 and §9.3, plus §7.4 (entities), §7.6 (Brain, Trust), §7.7, §7.8, §8.2–8.4, §8.6, §11.
**First tasks:** spike S2 (≤1 h, 0G Router TeeML model + trace, docs/brain/SPIKE.md) and spike S3 (≤1.5 h, World ID device flow, docs/trust/SPIKE.md; start the timer for docs/WORLD_DEBRIEF.md).
**Done when:** B1–B6 and T1–T9 (§13) pass; eval accuracy ≥5/6 on the real 0G Router, documented in docs/brain/EVALS.md.

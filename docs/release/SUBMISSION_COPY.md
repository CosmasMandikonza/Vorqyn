# Submission copy — current verified scope

> **Updated November 7, 2026 for merged main `81b47248`.** Use this version, rather than the earlier static-viewer description. Confirm any new devnet integration independently before adding settlement claims. No portal submission, public deployed demo, publicly hosted video or accepted receipt is asserted here.

**Project:** VORQYN — Autonomous Work. Accountable Outcomes.

**Public source:** https://github.com/CosmasMandikonza/Vorqyn

**Demo route after deployment:** `/demo/mission` (append to the *verified* deployed HTTPS origin; never represent localhost as a public URL)

## Short description — safe to paste today

VORQYN explores a hard problem in autonomous operations: what happens when a mission spans independently operated drones, ground robots and underwater ROVs, and one robot's sensor data becomes unusable? Our hackathon prototype lets a judge explore a shared 3D storm-damaged port, run a real deterministic **synthetic** three-robot survey, inject an underwater optical-visibility fault through an actual simulation API, inspect the measured optical degradation alongside independent sonar, and replay the exact operation history. A separate five-step browser-local builder saves independent mission drafts with different regions, evidence criteria and budgets.

We also built validated shared mission/event contracts, assignment-version protections and a deterministic reducer that models how verified work and chain-confirmed payments *should* interact. We are building toward Solana-enforced escrow, authorized cross-operator reassignment and one-time payout; actual devnet transactions, independent evidence verdicts and runtime AI recovery are **not yet verified**. The current 3D observations are `SYNTHETIC_SIM`, not live robot telemetry.

## What works and can be demonstrated

- Actual PORT-001 3D GLB world with true-scale drone/rover/ROV and accessible 2D/no-WebGL fallback.
- Stateless, bounded `POST /api/demo/simulation` that runs the real deterministic kernel; actual synthetic robot motion, low-visibility fault, independent sonar measurements, timeline and reproducible replay.
- Genuine local/browser-only distinct mission drafts (not authorized, funded or server-persisted).
- Strict typed mission contracts, per-mission ordered events, version-bound task assignments, chain-confirmed-payment gating in a **pure reducer** with synthetic fixtures. No on-chain success is implied.

## What still requires proof

- Actual Solana devnet program IDs, transaction signatures, funded escrow/reassignment/payout account readbacks.
- Independently executed policy/evidence verdicts and constrained runtime AI (coding-assistance models do not count).
- Real hardware or SITL telemetry; authenticated multitenant company backend.
- Public HTTPS deployment, signed-out video availability, accepted MLH submission.

## Stack and learning

Next.js, React, TypeScript, Tailwind, Three.js/React Three Fiber, a deterministic JavaScript simulation kernel, and versioned mission/event schemas. Solana/Anchor is the intended authorization and settlement layer, not an implemented live guarantee. The biggest technical learning: physical ENU coordinates and clock/provenance domains must be aligned before a simulated fault can be interpreted or replayed honestly.

**AI coding transparency:** OpenAI Codex and ZCode agents assisted with implementation and tests. Select only the actual coding tools/models used in the MLH form. These are *development* tools, not a verified autonomous runtime AI operator.

**Who it could help:** Infrastructure inspection companies and fleet operators coordinating work across different robot vendors. Commercial impact and customers remain hypotheses, not verified results.

**Video and public demo:** Founder must record, upload and verify the actual publicly accessible links before final submission. Narration and capture runbook: [RECORDING_PLAN.md](RECORDING_PLAN.md), [SUBMISSION.md](SUBMISSION.md).

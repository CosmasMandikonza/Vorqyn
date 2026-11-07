# Development issue index — VORQYN

> **Founder Lane 2 parallel execution note (November 7, 2026):** The original 17 VQ issues remain the full product roadmap. Two additional **preparation-only** GitHub issues were opened to let the founder run two independent ZCode sessions *alongside* Codex Issue #3, without taking the teammate's Lane 1 work: [#19 VQ-07-PREP port-world asset pack](https://github.com/CosmasMandikonza/Vorqyn/issues/19) (only `assets/port-world/**`) and [#20 VQ-08-PREP deterministic simulator kernel](https://github.com/CosmasMandikonza/Vorqyn/issues/20) (only `services/simulation/core/**`). Those are independent foundations for **original #8 and #9**, not substitutes for their full integration acceptance. The teammate independently owns Lane 1. [Current Notion playbook](https://app.notion.com/p/411011921112818a96ecf4d666127da1) has the current three-agent allocation.

> **Verified implementation state (Nov 7, 2026):** [#1](https://github.com/CosmasMandikonza/Vorqyn/issues/1) foundation, [#3](https://github.com/CosmasMandikonza/Vorqyn/issues/3) frontend and [#19](https://github.com/CosmasMandikonza/Vorqyn/issues/19)/[#20](https://github.com/CosmasMandikonza/Vorqyn/issues/20) independent asset/simulation preparations are **completed/merged**, with [#25](https://github.com/CosmasMandikonza/Vorqyn/pull/25) adding CI coverage. The full [#8](https://github.com/CosmasMandikonza/Vorqyn/issues/8) 3D mission viewer and [#9](https://github.com/CosmasMandikonza/Vorqyn/issues/9) stateful mission engine remain **OPEN**, as do all Solana/evidence/AI tasks. **P0 before world-state integration:** [#24 frame/altitude reconciliation](https://github.com/CosmasMandikonza/Vorqyn/issues/24). This file's original 17 logical VQ issue entries remain the planned architecture; issue numbers are not execution order.

## Start here

**Now:** The foundation and independent Lane 2 preparations have merged. Lane 1 continues independently with [#2 shared contracts](https://github.com/CosmasMandikonza/Vorqyn/issues/2) and [#5 Anchor escrow](https://github.com/CosmasMandikonza/Vorqyn/issues/5); Lane 2 integrates the merged UI, port world and simulation **only after** contract decisions and [#24](https://github.com/CosmasMandikonza/Vorqyn/issues/24) world-coordinate tests. Never have concurrent agents edit the same Next.js layout, shared types or account authority rules.

### Foundation & product

| Logical ID / GitHub issue | What ships | Can start after |
| --- | --- | --- |
| [VQ-00 / #1](https://github.com/CosmasMandikonza/Vorqyn/issues/1) | Toolchain, app skeleton, scripts/CI, secrets hygiene | Docs |
| [VQ-01 / #2](https://github.com/CosmasMandikonza/Vorqyn/issues/2) | Shared mission/task/event contracts and deterministic reducer | #1 |
| [VQ-02 / #3](https://github.com/CosmasMandikonza/Vorqyn/issues/3) | Light-led dual-theme landing, guest/company routes | #1 |
| [VQ-03 / #4](https://github.com/CosmasMandikonza/Vorqyn/issues/4) | Auth-isolated workspace and distinct configurable mission persistence | #2, #3 |

### On-chain economic foundation

| Logical ID / GitHub issue | What ships | Can start after |
| --- | --- | --- |
| [VQ-04 / #5](https://github.com/CosmasMandikonza/Vorqyn/issues/5) | Anchor escrow, funding, task reserves with checked math | #1 |
| [VQ-05 / #6](https://github.com/CosmasMandikonza/Vorqyn/issues/6) | Authorized/revocable task reassignment and stale-version guards | #5, #2 |
| [VQ-06 / #7](https://github.com/CosmasMandikonza/Vorqyn/issues/7) | Independent verifier signature, one-time payout and safe refund | #6, proof interface #11 |

### Simulation, reasoning and visuals

| Logical ID / GitHub issue | What ships | Can start after |
| --- | --- | --- |
| [VQ-07 / #8](https://github.com/CosmasMandikonza/Vorqyn/issues/8) | One port 3D scene, camera modes, three vehicle roles, fallback | #2, #3 |
| [VQ-08 / #9](https://github.com/CosmasMandikonza/Vorqyn/issues/9) | Stateful scenario engine, telemetry, low-visibility evidence failure | #2 |
| [VQ-09 / #10](https://github.com/CosmasMandikonza/Vorqyn/issues/10) | At least one genuine ArduPilot SITL adapter with provenance | #9 |
| [VQ-10 / #11](https://github.com/CosmasMandikonza/Vorqyn/issues/11) | Real evidence policy verifier and signer-bound digest | #9, #2 |
| [VQ-11 / #12](https://github.com/CosmasMandikonza/Vorqyn/issues/12) | Constrained AI operator selection, budget/capability gate, timeout fallback | #11, #9, #6 |
| [VQ-12 / #13](https://github.com/CosmasMandikonza/Vorqyn/issues/13) | Real chain client, receipt states and devnet readback | #2, #5–#7 |

### Integration and presentation

| Logical ID / GitHub issue | What ships | Can start after |
| --- | --- | --- |
| [VQ-13 / #14](https://github.com/CosmasMandikonza/Vorqyn/issues/14) | One **actual** end-to-end failure → recovery → onchain payout | #4, #8, #9, #11–#13 |
| [VQ-14 / #15](https://github.com/CosmasMandikonza/Vorqyn/issues/15) | World Dive, Mission Fracture, Ghost Replay + economic handoff | #8, #9, #14 |
| [VQ-15 / #16](https://github.com/CosmasMandikonza/Vorqyn/issues/16) | Adversarial UX/security/performance and stranger smoke test | #14, #15 |
| [VQ-16 / #17](https://github.com/CosmasMandikonza/Vorqyn/issues/17) | Public deployment, recorded 2-min proof and submission | #14, then #16 where feasible |

### Parallel ownership without collisions

- **UI lane:** #3 → #8 → #15, then contribute to #16.
- **Autonomy lane:** #2 → #9 → #10 → #11 → #12, with scope coordination.
- **Chain lane:** #5 → #6 → #7 → #13.
- **Shared integration:** #1 first; #4 and #14 once shared contracts are compatible.
- **Release:** #16 → #17 (QA/recording may run alongside final integrations).

Two humans must agree on ownership; those are lanes, not named people. Chain lane must be explicitly assigned rather than left to 'who has time'. Keep one integrator accountable for the merged head and full product journey.

### Priority / deadline rule

**P0 critical path:** #1, #2, #3, #4, #5, #6, #7, #8, #9, #11, #12, #13, #14, #17. Genuine SITL integration (#10) should be pursued but not falsely claimed if deployment constraints force a clearly labeled fallback. **P1 visual signature (#15)** and **P1 full QA (#16)** should receive strong attention once the integrated loop works; they are where startup-grade craft and reliability are proven.

**Do not sacrifice contract correctness, real onchain claims or verifiable failure for extra pages and 3D effects.** Build and prove an executable vertical slice as early as possible. If a blocker appears, create a small follow-up issue with reproduction and stop; never pretend it passed.

### Per-ticket coding prompt

Use docs/AGENT_PROTOCOL.md (implementation prompt, independent reviewer prompt and handoff packet). Each issue separately lists allowed files, forbidden scope, dependencies, edge cases, tests and required proof. A plan that ignores these is incomplete.

### Main merge gate

A merge requires a reviewer to inspect the diff, passing relevant tests with actual output, no P0 violations, documented provenance of any fixtures, and a check that the merged head remains compatible with shared schema. Final integration and verified onchain receipts are separate tests from unit-level completion.

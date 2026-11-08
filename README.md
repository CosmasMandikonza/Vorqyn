# VORQYN

**Autonomous work. Accountable outcomes.**

### Watch the hackathon demo

[![Watch VORQYN's Solana hackathon demo on YouTube](https://img.youtube.com/vi/5LzJXEW5Eas/hqdefault.jpg)](https://youtu.be/5LzJXEW5Eas)

**[▶ Watch the VORQYN demo on YouTube](https://youtu.be/5LzJXEW5Eas)** · [Try the live synthetic harbor demo](https://vorqynweb-production.up.railway.app/demo/mission) · [Open the browser-local mission builder](https://vorqynweb-production.up.railway.app/workspace/create)

> The video demonstrates the synthetic harbor workflow. Browser-local mission drafts are not funded missions, and the Anchor contract tests do not imply verified live Solana settlement.

VORQYN is a proposed company-grade mission platform for independently operated autonomous machines: a customer creates a mission, robots execute physical tasks in a shared 3D world, an AI mission coordinator proposes recovery when evidence fails, and a Solana program enforces task reassignment and accepted-work payments.

> **Verified build status — November 7, 2026 (merged main):** VORQYN has a real interactive PORT-001 3D viewer and a deterministic, bounded server-side **synthetic** simulation API. A guest can start a survey, watch drone/rover/underwater ROV poses from actual kernel observations, inject a simulated underwater optical-visibility fault, inspect independent sonar measurements and replay the identical trace ([3D playback PR #38](https://github.com/CosmasMandikonza/Vorqyn/pull/38), [API PR #35](https://github.com/CosmasMandikonza/Vorqyn/pull/35)). The local browser-only mission draft builder ([PR #30](https://github.com/CosmasMandikonza/Vorqyn/pull/30)), original port assets, world-aligned kernel, and typed event contracts/reducer ([PR #37](https://github.com/CosmasMandikonza/Vorqyn/pull/37)) are also merged. **Not yet verified:** authenticated company mission persistence, runtime AI recovery, independent evidence verifier, real physical/SITL telemetry, deployed Solana escrow/reassignment/payout, public demo/video, or accepted submission. Canonical chain events in test fixtures are synthetic examples, **not devnet transactions**. Do not present this prototype as a deployed autonomous fleet or as completed financial settlement.

## Local development and current feature boundaries

The monorepo contains a **working guest synthetic mission journey** at `/demo/mission` and a separate browser-local mission planner. The guest 3D viewer is connected to the actual stateless `POST /api/demo/simulation` endpoint, but it is **not** connected to a persisted company mission, real hardware, independent evidence approval, runtime AI operator, or Solana financial authority.

- **Runtime:** Node `22.21.1` (see `.nvmrc`) and pnpm `10.34.5` (pinned via the root `packageManager` field; `corepack enable` prepares it automatically).
- **Install:** `pnpm install` (committed lockfile; CI uses `--frozen-lockfile`).
- **Checks:** `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`. CI (`.github/workflows/ci.yml`) also runs the core synthetic kernel, world-coordinate integration tests, asset validator, and Rust scaffold. Release tooling and browser checks are documented in [docs/release/README.md](docs/release/README.md); its prior 320px failures and remaining external submission blockers must not be reported as passing.
- **Web app:** `pnpm dev:web` serves the landing page, `/demo/mission` guest synthetic 3D playback with fault/replay controls and 2D fallback, and `/workspace/create` browser-local planning drafts. Both interfaces prominently disclose their limitations. No blockchain transaction or live hardware read is implied; see [#8](https://github.com/CosmasMandikonza/Vorqyn/issues/8), [#9](https://github.com/CosmasMandikonza/Vorqyn/issues/9), and [#4](https://github.com/CosmasMandikonza/Vorqyn/issues/4) for remaining integration.
- **Shared contracts:** `packages/contracts` now contains validated IDs, exact lamports, source-aware telemetry, versioned mission events, pure deterministic reducer and two replay fixtures ([PR #37](https://github.com/CosmasMandikonza/Vorqyn/pull/37)). The proposed Solana PDA/IDL agreement in `CHAIN_SEAM.md` remains a **draft** pending Anchor-owner agreement; fixtures are not actual devnet history.
- **Anchor program:** `programs/vorqyn` is a no-op skeleton verified by `cargo fmt --check`, `cargo clippy` and `cargo check` in CI. The Anchor/Solana toolchain (`avm`, `anchor`, `solana` CLI, local validator) is **not** installed by pnpm; `anchor build`/`anchor test` become relevant from VQ-04 (#5) onward. Devnet/test keypairs only — never commit keys or secrets.
- **Windows:** WSL2 is recommended for a consistent Node/Solana environment. Some contributors also run the dependency-free simulation/asset validation under Windows Git Bash and Node; Anchor/validator installation must be verified separately per workstation.

## What makes VORQYN special?

A port needs to inspect access roads, aerial structures, and underwater obstructions after a storm. In the **implemented synthetic demo**, a drone surveys from above, a rover checks access, and an underwater ROV surveys beneath the docks. A genuine kernel command injects a low-visibility fault: optical sensor measurements degrade, while independent sonar readings remain observable. The operator can inspect source-labelled poses, a fault timeline and repeatable replay in one 3D world (or text-based 2D fallback). **Planned, not yet completed:** independent evidence rejection, AI replacement matching, owner-authorized reassignment, and single-use payout enforced by a real Solana program.

**Target end-to-end interaction:** observe → fail → explain → recover → verify → settle → replay. **Implemented guest subset:** observe → synthetic optical fault → inspect sensor measurements → replay. The remaining real financial/evidence transitions must be independently inspectable before the project claims a complete recovery loop.

## Two product entry points

- **Explore Demo:** instant, no account or wallet required; real kernel-driven synthetic three-machine port survey at `/demo/mission`, with optical-fault command, source-aware sensor inspector, camera stations and deterministic replay. **No actual devnet transaction is shown by this route.**
- **Create Mission:** `/workspace/create` saves genuinely different local drafts with selected zones, machine capabilities, acceptance criteria and exact proposed budgets. Data stays in the current browser; there is **no authenticated organization, secure server persistence, funded escrow or real mission launch** yet.

Long-term customers may include infrastructure inspection providers, port operators, and robotics contractors. Enterprise mission-management subscriptions are the leading business hypothesis; marketplace fees and developer APIs are future hypotheses, **not validated demand or existing revenue**.

## Competition objective

Primary objective: **Top 3 Overall — $1,000 microgrant per selected team** at the November 6–8, 2026 Solana × MLH Hackathon. Secondary: AI Track, if the AI agent and Solana each perform meaningful, demonstrable work. The objective is to produce an impressive **working product** across MLH's standard Technology, Design, Completion, and Learning criteria; winning is not guaranteed.

**Why Solana is necessary here:** separate operators hold task rights under a shared escrow; a failed task cannot be paid as completed; scoped authorities can reassign unfinished work; verified evidence is bound to an assignment version; and the correct operator can claim once without the application freely reallocating customer funds. The chain enforces financial and authorization state, **not** robot stabilization or physical truth.

## Product architecture (partially implemented; full authority path remains planned)

```text
           Visitors                         Companies
      Explore Demo / replay             Sign-in / Create Mission
                   \                      /
                     Next.js + React UI
                3D world + Evidence + Wallet
                             |
              Mission API + event/replay log
                   /          |           \
          Vehicle adapters   AI/policy     Verifier
          and simulator      planner       (off-chain)
                   \          |           /
                  Shared typed mission contract
                             |
                Solana Anchor program / devnet
                  escrow · reassignment · payout
```

*Proposed stack*: Next.js + TypeScript, React Three Fiber / Three.js (optional Cesium after proof of need), ArduPilot SITL/MAVLink for genuine vehicle telemetry where feasible, server-side mission orchestration and policy verification, an Anchor/Rust Solana program, and an event store. Technology choices can be revised through an explicit architecture decision—not independently by separate coding agents.

## Visual language (non-negotiable intent)

A **light-led, carefully designed light/dark system**: warm mineral ivory, industrial petrol, restrained copper actions and sea-glass verification; cinematic world, clear engineering typography, accessible controls and honest statuses. The two themes are **equally crafted**, not inverted styles. Prefer Cult UI for app components, React Bits selectively for narrative motion, Skiper UI selectively where licensing permits, and Awwwards as art-direction reference. Main 3D world must represent actual mission state.

Mission Control should offer named Orbit / Follow / Inspect / X-Ray / Replay modes, a contextual inspector and a synchronized event timeline. No mock confirmations disguised as chain receipts. Reduced-motion, keyboard/touch, low-performance and no-WebGL alternatives are part of the design contract.

## Docs: read before writing code

| File | Purpose |
| --- | --- |
| [Agent instructions](AGENTS.md) | Root-level coding-agent constraints and proof rules |
| [Issue index](docs/ISSUE_INDEX.md) | Dependency-ordered links to all 17 development issues |
| [Product definition](docs/PRODUCT.md) | User journeys, business scope, P0/P1 boundaries |
| [Architecture and interfaces](docs/ARCHITECTURE.md) | Shared state, event types, trust boundaries, replay clocks |
| [Solana contract](docs/SOLANA_PROTOCOL.md) | Exact financial invariants, permissions and attack cases |
| [Design system](docs/DESIGN_SYSTEM.md) | UI direction, components, color, motion, accessibility |
| [Engineering plan](docs/EXECUTION_PLAN.md) | Small work packets, parallel lanes, dependencies and fail-stops |
| [Verification gates](docs/QUALITY_GATES.md) | Functional, adversarial, operational and UX acceptance |
| [Agent protocol](docs/AGENT_PROTOCOL.md) | ZCode and ChatGPT prompts, review workflow, PR evidence |
| [Demo & submission](docs/DEMO_RUNBOOK.md) | End-to-end proof, timeline, fallbacks and judge journey |
| [PR template](.github/pull_request_template.md) | Consistent claims, evidence and review |

Shared team references:
- [Notion — Product, Business & Technical Blueprint](https://app.notion.com/p/41001192111281d9b342c1f5b3d3fda5)
- [Notion — Shared AI Engineering Workflow](https://app.notion.com/p/410011921112819e8667c455ac342e89)

**Current implementation status:** [completed PRs](https://github.com/CosmasMandikonza/Vorqyn/pulls?q=is%3Apr+is%3Amerged) and [remaining original-issue backlog](docs/ISSUE_INDEX.md). The public repo is a hackathon prototype, not a production physical-robot or payments product.

## Workflow for the two developers

Both people use **separate local workspaces and separate branches** in this one GitHub repository. ZCode + GLM can implement a bounded ticket; each person's ChatGPT acts as an **independent** reviewer of diffs, tests and evidence. No agent is authorized to claim completeness based on prose alone or to silently change shared interface contracts.

1. Pick an unblocked issue; read its dependencies and allowed scope.
2. Create a branch from verified base; implement **only that issue**.
3. Run tests and collect exact commands/results, screenshots or devnet signatures as appropriate.
4. Open a PR with the provided template; have an independent reviewer inspect the actual diff.
5. Fix P0/P1 issues, merge in order, then run the full integrated journey from a fresh session.

Do not place secrets, wallet seed phrases, private keys, or sensitive customer data in PRs, chat prompts, tests or screenshots. Only use funded **devnet** test wallets for the hackathon.

## Current execution order

**Foundations → stateful mission engine → escrow authorization → 3D world → simulator telemetry → fault + AI recovery → verifier + single-use payout → full journey → judged video.**

These streams can overlap after the **shared contracts** are frozen. The mission engine is reusable; the port is a flagship **template**, not a hardcoded product.

## Hackathon links and rules

- [Official MLH Solana event](https://events.mlh.com/events/15200-solana-hackathon)
- [MLH standard rules and judging](https://github.com/MLH/mlh-policies/blob/main/standard-hackathon-rules.md)
- [Solana docs](https://solana.com/docs)
- [Anchor docs](https://www.anchor-lang.com/docs)
- [ArduPilot SITL](https://ardupilot.org/dev/docs/sitl-simulator-software-in-the-loop.html)

The event listing shows an **initial submission Sunday 10:00 AM ET** and **final hacking cutoff Sunday 11:45 AM ET**; verify the live submission portal rather than interpreting a later portal-close timestamp as permission to keep developing. Check the event-specific rules for permitted pre-existing code and third-party assets.
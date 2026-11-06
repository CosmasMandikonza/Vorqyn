# VORQYN

**Autonomous work. Accountable outcomes.**

VORQYN is a proposed company-grade mission platform for independently operated autonomous machines: a customer creates a mission, robots execute physical tasks in a shared 3D world, an AI mission coordinator proposes recovery when evidence fails, and a Solana program enforces task reassignment and accepted-work payments.

> **Status — November 6, 2026:** This repository has been initialized with product and engineering documentation. The app, smart contract, simulations, test infrastructure, and demo **have not yet been implemented**. The materials below are a specification, not evidence of a functioning product.

## What makes VORQYN special?

A port needs to inspect access roads, aerial structures, and underwater obstructions after a storm. A drone surveys from above, a rover checks access, and an underwater ROV surveys beneath the docks. The ROV's optical evidence becomes unusable. Rather than declaring success, VORQYN rejects the result, compares qualified replacements, authorizes a sonar-capable operator under a limited on-chain budget, completes a new simulated inspection, and settles the accepted task **exactly once** on Solana devnet.

**The core interaction:** observe → fail → explain → recover → verify → settle → replay. All seven steps must be causally linked and independently inspectable. A polished animation or demo-only wallet notification does not substitute for the actual state transitions.

## Two product entry points

- **Explore Demo:** instant, no account or wallet required; guided, self-explanatory port mission, with controls to inspect a real recorded or live simulated failure and view confirmed devnet activity.
- **Create Mission:** company workspace for creating a *different* mission using supported environment templates, selecting machine capabilities, acceptance criteria, participants, and budget. The initial builder may be intentionally constrained; it must not be a form that secretly replays the same hardcoded mission.

Long-term customers may include infrastructure inspection providers, port operators, and robotics contractors. Enterprise mission-management subscriptions are the leading business hypothesis; marketplace fees and developer APIs are future hypotheses, **not validated demand or existing revenue**.

## Competition objective

Primary objective: **Top 3 Overall — $1,000 microgrant per selected team** at the November 6–8, 2026 Solana × MLH Hackathon. Secondary: AI Track, if the AI agent and Solana each perform meaningful, demonstrable work. The objective is to produce an impressive **working product** across MLH's standard Technology, Design, Completion, and Learning criteria; winning is not guaranteed.

**Why Solana is necessary here:** separate operators hold task rights under a shared escrow; a failed task cannot be paid as completed; scoped authorities can reassign unfinished work; verified evidence is bound to an assignment version; and the correct operator can claim once without the application freely reallocating customer funds. The chain enforces financial and authorization state, **not** robot stabilization or physical truth.

## Product architecture (planned, not implemented)

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
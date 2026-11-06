# VORQYN — Instructions for AI coding agents

**You are building a startup-grade hackathon product, not a fake demo.** This is the operational context for any coding agent (ZCode/GLM, Codex, Claude Code or other). Read the repo's actual current files and the specific GitHub issue before making edits.

## Project identity

VORQYN is a reusable platform for organizations to coordinate **physical-autonomy missions**. Its flagship port scenario has a drone, ground rover and underwater ROV. An underwater evidence failure creates a recovery opportunity; AI selects a **valid** alternative; Solana enforces current assignment rights and releases a verified reward once. Two user paths: **Explore Demo** without signup and **Create Mission** for authenticated companies.

**Primary goal:** be competitive for **Top 3 Overall** at the Nov 6–8, 2026 Solana × MLH Hackathon. Technology, Design, Completion, Learning, and essential Solana use all matter. A polished dark dashboard with a fake transaction is not enough.

## Read order

1. GitHub issue VQ-ID; README.md
2. docs/PRODUCT.md
3. docs/ARCHITECTURE.md
4. docs/SOLANA_PROTOCOL.md if touching authorization, chain or evidence
5. docs/DESIGN_SYSTEM.md if touching UI or 3D
6. docs/QUALITY_GATES.md
7. docs/AGENT_PROTOCOL.md and docs/EXECUTION_PLAN.md

## Non-negotiable constraints

- **One source of state truth:** typed mission/task events and versioned assignments; never create a separate animation-driven pseudo-state.
- **Solana is real:** escrow, reassignment authority, verifier-bound claims, one-time payout. Use actual local-validator tests and verifiable devnet tx before claiming completion.
- **AI is constrained:** propose structured recovery, run deterministic capability/budget policy, and require owner-confirmed or strictly bounded delegated signature. LLM does not attest its own physical evidence.
- **Physical simulation is honest:** clearly label SITL, synthetic simulation and replay; no claims of physical hardware or safety certification without evidence.
- **Visual standards:** original premium **light-led dual-theme** visual design; Cult UI, React Bits, Skiper UI (license check) and Awwwards inspiration used selectively. Cinematic 3D world is primary experience, but accessible controls and no-WebGL fallback matter.
- **Business scope:** reusable configurable missions, not one hardcoded port demonstration; no fake customer/revenue figures or invented marketplace coverage.
- **Evidence:** never present mocked telemetry, transactions, tests, screenshots or model outputs as live truth.
- **Secrets:** use devnet only. No private keys, seed phrases, credentials or personal data in repo or ChatGPT messages.
- **Eligibility:** follow hackathon rules about event-time implementation and external dependencies.
- **Ownership:** no direct changes to main; make a narrow branch and PR for the assigned ticket. Do not rewrite another workstream's contracts without review.

## How to execute a ticket

1. Print current branch/base SHA, relevant existing modules, issue goal and missing dependencies.
2. Name allowed/forbidden file paths; propose the minimal correct technical plan and tests.
3. Implement only the assigned issue; write a small failing regression test first when possible.
4. Produce an early running checkpoint. If blocked, state the exact root cause; never quietly use mock successes.
5. Run real tests, review edge cases, collect UI screenshots or SIM/chain receipts.
6. Open one PR and return exact head SHA, changed paths, commands/results, unresolved risks and required reviewer decisions.
7. Stop. Do not auto-merge or start unrelated new features.

**If you can't inspect evidence, say so.** If a ticket depends on missing code, use a typed fixture explicitly labeled Fixture, align to the shared contract and stop at the permitted scope.

## Reviewer expectation

Treat every issue like a skeptical production code review: inspect actual diff, test failures, wallet signer and PDA checks, race conditions, source provenance, accessible UI states, event replay and budget accounting. Label P0/P1/P2 findings and write a targeted correction prompt. Passing tests on a private branch does not imply integrated main is sound.

**Architecture, quality, demo and per-issue acceptance details are in docs/ISSUE_INDEX.md and docs/EXECUTION_PLAN.md.**

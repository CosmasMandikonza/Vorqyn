# Engineering agents, teammate collaboration and PR reviews

> This is the operational agreement for human owners, ZCode/GLM coding agents and independent ChatGPT code reviewers. **Real CI and observed transactions/telemetry outrank every model claim.**

## Working arrangements

- Repo: https://github.com/CosmasMandikonza/Vorqyn
- Product: https://app.notion.com/p/41001192111281d9b342c1f5b3d3fda5
- Team AI guide: https://app.notion.com/p/410011921112819e8667c455ac342e89
- Both teammates may use the same ZCode team **quota**, but use **different local workspaces and Git branches**.
- Each person has their **own ChatGPT review thread**. Neither ChatGPT automatically inherits the other's history, checked-out code or ZCode state.
- Notion describes product intent, repository docs formalize interfaces, GitHub source/PR/CI proves implementation. If inconsistent, flag and request a decision before rewriting a contract.

## Roles

1. **Human product/integration owner:** prioritizes issue dependency/acceptance, arbitrates shared contracts, decides merges, preserves hackathon narrative.
2. **ZCode implementer:** implements one bounded issue, runs tests, provides actual evidence and a small PR.
3. **Independent ChatGPT reviewer:** examines diff/test/UX traces and exposes failure modes; cannot certify code it cannot inspect.
4. **Release owner:** verifies an end-to-end demo on a clean browser and monitors submission artifacts; may be same human as integration owner.

No agent may self-assign sole power to change spending authority, acceptance criteria, or PR merge.

## Model routing

- GLM-5.3-Flash: bounded React/UI work, routine APIs, tests, accessible styling, small bugfixes and codebase navigation.
- Stronger reasoning model: cross-module integration, Anchor authority, verifier signatures, clock ordering, complex simulator/debugging.
- ChatGPT: external code review and adversarial protocol/systems UX audit.

Switching models does not remove obligation to run tests. Verify promotions/credits in ZCode's actual account usage view; no assumption of unlimited weekend access.

## Bounded task rule: prevent 16-hour agent drift

- **One VQ issue = one scoped result** with acceptance criteria. Start from a verified SHA and named allowed files.
- Before coding: inspect target paths and summarize planned changes and assumptions. If implementation scope does not match issue, stop and ask the human owner.
- Produce an early, reviewable **checkpoint** (type file or minimal test) and run it; don't spend hours rewriting unrelated code.
- Never let an agent autonomously generate a huge repo, alter every module, or refactor on a vague instruction like 'make it startup grade'.
- Break difficult work into separate commits with explicit stop conditions. If blocked by dependency, produce a minimal reproducible diagnostic, not a fake successful implementation.
- **Avoid unnecessary loops:** do not repeatedly run identical failed commands without changing the hypothesis; report root cause and next experiment.

## Copy/paste implementation prompt

Paste this under a **specific GitHub issue**. The issue body supplies detailed acceptance tests.

~~~~text
You are a senior engineer working on VORQYN for the November 6–8, 2026 Solana × MLH Hackathon. The objective is a real startup-grade physical-autonomy mission product, not a superficial demo.

REPOSITORY: https://github.com/CosmasMandikonza/Vorqyn
TICKET: [VQ-ID and issue URL]
WORKSTREAM: [UI / Mission / Sim / AI / Chain / Integration]
BASE: [verified branch + SHA]
BRANCH: [create feat/vq-ID-short-description]
ALLOWED PATHS: [from issue]
FORBIDDEN PATHS: [from issue]
DEPENDENCIES: [merged PR IDs / exact interface version]

Read: README.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/SOLANA_PROTOCOL.md, docs/DESIGN_SYSTEM.md, docs/QUALITY_GATES.md, and this issue. Read only additional files needed to implement.

FIRST respond with a concise plan: existing code found, what to change, specific failure cases, test strategy, interface changes, and how you will keep scope bounded.

IMPLEMENTATION RULES:
- Implement real code that addresses the issue, with accessibility, performance, security, error states and tests from the issue.
- Never fabricate telemetry, blockchain transactions, CI checks, screenshots or customer metrics.
- Work on assigned branch; do not alter 'main' or change shared contracts without approval.
- For financial and safety decisions, deterministic constraints + authenticated authorities outrank AI proposals.
- Use light-led dual theme and the four required design references, but don't install animations that block mission clarity.
- If tool/environment limitation prevents a valid implementation, stop with truthful blocker and the smallest path to unblock; never fake a pass.
- Create an early checkpoint before broad integration, then complete the specified tests.

DELIVERABLE (no vague 'done'):
1. Branch + exact head SHA; PR URL (or reason PR unavailable).
2. Changed paths and what each change does.
3. Exact test commands and observed outputs; failed/unrun tests identified.
4. Screenshots at named viewports if UI; simulator source+trace if robotics; actual devnet program ID/signature if Solana.
5. Adversarial edge cases covered and remaining risks.
6. Interface changes and downstream merge dependencies.
7. No merge until independent review. Do not claim the entire project is complete.
~~~~

## Copy/paste reviewer prompt

~~~~text
Independently review VORQYN work for issue [VQ-ID], PR [URL], base/head SHAs [values]. Use the repo docs and current issue as source of truth. Inspect the actual diff, relevant previous behavior, test files, logs, screenshots and chain state. If access is missing, say exactly what you did not inspect.

Prioritize P0 security/financial/mission truth/integration problems, P1 correctness/UX failures and P2 improvements. For each finding provide affected file/line, reproducer, violated contract, minimum fix, and regression test. Examine wallet signers, PDA ownership, money arithmetic, assignment-version freshness, proof verifier independence, repeat/unknown tx states, telemetry provenance, source clock synchronization, auth isolation, demo authenticity, responsive accessible theme.

Do NOT approve from an implementer's narrative, guessed passing tests or fabricated CI evidence. Return:
- Verdict: BLOCK / CONDITIONAL / APPROVE (with evidence limit)
- P0/P1/P2 findings
- Required tests and evidence
- A tightly scoped correction prompt back to ZCode
- Remaining risk before integration

The target is Top 3 Overall, so both real technological depth and visual/product excellence matter. No scope inflation or unrelated rewrites.
~~~~

## Standard handoff packet — required

| Field | Required value |
| --- | --- |
| Issue / workstream | VQ-ID, objective, human owner |
| Branch / SHA | Base and exact final commit |
| PR | URL / review status |
| Change inventory | Specific paths and high-level purpose |
| Tests | Exact commands, results, pass/fail counts, environment |
| UI evidence | Screenshots for light/dark, desktop/mobile where applicable |
| Robotics evidence | Source kind, simulator log, pose timestamp, fault trace |
| Chain evidence | Cluster, program ID, real tx signature, readback account state |
| Risk / mocks | What remains synthetic, out of scope, untested or failing |
| Dependencies | PRs/issue IDs that must merge next |

## Race and integration discipline

- No same-file concurrent edits without explicit division; use interface contracts and mocked fixtures only at a clearly identified boundary.
- Never build an alternative mission state model inside the frontend; shared event schema and reducer are authoritative.
- Contracts can be revised with a **reviewed versioned migration**, not silent edits.
- PRs require tests, real evidence and no unaddressed P0 bugs.
- Keep branch integration current; avoid piling up numerous branches with incompatible contracts.
- Merge one tested slice, then rerun related downstream checks on the **new merged head**.
- If CI is not yet installed, do not claim CI green. Manually run specific commands and record output.

## Safety, privacy and eligibility

Devnet only; use ephemeral test wallets and environment variables. Don't commit private keys, seed phrases, personal/customer data or school credentials. Sandbox robotics: no actual physical control or false real-world safety certifications. Confirm event rules for preexisting assets and licensed component use; no disguised recycled hackathon code.

## Review cadence

Review **every completed ticket/PR**, but reserve full systemic audit for protocol changes, first integration of each lane and final run. This keeps review effective without making each minor UI task a weeklong exercise.

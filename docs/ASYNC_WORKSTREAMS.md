# Asynchronous two-developer execution plan

**Status (November 6, 2026):** Suggested assignment plan until each developer claims the issue. Both collaborators can work from separate computers, at separate times, on distinct feature branches. The repository currently contains specifications and 17 open issues; **no code branch has been started** as of the initial check. Do not imply tasks are already in progress.

## Decision: split by module ownership, not by competing product implementations

- **Lane A — Founder / shared systems, contracts, Solana and integration ownership.**
  - First: [VQ-00 / Issue #1](https://github.com/CosmasMandikonza/Vorqyn/issues/1), establish repo/build/CI tooling.
  - Then: [VQ-01 / #2](https://github.com/CosmasMandikonza/Vorqyn/issues/2), shared IDs/events/state and tests.
  - Then: chain critical path [#5](https://github.com/CosmasMandikonza/Vorqyn/issues/5) → [#6](https://github.com/CosmasMandikonza/Vorqyn/issues/6) → [#7](https://github.com/CosmasMandikonza/Vorqyn/issues/7), with [#13](https://github.com/CosmasMandikonza/Vorqyn/issues/13) chain UI/client integration coordinated with Lane B.
  - Shared or reallocated with explicit agreement: [#9](https://github.com/CosmasMandikonza/Vorqyn/issues/9) mission simulation, [#11](https://github.com/CosmasMandikonza/Vorqyn/issues/11) verifier, [#12](https://github.com/CosmasMandikonza/Vorqyn/issues/12) AI proposals, [#14](https://github.com/CosmasMandikonza/Vorqyn/issues/14) full mission integration.
- **Lane B — Teammate / visual product, user experience and 3D world.**
  - **After VQ-00 lands on main**, begin [VQ-02 / Issue #3](https://github.com/CosmasMandikonza/Vorqyn/issues/3): accessible light-led dual-theme site, demo + workspace entry.
  - Next, **after VQ-01 contract lands**, [VQ-07 / Issue #8](https://github.com/CosmasMandikonza/Vorqyn/issues/8): port 3D, air/land/sea representations, camera views, provenance labels.
  - Next, **after integrated state exists**, [VQ-14 / Issue #15](https://github.com/CosmasMandikonza/Vorqyn/issues/15): World Dive, Mission Fracture, Ghost Replay and economic handoff.
  - Shared UI area of [#4](https://github.com/CosmasMandikonza/Vorqyn/issues/4) mission builder, [#14](https://github.com/CosmasMandikonza/Vorqyn/issues/14) integration, [#16](https://github.com/CosmasMandikonza/Vorqyn/issues/16) QA and [#17](https://github.com/CosmasMandikonza/Vorqyn/issues/17) demo/release should be split into exclusive PR paths before work starts.

**Why not start #1 and #3 simultaneously?** #1 is allowed to create the Next.js app skeleton and shared root package files. Starting #3 against the empty repo would likely lead to competing scaffolds and difficult merges. Work can be **assigned now**, but #3 coding should wait until #1 merges. While waiting, Lane B can read docs, establish independent ChatGPT context, build UI critique references and choose original/licensed assets—without committing files owned by #1.

These are **workstream recommendations**; neither person's GitHub issue is formally assigned until they claim it. Share this file so an absent teammate can act independently without a live meeting.

## Path ownership / conflict firewall

| Code paths | Owner while ticket active | Rule |
| --- | --- | --- |
| root package files, workspace config, CI and app scaffolding | Lane A on #1 | Lane B must not scaffold overlapping root/app files until #1 merges |
| packages/contracts/** | Lane A on #2 | Lane B reads frozen exports, no new local enum/reducer |
| apps/web/**, packages/ui/** (visual shells, scene, inspector) | Lane B on #3/#8/#15 | Lane A changes only explicitly agreed integration boundary files |
| programs/vorqyn/**, packages/chain-client/** | Lane A chain issues | Lane B uses typed client exports; doesn't invent Solana account semantics |
| services/mission/**, services/simulation/**, services/verifier/** | One named claim per issue | Before work starts, both lanes agree who owns these shared components |
| docs/ARCHITECTURE.md, SOLANA_PROTOCOL.md and AGENTS.md | Integration owner | Proposed edits require PR review; do not silently rewrite truth |

**If one issue spans both owners' directories**, break implementation into independently reviewable path-scoped PRs or agree on one temporary owner; never let two agents change the same feature branch or file without coordination.

## Git branching and merge order

1. **Fetch latest main** (or clone) before starting a ticket; verify the exact base SHA.
2. Developer A creates `feat/vq-00-foundation` for #1; leave `main` unchanged while coding.
3. Open PR with #1 acceptance checklist and exact test outputs; independent ChatGPT reviews actual diff.
4. Human merges only after no blocking failures. **Do not auto-merge based on an agent summary.**
5. Developer A branches `feat/vq-01-contracts` from new main. Developer B independently branches `feat/vq-02-experience` from the **same current main**; work on exclusive modules.
6. Before merging #2 or #3, update the other branch from latest main and rerun tests; resolve any discovered collision explicitly. If one branch changes shared exports, the other must re-run consumer build.
7. Each issue has **one PR**. Merge small tested increments; don't keep several massive branches diverged for the entire event.
8. Shared integrations (#13/#14) must have a designated integrator and an E2E test on **merged main**, not just isolated green branches.

Example commands if Git CLI is available:

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/vq-02-experience
# work and test
git add apps/web packages/ui
git commit -m "feat(ui): establish VORQYN dual-theme experience"
git push -u origin feat/vq-02-experience
# open PR targeting main
```

Use paths that actually exist after #1; never blindly copy commands before scaffolding.

**Never:** both push directly to main; two active PRs changing the same package lock/root config; commit API keys; force-push over someone else's work; merge shared schema migrations without downstream CI.

## Asynchronous claim and handoff protocol

At the top of each GitHub issue, add a short comment when starting:

```text
CLAIMED: Lane A or Lane B
Working branch: feat/vq-XX-short-title
Base SHA: [SHA of main]
Allowed paths: [list]
Expected outputs: [specific acceptance checklist]
Dependencies: [required merged PRs]
External changes needed: [yes/no; explicit]
```

When done, provide the PR link and a review packet:
- Issue ID and head SHA.
- Exact files changed, tests run and observed results.
- UI screenshots in light/dark and relevant sizes, or SITL logs, or actual devnet transaction signatures.
- What is not implemented, mocked, skipped or blocked.
- Proposed correction prompt from independent ChatGPT review.

**Communication without simultaneous calls:** Issue comments and PRs are handoffs; Notion is product policy; GitHub main is integration truth. If a decision is needed, mark the affected issue BLOCKED with the smallest question and implement another independent task instead of silently inventing an answer.

## Model setup for both developers

**ZCode:** GLM-5.3-Flash for bounded UI, routine API and tests. Escalate difficult Anchor authority, distributed state/races and simulator integration to GLM-5.3 or other high-reasoning reviewer. Confirm the actual weekend-token quota per account; the team plan does not sync chat context or local worktrees.

**ChatGPT:** independent reviewer in each person's separate chat. Begin with docs/PRODUCT.md, SOLANA_PROTOCOL.md, DESIGN_SYSTEM.md, AGENTS.md, this plan and the assigned issue; if connected to GitHub, inspect actual diff and CI. ChatGPT reviews **after each PR**, giving P0/P1/P2 findings and a narrowed fix prompt back to ZCode.

**ZCode startup prompt template:** docs/AGENT_PROTOCOL.md. **Teammate ChatGPT initial prompt:** [shared Notion guide](https://app.notion.com/p/410011921112819e8667c455ac342e89).

## Quality and deadline truth

Top 3 requires real Solana materiality, a coherent beautiful 3D experience and a reliable mission. With only two developers and a weekend, do not assume all 17 issues can be fully built. The **must-prove vertical slice** is: one funded devnet mission → failure generates rejected evidence → policy-suitable recovery → authorized onchain reassignment → independently verified proof → single-use correct payout → synchronized replay. The 3D world must illustrate real events, not replace them.

Cut optional gimmicks, extra simulator breadth and third-party service integrations before cutting chain integrity or failure semantics. Report true status clearly; no false 'production grade' claims.

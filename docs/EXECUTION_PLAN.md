# Competition execution plan — high ambition, bounded tasks

> Goal: compete for **Top 3 Overall ($1,000 team microgrant)** with one functioning, visually extraordinary, Solana-material product. This is a plan, not proof of completion, nor a guarantee of winning.

## 1. Time and scope constraints

Event: Friday November 6, 2026 12:00 PM ET start; Sunday November 8 10:00 AM ET initial submission and 11:45 AM ET final hacking cutoff per official schedule (verify actual portal). Plan to be **submission-ready before initial cutoff**, keeping the final window for permitted fixes and verification.

Some AI coding runs can drift for many hours. Countermeasure: **one narrow acceptance-based issue per agent run**, inspect checkpoint before next module, no autonomous multi-hour rewrite. A human owner should checkpoint when an agent expands to unrelated paths or cannot demonstrate progress. Model speed is not a substitute for contract and integration testing.

## 2. Architecture-first critical path

1. **Baseline:** README, architecture, protocol, product design and quality gates (present in docs).
2. **Shared contracts:** typed mission/task/events, template config, versioning, JSON examples and tests.
3. **Parallel foundations:** app shell/theme, mission persistence/API, Solana escrow program & tests.
4. **Parallel experience/control:** 3D world and verified telemetry adapter / deterministic scenario engine.
5. **Core differentiated loop:** genuine failure → evidence policy → agent candidate selection → authorized reassignment → independently attested payout.
6. **Integration:** client reads shared events, chain state and robot telemetry in one mission; paid status from chain read-back.
7. **Top-3 polish:** guided World Dive/Mission Fracture/Ghost Replay, visual QA, clear final presentation and deployment.
8. **Submission:** reproducible demo and transparent evidence.

No lane should begin inventing shared enums, auth roles, accounting or timestamps before the contracts are frozen.

## 3. Work packages and dependencies (issue IDs)

The repository issues use **VQ-00 .. VQ-16** identifiers in their titles. Numbers are logical task IDs, not GitHub issue numbers.

| Ticket | Lane | Outcome | Needs |
| --- | --- | --- | --- |
| VQ-00 | Integration | Tooling, app skeleton, automated checks and shared contracts baseline | Docs |
| VQ-01 | Shared | Versioned mission/task/event schema + deterministic reducer tests | VQ-00 |
| VQ-02 | App | Light/dark product shell, visitor + company navigation | VQ-00 |
| VQ-03 | Backend | Company workspace, mission builder persistence/validation | VQ-01 |
| VQ-04 | Chain | Escrow init/fund/task PDA + accounting tests | VQ-00 |
| VQ-05 | Chain | Scoped/revocable reassignment and offer rules | VQ-04, VQ-01 |
| VQ-06 | Chain | Independent verifier claim, payout, refund and attack tests | VQ-05 |
| VQ-07 | Experience | 3D port, camera system, 3 vehicle roles, fidelity labels | VQ-01, VQ-02 |
| VQ-08 | Autonomy | Deterministic task engine, telemetry/event log and fault model | VQ-01 |
| VQ-09 | Autonomy | Genuine controller/SITL adapter for one vehicle + provenance tests | VQ-08 |
| VQ-10 | Autonomy | Evidence-policy verifier + source-bound signed verdict | VQ-08, VQ-01 |
| VQ-11 | AI | Candidate selection, deterministic policy checks, safe fallback | VQ-10, VQ-05 |
| VQ-12 | Integration | Chain client + transaction lifecycle + mission event reconciliation | VQ-04, VQ-05, VQ-06, VQ-01 |
| VQ-13 | Integration | Full working demo mission: recovery → accepted proof → real payout | VQ-03, VQ-07–VQ-12 |
| VQ-14 | Experience | World Dive / Mission Ghosts + evidence/economic timeline | VQ-07, VQ-08, VQ-13 |
| VQ-15 | Product QA | Visual accessibility, failure/offline paths, smoke/e2e | VQ-13, VQ-14 |
| VQ-16 | Release | Deploy, demo video, public proof, honest MLH submission | VQ-13, VQ-15 |

**The workflow deliberately allows earlier partial integration**: merge a small vertical slice as soon as shared interfaces exist. Do not wait for VQ-06 to finish before UI talks to a typed mock **clearly labeled as fixture**; replace fixture with chain truth before declaring P0 complete.

## 4. Suggested two-person split

Owners must be agreed by humans; tickets are initially unassigned.

- **Lane A / UI:** VQ-02, VQ-07, VQ-14, visual parts of VQ-15.
- **Lane B / backend/autonomy:** VQ-03, VQ-08, VQ-09, VQ-10, VQ-11.
- **Chain/QA shared rotation:** VQ-04/05/06/12 and VQ-13/15/16, with a named integration owner.

One person should coordinate **interface-version changes** and the end-to-end branch. Do not imply one person must simultaneously complete all chain tasks; assign and reorder to leverage real strengths. Use separate branches, avoid multiple writers on the same module.

## 5. Rules for powerful coding agents

- Read only the task's scope and related docs; inspect current repository before starting.
- Give explicit allowed paths, forbidden paths, dependencies, tests and acceptance. Short tickets beat 16-hour vague prompts.
- Work until a defined checkpoint: schema committed + tests, contract instruction + negatives, or a demonstrated UI interaction.
- Report blockers promptly rather than substitute fabricated data or silently broaden scope.
- Checkpoint first meaningful implementation/test before pursuing secondary visual polish.
- One PR per issue, not one mega PR for a whole startup.
- When complex work truly needs several substeps, break into reviewable commits without altering issue goal.
- **Don't hide stubs:** UI fixtures must be named fixtures and must not masquerade as real chain/simulator integrations.

## 6. Stop/go tradeoffs

**If deadline pressure occurs:**
1. Preserve real funding/reassignment/payout and negative tests.
2. Preserve a real failed evidence gate and constrained AI decision.
3. Preserve usable 3D world with truthful vehicle positions and one genuine simulator/controller where technically possible.
4. Preserve working guest demo and custom company mission with distinct settings.
5. Reduce post-processing, excessive UI animation, extra robot fidelity, global marketplace and novel chart systems *before* sacrificing chain correctness.

**Hard stop:** if verified chain transactions are not functioning, do not assert they are; show read-only historical real proof or accurately label the incompleteness.

## 7. Final integration owner check

- Fresh clone + documented setup works.
- No placeholder links, fake explorer receipts, screenshot-only telemetry or fabricated customer metrics.
- One repeatable successful demo + negative wrong-operator/duplicate tests.
- All current PR SHAs and deployment program ID are recorded.
- Independent code/UX review addressed, unresolved issues disclosed.
- Submission ready before initial deadline; video accurately represents actual software.

See AGENT_PROTOCOL.md for prompts, QUALITY_GATES.md for validation, DEMO_RUNBOOK.md for video.

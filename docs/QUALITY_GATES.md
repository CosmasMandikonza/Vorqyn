# Quality gates and adversarial test matrix

> **Current status:** These are acceptance standards, not recorded test results. An issue/PR cannot say "complete" merely because a model says it implemented the feature.

## Four judgment dimensions + Solana-specific bar

**Technology:** real architecture, nontrivial state changes, correct onchain authority; **Design:** exceptional visual craft and truthful usable controls; **Completion:** integrated mission survives an unfamiliar tester; **Learning:** team can explain novel technical challenges and what they learned. Additional hackathon criterion: Solana is material, not bolted on.

## Release gates — P0

| Gate | How to prove it | Failure is a blocker when… |
| --- | --- | --- |
| G1: Product authenticity | New mission has unique ID/config; guest demo distinct from workspace | Custom form secretly launches the hardcoded scenario |
| G2: Source-of-truth | UI reads mission events, not internal animation-only counters | Timeline and world disagree or cannot reload |
| G3: Physical evidence | At least one claimed real adapter emits genuine simulator/controller telemetry; other sources correctly identified | Claimed SITL is synthetic with no source logs |
| G4: Failure semantics | Low visibility produces real rejected evidence with rule IDs and measured values | UI only flashes red while mission still marks complete |
| G5: Autonomous selection | Candidate choice based on structured capabilities and budget, with deterministic validation | AI hallucinates operator, ignores sensor fit or exceeds budget |
| G6: Solana materiality | Confirmed devnet funding, real onchain reassignment, correct eligible payout | Wallet UI is simulated or finance can be replaced by a counter |
| G7: Security & finances | Wrong signer, stale assignment, duplicate payout, bad proof, overbudget all rejected | Any negative test transfers funds or corrupts state |
| G8: Trust & UX | Correct payment status, source labels, audit explanation, accessible no-WebGL fallback | "Paid" displays before confirmation or impossible to inspect |
| G9: End-to-end | Fresh visitor completes flow, reliable restart/replay, deployment works | Needs hand editing DB or manually fixing RPC between steps |
| G10: Submission | Eligible time-window work, 2-min video, public repo/notes, actual artifact links | A required component is missing or misleading |

## Unit & integration test requirements

### Mission/organization

- Org isolation: user A cannot access/mutate org B mission.
- Mission creation: supported template only, unique ID, editable draft, correct budget/roles.
- Concurrency: two writers with same mission version → one succeeds, stale writer rejected.
- Idempotency: repeated POST / launch command does not create duplicates.
- Reload: events reconstruct same task status and assignment version.
- Invalid task configuration: negative budget, impossible sensor requirement, duplicate task or unknown robot rejected.
- Guest cannot mutate another customer mission, exhaust shared devnet escrow or access private evidence.

### Simulator / renderer

- Use realistic source units/frames and telemetry; verify pose and orientation conversions with known fixtures.
- Stale telemetry freezes/marks last sample; out-of-order and duplicate telemetry are not applied incorrectly.
- Low visibility actually decreases usable optical evidence.
- A sonar capable replacement accepts only actual applicable task coverage/quality, not generic success.
- Camera transitions: no clipping, no lost target, no insane zoom, correct drone/rover/ROV scale.
- Waterline, underwater coordinates, no-GPS semantics and sensor uncertainty show accurately.
- Scene works when glTF assets missing, WebGL context lost, or GPU quality reduced.

### Agent / policy

- AI returns structured candidate references; malformed JSON or unknown offer rejected.
- Agent chooses eligible sonar candidate over cheaper optical-only candidate; deterministic policy enforces result.
- AI API timeout/unavailable → explain state and safe fallback; no automatic approval.
- Over-budget, expired offer, unavailable robot, incompatible capability, stale mission all rejected.
- AI cannot sign unrestricted transfers, self-certify evidence, or override authorization/revocation.
- Delegated authority vs owner confirmation is accurately represented in tests and UI.

### Solana

- Funded escrow balance read-back; checked integer math and rent handling.
- Valid reassignment updates task owner/version; old signer/old proof cannot claim afterward.
- Two simultaneous reassignment attempts → at most one valid version transition.
- Invalid verifier, task ID, mission ID, PDA, digest, expiry, assignment version, recipient rejected.
- Double claim / retries → at most one transfer; vault remains solvent.
- Closing/refunding task preserves owed amounts; no excess payout.
- Devnet RPC failure, blockhash expired, wallet cancel and unknown confirmation all reconciled from chain truth.

### Web/UX

- Light and dark persist; system mode supported; theme flip during mission does not reset world/time.
- Signup & mission draft supports keyboard, SR labels and form errors; 320px and 200% zoom pass manual checks.
- Guest demo does not demand wallet connection, includes honest simulation/devnet state.
- Empty organizations/missions/operators have useful states.
- No payment status based only on toast; explorer link maps to correct actual network/tx.
- Reduced motion and loading/performance fallback remain understandable.

## Integrated acceptance test: explicit steps

1. Open fresh incognito guest demo → ensure no auth barrier and correct simulation labels.
2. Start demo → validate task ledger and three vehicle roles are part of one mission.
3. Observe genuine telemetry provenance where claimed; record event IDs.
4. Inject underwater low-visibility → optical evidence rejected and payout prohibited.
5. Compare at least two recovery offers → reject incapable cheaper one; choose eligible alternate under budget.
6. Human or bounded agent authorizes reassignment → **real devnet tx confirmed**, current assignment version increments.
7. Execute replacement → verify acceptable simulated sonar coverage; independent verifier signs approved digest.
8. Claim once → **real devnet tx confirmed**, correct operator receives payout.
9. Repeat stale and duplicate claims → rejected with unchanged state.
10. Reload and scrub replay → event, simulator and chain time are aligned and truthfully labeled.
11. Create separate organization mission with different budget/config → persists and remains isolated.
12. Test wallet cancel, no RPC, no WebGL, missing assets, mobile, keyboard, and refresh.

**What qualifies as evidence:** screen recording, CI check run URL, exact shell commands and outputs, screenshot filenames, log trace, deployed program ID, explorer transaction signatures, full PR diff, reviewer note. A claim that "all tests pass" without output is not proof.

## PR acceptance

Every PR must supply:
- narrowed scope and issue; head SHA; changed paths;
- baseline failing test for bugfixes where practical;
- commands run and precise observed outcomes, no guessed counts;
- risk table with P0/P1/P2, including unrun tests;
- screenshots for UI and receipts for chain features;
- authorization/state migration risks;
- explicit upstream/downstream contract changes;
- integration owner's approval on shared contract modifications.

**No merge based only on a passing isolated unit suite.** Run appropriate cross-lane E2E once dependencies exist.

## Demo smoke fallback

If RPC becomes unavailable, demo can show a **previously recorded, verifiably real devnet transaction** and read-only replay, clearly labeled Playback; it must not claim a new transaction occurred. If SITL cannot run on deployed host, use recorded genuine trace (labeled) or limited synthetic simulation, and be honest about fidelity. Reliability is better than deception.

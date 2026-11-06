# Product definition — VORQYN

> **Status:** Approved product *direction*, proposed scope. Nothing in this document claims implemented software, deployed hardware or validated revenue. Source-of-truth changes require a reviewable decision and PR.

## 1. North star

**VORQYN makes independently operated autonomous machines capable of completing accountable missions together, even when an operator fails.** One system coordinates physical task execution, evidence, failure recovery, and settlement under constrained shared economic rules.

Core story: **fund → operate → detect insufficient evidence → recover → authorize replacement → verify → settle → replay**.

**Top-3 competition test:** Judges understand the benefit in 15 seconds and can independently observe a genuine app state change, real Solana devnet authorization, and payment to the new eligible operator. A serious technical product without this proof is not finished.

## 2. Buyer, user and value

- **Buyer hypothesis:** industrial inspection service providers / port infrastructure operators who need work from several robot fleets.
- **Mission owner:** creates mission, specifies acceptable evidence, funds it, grants bounded authority, reviews result.
- **Fleet operator:** registers an authorized machine capability and receives eligible task assignments and payouts.
- **Operations reviewer:** inspects mission telemetry and verification, views failure/recovery history.
- **Hackathon visitor:** enters read-only or safe simulated demo without creating an account.

**Business value hypotheses:** fewer failed jobs requiring human intervention, reduced coordination effort across vendors, reliable proof of accepted work, faster agreed settlements. Measure recovery time, successful task-completion rate, hours spent coordinating, claim acceptance, and time to confirmed payout in later pilots. These are **not proven savings**.

Potential monetization: enterprise software subscription first; marketplace fees and developer APIs later. Do not add a speculative token or NFT simply to qualify for a track.

## 3. Two user journeys: same backend

### Visitor / judge

1. Landing: clear headline, real world preview, primary **Explore Demo** CTA.
2. Enter **Demo Port** as guest without wallet/sign-up; guided controls, explicit Simulation/Devnet labels.
3. Inspect aerial drone, ground rover and underwater ROV tasks in a synchronized 3D world.
4. Trigger a controlled low-visibility **underwater evidence** fault; a real server mission state transitions to recovery-needed.
5. View the AI's candidate comparison, including why a cheaper optical-only operator fails policy.
6. Authorize or observe a pre-authorized **real devnet reassignment** to sonar-capable replacement. Show pending/confirmed state.
7. Replacement's separate simulated run satisfies underwater obstruction-coverage criteria; independent verifier attests; correct operator claims exactly once.
8. Inspect failure/repair timeline, evidence confidence and confirmed devnet signature. Then try reloading/replaying.

**Guest safety:** no open general-purpose money-moving transactions; guest demo uses pre-funded/test-only scoped devnet resources, rate limits and resettable fixtures. If no funds or RPC is down, provide truthful read-only replay—never a fake live settlement.

### Company / workspace

1. Sign up or sign in; create an organization with name and owner.
2. Create mission using a **supported template**, not arbitrary real-world topography.
3. Configure scenario variant, named tasks, capability requirements, acceptance policy, operators and budget.
4. Validate, save as draft, review, connect wallet and fund (only on devnet in prototype).
5. Launch, monitor, inspect evidence, review agent actions, and end with an auditable result.

**Reality check:** A second mission must preserve distinct missionId, owner, task settings, price and status through reload; changing form fields must materially change mission state. Do not build a dummy builder that always launches PORT-001.

## 4. Flagship experience: port clearance after storm

**One physical operational question:** Can the simulated access route and submerged loading area pass defined inspection criteria?

- **Air:** drone surveys visual obstructions from above; visibility and coverage recorded.
- **Land:** rover assesses dock access and blocked road segments.
- **Sea:** ROV A performs optical submerged obstruction survey; visibility falls below evidence threshold and the task becomes **insufficient**, never falsely completed.
- **Recovery:** alternate ROV B with sonar capability can meet the **obstruction mapping** acceptance policy. Optical-only provider is ruled out even if cheaper.
- **Verified result:** accepted coverage is attached to the current assignment version, reviewer can inspect failed vs recovered traces.
- **Chain result:** program releases eligible reward to authorized ROV B, while stale ROV A assignment cannot claim it.

**Simulation honesty:** The initial port and obstacles are modeled/simulated. Underwater sonar may reasonably support obstruction detection; it does not automatically certify underwater structural integrity. Do not advertise real-world port reopening safety or fully autonomous field deployments.

## 5. Feature priorities

### P0 — must actually work

- A coherent light-led brand with crafted dark mode; instant guest demo and navigable mission workspace.
- Stateful mission engine and **two independently configured missions**.
- A clear 3D port scene with three meaningful vehicle roles, camera modes and truthful fidelity labels.
- At least **one genuine external controller/SITL telemetry source if feasible**; others may use explicitly labeled stateful simulation—do not market all as hardware-grade autonomy without proof.
- Evidence rejection based on actual configured thresholds, not CSS color.
- AI agent proposes a **traceable, constrained** replacement; deterministic policy checks eligibility and budget.
- Real devnet on-chain escrow and authorized task reassignment, not a wallet facade.
- Verifier approval bound to mission/task/operator/assignmentVersion/evidence digest.
- Real devnet payout, single-use protection and receipt; old operator and duplicate claims rejected.
- Mission replay aligns simulator time, event time, and blockchain confirmation time.
- Deployed demo, reproducible walkthrough, accessible fallback and submission evidence.

### P1 — strengthens differentiation after P0 is green

- A polished **World Dive** from air to dock to underwater, preserving spatial context.
- **Mission Ghosts:** separately recorded failure vs recovery branches with clearly marked comparison.
- Multiple replacement offers and ineligible/over-budget alternatives shown in UI.
- X-ray/coverage/uncertainty overlays, accessible operations-vs-immersive layout.
- Full company invite/role-management rather than a minimal authenticated workspace.

### NOT NOW

Actual remote control of production drones, unbounded public marketplace, custom arbitrary-geometry simulator, onchain physics, cryptocurrency tokenomics, advanced onchain dispute arbitration, banking-like onboarding, cross-environment physics accuracy claims, mobile 3D parity at all costs.

## 6. Experience principles

- **World first, data on demand:** 3D is a real state renderer; no twenty-card dashboard.
- **Design honesty:** distinct badges for Simulated, Playback, Live SITL, Devnet and Confirmed. Those categories are not interchangeable.
- **Causal clarity:** failure is visible in physical state, verifier state, AI explanation, assignment rights and settlement.
- **User trust:** no hidden irreversible actions. Display transaction state and reasoning, amount and recipient.
- **Accessibility:** reduced motion, keyboard, contrast, responsive/mobile 2D summary, WebGL fallback, distinguish states by words/icons not color only.
- **Professional:** typography is readable; controls do not obstruct machine evidence; theme switching never changes simulation time-of-day.

## 7. P0 product acceptance scenarios

- Guest opens demo anonymously, understands the scenario and safely triggers failure.
- Port task rejects optical evidence after visibility fault; no payment authorization.
- AI rejects cheaper, incapable operator and proposes valid sonar operator.
- Authorized program state changes before payout; unauthorized assignment or claim rejected.
- Verifier accepts correct replacement proof only for current assignment version.
- Confirmed SOL devnet balance change is shown **with transaction signature**.
- Reload reconstructs mission with original failure still inspectable.
- A second company mission with a different budget/config persists distinctly.
- Both themes and a low-capability fallback are understandable and usable.

## 8. Team constraints / explicit decisions

Architecture and components are specified in ARCHITECTURE.md and DESIGN_SYSTEM.md. Finances in SOLANA_PROTOCOL.md. No workstream may silently weaken those contracts in pursuit of demo appearance. If the team must reduce scope, cut secondary visuals first and preserve **complete real onchain recovery loop**. Log any mock/simplified scene visibly.

### Current open questions

- Repo scaffolding choices, selected deployment host and runtime budget.
- Exact simulator-adapter installation feasibility on available Windows/WSL/Linux hardware.
- Whether the demo guest uses a privileged rate-limited devnet fixture or only guided playback for settlement.
- Auth provider, role model, API hosting and data retention.
- Explicit authority model for AI: owner-confirmed action by default; optional strictly pre-authorized bounded delegate only after tests.

Do not resolve these by silently inventing infrastructure. Document decisions with impact and tests.

### References

- [Notion product brief](https://app.notion.com/p/41001192111281d9b342c1f5b3d3fda5)
- [Official hackathon](https://events.mlh.com/events/15200-solana-hackathon)
- [MLH standard judging and rules](https://github.com/MLH/mlh-policies/blob/main/standard-hackathon-rules.md)

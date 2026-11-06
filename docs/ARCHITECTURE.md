# Architecture & shared interfaces (initial contract)

> **Design proposal** for implementation. No files or services below are presumed to exist. Only one source of event/state truth; clients render it. Freeze the first interface revision in the foundational implementation ticket before building separate workstreams.

## 1. Suggested monorepo layout

| Path | Responsibility | Owner lane |
| --- | --- | --- |
| apps/web | Next.js App Router: marketing, guest demo, org workspace, mission viewer | Experience |
| packages/contracts | Typed IDs, JSON schema or Zod, deterministic state transitions and serialization | Shared / integration |
| packages/ui | Brand tokens, accessible Cult UI adaptations, mission shell widgets | Experience |
| packages/chain-client | Anchor IDL/client wrapper, tx statuses, normalized receipts | Chain |
| services/mission | Mission creation, event persistence, policy gates, orchestration | Autonomy |
| services/simulation | Scenario engine, simulator adapters, telemetry normalization, provenance | Autonomy |
| services/verifier | Evidence policy evaluation and independent signing | Security / chain |
| programs/vorqyn | Anchor/Rust onchain program | Chain |
| tests/e2e | Self-run product journey, failure and chain negative tests | Integration |
| docs | Product, contract, design, review, runbook | Shared |

This is a **recommended** layout, not a requirement for needless folders. Prefer a small executable vertical slice over premature distributed services. A single server with clear module boundaries is preferable to multiple services that cannot be deployed in time.

## 2. End-to-end control/data flow

1. Mission owner chooses a supported template and persists mission/task config.
2. Escrow funding is submitted to devnet; chain state read-back records confirmed funded status.
3. Orchestrator starts simulator/controller tasks and emits typed events.
4. Telemetry adapter maps source-specific output into normalized pose, frame, units, clock and quality. Client renders accepted snapshots, not its own invented flight path.
5. Failure injection alters simulator observations/evidence; policy verifier marks output insufficient.
6. Agent receives **structured candidate list** and returns a proposed replacement with short rationale; deterministic validator gates budget/capability/authority.
7. Human owner signs or a bounded pre-authorized delegate submits reassignment; wait for chain confirmation.
8. Replacement's **new** execution trace is evaluated by an independent verifier.
9. Current authorized verifier signs acceptance; the chain program enforces one-time payout.
10. Event log stores chain transaction signature and three timestamps; replay shows a truthful ordered timeline.

**No Solana in the low-level control loop.** No AI bypassing verifier or deterministic safety constraints.

## 3. Type contracts (first revision to implement)

All IDs opaque strings/UUIDs except explicit Solana PublicKeys; don't derive identity from display name.

| Contract | Required fields |
| --- | --- |
| Organization | id, name, ownerUserId, members/roles, createdAt |
| Mission | id, organizationId, templateId, siteLabel, budgetLamports, state, version, createdAt |
| MissionTask | id, missionId, kind (air/land/sea), requirements, currentAssignmentVersion, assignedOperatorId?, maxRewardLamports, status |
| OperatorOffer | id, taskId, operatorId, robotId, sensorCapabilities, quoteLamports, expiry, availability, signedByOperator? |
| Robot | id, operatorId, class, sourceKind (SITL/synthetic/replay), sensors, capabilities |
| TelemetrySample | missionId, robotId, sourceKind, sourceTimestamp, receivedAt, frameId, position/orientation, units, quality, sequence |
| Evidence | id, taskId, assignmentVersion, operatorId, sampleRefs, policyVersion, digest, simulatorSource, capturedAt |
| Verdict | evidenceId, accepted, reasons[], verifierId, verdictVersion, decidedAt |
| Assignment | taskId, version, operatorId, agreedLamports, activatedAt, chainSignature? |
| ChainEvent | kind, missionId, taskId?, transactionSignature, confirmationStatus, submittedAt, confirmedAt?, slot? |
| MissionEvent | eventId, missionId, sequence, kind, payload, occurredAt, observedAt, simulatorTime?, chainTime?, schemaVersion |

**Typed sum states, not booleans:** mission (draft, funding, ready, running, recovery_needed, verifying, completed, closed, failed), task (unassigned, assigned, executing, evidence_insufficient, recovery_pending, reassigned, verified, paid, cancelled). Chain tx (unsigned, awaiting_wallet, submitted, processed, confirmed, finalized, expired, rejected, unknown). Unknown is not failure or success.

## 4. Invariants

- **Single writer per mission aggregate** or optimistic concurrency via version compare-and-set; concurrent commands cannot both reassign same task.
- Exactly one active assignment version per task; any evidence/claim from previous version invalid.
- **No client-initiated final truth:** user interface cannot write confirmed status directly.
- Idempotency key for command and transaction attempt; retries do not create duplicate mission, payout or task.
- Budget is lamports/integers, never floating-point token amounts in business logic. Total committed rewards + refunds may not exceed deposited balance.
- Telemetry source and timestamps preserved; positions labeled with reference frame (e.g. local ENU), altitude datum, units and confidence.
- **Three clocks** kept separately: simulator step time, service event receipt time, Solana confirmation time. Replays never invent chain events at prior simulation times.
- **Verifier independently evaluates** evidence from source trace; AI self-verdict is never enough for payment.
- Production control requires safe physical-control authority; hackathon only commands simulated environments.

## 5. Simulator fidelity and geometry

- Select one canonical **port scene**, physically interpretable axes, route/zone geometry, and camera bounds. Document units and frame origin.
- Drone ideally sources ArduPilot Copter SITL pose/mission status via MAVLink; rover/ROV can initially use real deterministic scenario engines **visibly labeled as simulated**, then upgraded adapters.
- Adapter contract: connect(), startScenario(), injectFault(), readTelemetry(), stop(), health(). Start/stop idempotent.
- Telemetry cannot keep marching when connection drops. UI shows stale timestamp, freezes last authoritative state, optional clearly marked extrapolated prediction only if explicitly enabled.
- Uncertainty/coverage data is **measurements or documented synthetic test data**, never a numerical confidence made up by an LLM.
- World Dive camera transitions preserve missionId, selected robot, coordinate alignment and waterline context; camera collisions, marker min size and reset view are required.
- Use world units/meters consistently; glTF scale and orientation must be checked. Underwater GPS unavailability, sensor degradation and low visibility cannot be hand-waved.

## 6. Evidence verifier and decision policy

Explicit task policy examples:
- Drone: minimum coverage and no stale sample references.
- Rover: required accessible route segment actually traversed in simulator.
- Underwater obstruction survey: accepted coverage region **and** minimum quality score from a supported simulated sonar sensor; poor optical visibility alone fails original optical-only assignment.

A verdict stores rule IDs, thresholds, measured observations, policy version and reasons; failed attempts remain audit-visible. A hash binds evidence to bytes supplied by sources, not to independent physical truth. Separate verifier key and agent authorization key.

AI receives *structured* data; outputs JSON proposal (offerId, taskId, assignmentVersion, reasons, checkedCosts, limitations). Reject malformed, hallucinated operator, unknown sensor, overbudget, stale mission, and unauthorized actions. Deterministic selection/fallback if AI/API unavailable; label it as rule-based, not LLM-directed.

## 7. API surface to implement (illustrative)

- POST /organizations and GET /organizations/:id
- POST /missions, GET /missions/:id, PATCH /missions/:id (version required)
- POST /missions/:id/start and POST /tasks/:id/faults (demo-only, scoped)
- GET /missions/:id/events with cursor; SSE or WebSocket for updates
- GET /tasks/:id/offers and POST /tasks/:id/recovery/propose
- POST /tasks/:id/recovery/authorize (requires correct actor and chain confirmation)
- POST /tasks/:id/evidence and POST /tasks/:id/verify (service-authorized)
- GET /missions/:id/replay (provenance-marked event stream)
- GET /missions/:id/settlement (read authoritative chain state; never client trust)

Authorization must be server-checked for all mutations, not just hidden UI controls. Demo endpoints must be rate-limited and isolated from other organizations.

## 8. Frontend event mapping

UI statuses must be derived from service/chain state. Mission timeline cards link to specific evidence/transaction IDs. "Paid" appears **only after confirmed chain read-back**. Simulator offline, LLM unavailable and RPC unavailable are separately visible.

The guest route can show captured **verified replay** if services fail, but it must explicitly say Playback and cannot generate new success notifications.

## 9. Integration protocol

One integration owner controls shared types and published schemas. Any changes to event enum, authority, timestamps or money fields require a PR with migration/tests and notify both lanes. Merge order: contracts → services & chain/client → UI integration → e2e. Commit complete, tested vertical slices; avoid 16-hour unsupervised multi-module edits.

See SOLANA_PROTOCOL.md, QUALITY_GATES.md and EXECUTION_PLAN.md.

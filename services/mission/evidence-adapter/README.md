# VORQYN mission evidence adapter (`services/mission/evidence-adapter`)

Issue #9 integration slice, owned by **Agent C**. Source-backed compatibility
layer between the deterministic simulation kernel's observations and Omar's
task-evidence verifier (`services/verifier`). It resolves the two
`BLOCKED` telemetry→verifier rows in Codex's
[`docs/evidence/integration16/INTERFACE_HANDOFF.md`](../../../docs/evidence/integration16/INTERFACE_HANDOFF.md)
(PR #55): the **modality/units vocabulary gap** (`visibility_m` /
`sonar_ping` vs unitless `quality01`) and the **source/capture/receipt clock
gap** (simulator-relative ms vs epoch-shaped capture/decision values).

The contracts, the kernel, the telemetry bridge, the observation journal and
the verifier are read-only upstream of this module — nothing here re-declares
or weakens them, and no existing file was modified.

## What lives here

| File | Responsibility |
| --- | --- |
| `clock-mapping.ts` | explicit, versioned, stream-bound mapping `sourceSimulatorTimeMs → captureEpochBaseMs + sourceSimulatorTimeMs`; refuses other algorithms (no silent epoch conversion) |
| `calibration.ts` | the only path from unitless kernel optical `quality01` to `visibility_m`: an explicit, fully documented, monotone, domain-bounded calibration — **none ships by default** |
| `capture.ts` | modality-scoped, contract-valid evidence captures from accepted guest-journal records; preserved provenance; per-observation audit; explicit exclusions |
| `submission.ts` | `prepareSubmission` / `evaluateCapture`: inputs for the EXISTING verifier plus a decision-clock domain guard; verdicts are the verifier's own, untouched |
| (tests) | `apps/web/tests/evidence-adapter/*.test.tsx` via vitest (same reason as `services/mission/simulation`: contracts are TS source packages; see that slice's README) |

## Non-overlap / ownership

- Owns ONLY `services/mission/evidence-adapter/**` and
  `apps/web/tests/evidence-adapter/**` (new paths; ownership declared on the
  PR and to be confirmed by Agent A in review — no shared file was touched).
- Reads Agent A's `telemetry-bridge.ts` / `observation-journal.ts` and Omar's
  `services/verifier/src/*` as dependencies. It does NOT modify them.
- Does NOT touch Solana programs, the mission reducer, Agent B's UI, Codex's
  harness, shared contracts, or root/lockfile configuration.

## 1. Metric mapping (source-backed only)

| Kernel observation | Adapter output | Justification |
| --- | --- | --- |
| sonar sensor (`kind: "sonar"`) with a real measured value (e.g. `rov-01-sonar`) | `qualityMetric { kind: "sonar_ping", value: measured.quality01 }` | The verifier's sonar rule (`POLICY_SEA_OBSTRUCTION_1`) requires sonar-**backed** samples (`backingMetricKind: "sonar_ping"`). The kernel's sonar measurement is a real, independent observation; it is preserved verbatim. The value remains the kernel's **unitless fixture return quality** (`unitless_0_to_1_fixture_model`) — no distance is invented, and the flagship sonar rule applies no threshold to it. |
| optical sensor (`kind: "optical"`) with a real measured value | `qualityMetric { kind: "visibility_m", value: calibrated metres }` — **only** with an explicit `VisibilityCalibration` | The kernel's optical quality is explicitly `unitless_0_to_1_fixture_model`. Without a documented, source-backed calibration the adapter returns the structured error `optical_visibility_unsupported` (with remediation). It NEVER treats `quality01` as metres. |
| robot without the requested modality (e.g. drone/rover for sonar) | exclusion record `sensor_modality_missing` | Sonar evidence is never manufactured from optical quality or anything else. |
| paused / disconnected / stale (`fresh: false`) snapshots | exclusion records `kernel_paused` / `link_disconnected` / `no_fresh_measurement` | Frozen states carry no measurement (`measured: null`) and are never dressed up as evidence. A window with zero fresh observations fails with `no_fresh_observations`. |

**Calibration position (open source requirement).** As of this branch, the
repository contains NO visibility calibration, so optical `visibility_m`
evidence is *unavailable by construction* and the honest negative path is
enforced. When the team supplies a real calibration it must be an explicit
`VisibilityCalibration` value: `calibrationId`, `version`, non-empty
`sourceRef`, non-empty `derivation`, `inputKind: "unitless_quality01"`, ≥ 2
monotone anchors. The calibrated domain is the calibration's documented
ANCHOR SPAN: readings below the first or above the last anchor fail closed
with `calibration_domain_exceeded` — no endpoint clamping, no extrapolation.
The adapter validates structure/determinism only — it
cannot judge physical truth — and records the descriptor **verbatim in every
capture it produced** (`capture.calibration`) for CTO review. The tests use a
clearly-labelled TEST-ONLY fixture calibration to prove the machinery; it is
not shipped as a default.

## 2. Clock semantics (explicit domains, never conflated)

| Domain | Definition | Where it appears |
| --- | --- | --- |
| SOURCE | kernel `simulatorTimeMs` (relative mission ms, 500 ms steps) | preserved verbatim in `capture.observations[*].sourceSimulatorTimeMs` |
| CAPTURE | `captureEpochBaseMs + sourceSimulatorTimeMs` on an anchored, versioned domain (`vorqyn.evidence-clock-mapping/1`) | `sample.sourceTimestampMs`, `capture.window.capturedAtMs` |
| RECEIPT | journal's `receivedAtMs` (fixture epoch + append ordinal), deliberately NOT derived from simulator time | `sample.receivedAtMs`, preserved verbatim |
| DECISION | caller-provided `nowMs`, **required on the capture domain** | verifier `ctx.nowMs` |

Why the capture clock is anchored this way: the verifier compares
`capturedAtMs - sample.sourceTimestampMs` (sample freshness) and
`nowMs - capturedAtMs` (capture freshness) arithmetically, so capture and
source values must share one axis. Naively combining relative source times
with epoch capture times produces false `sample_stale` rejections with ages
of ~1.76 million seconds — the exact bug class reported in PR #55. The
mapping makes the comparison *mean* what the policy intends: "how much
mission time elapsed between the measurement and the capture". For
SYNTHETIC_SIM sources the anchor is the contracts' documented
`FIXTURE_EPOCH_BASE_MS` fixture domain (same base the journal already uses) —
a deterministic fixture axis, **not** a real-UTC claim. A real orchestrator
later re-bases the same algorithm on real epochs without changing the
contract. The mapping is strictly reversible (subtract the recorded base)
and every capture embeds it (`capture.clockMapping`).

`evaluateCapture` refuses a decision clock that precedes the capture
(`decision_clock_domain_mismatch`) so a mis-anchored clock fails loudly
instead of silently corrupting freshness rules. Deliberately NOT done:
widening freshness windows, overwriting simulator time with UTC, or
introducing any chain time (none exists in scope).

## 3. Provenance guarantees

- **Accepted-record integrity:** capture records must BE the journal's
  accepted records — membership by `recordOrdinal` plus canonical-JSON byte
  agreement with the accepted record (missionId, seed, `recordOrdinal` and
  the frozen snapshot's observation bytes). A cloned record with altered
  sensor quality, pose, identity or provenance is rejected
  (`record_not_in_journal` / `record_content_mismatch`); an exact rehydrated
  copy (JSON round-trip) still passes — content, not reference, identity.
- `sourceKind` is always the kernel's own `SYNTHETIC_SIM`, re-validated from
  snapshot provenance (`provenance_mismatch` otherwise). `prepareSubmission`
  takes the origin from the capture — the caller cannot choose it, and the
  verifier's `origin_claim_mismatch` / `origin_not_allowed` rules still
  reject forged claims (tested).
- Preserved per observation: `robotId`, `sensorId`, modality, raw
  `sourceSimulatorTimeMs`, measured `quality01` + the kernel's own
  `qualityUnits`, `opticalVisibilityFactorApplied`, robot fault severity,
  `coverage01`; per capture: `missionId`, `seed`, `scenarioId`, `frameId`,
  `positionUnits`, kernel `simulatorClock` label, clock mapping, calibration
  audit, window bounds, exclusions.
- Digests are computed by the verifier over exactly the samples it judged;
  identical inputs → identical digests, tampered bytes → different digests
  (verifier property, exercised in tests through this adapter's path).

## 4. Authority boundary (hard)

This adapter **prepares evidence**; it never decides anything:

- no `task.evidenceAccepted`, no payment confirmation, no chain receipt, no
  attestation signature, no mission event is produced here (tests assert the
  capture JSON contains none of those concepts);
- the only acceptance logic invoked is Omar's `verifyEvidence`, unchanged;
- a capture cannot bind itself to an assignment: mission/task/version/
  operator are caller-supplied context the verifier checks against the
  mission projection (stale version / wrong operator / wrong mission/task
  all reject — tested).

## 5. Integration interfaces

**Agent A (orchestration / telemetry bridge)** — after appending kernel
snapshots to the guest observation journal:

```ts
const mapping = makeEvidenceClockMapping({
  captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS, seed: journal.seed, scenarioId: "PORT-001",
});
const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: mapping });
```

**Omar (verifier)** — nothing changes on your side. `evaluateCapture`
performs `prepareSubmission → makeEvidenceSubmission → verifyEvidence` with
your original rules; `capturedAtMs` arrives on the capture domain described
above, and `nowMs` is caller-supplied on the same domain.

**Codex (integration harness)** — deterministic one-liner chain per case:
`kernel → journal → buildEvidenceCapture → evaluateCapture`; assertions read
`verdict.accepted` + machine-readable reasons (`visibility_m_below_min`,
`sample_stale`, `sequence_duplicate`, `sensor_not_permitted`, …). The
frozen-install blocker (`ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY` on main) is
upstream and untouched; these tests run under the standard vitest config
once the owner lockfile repair lands, and via an isolated out-of-repo
toolchain today (see the PR description for the exact commands).

## 6. Known limitations (honest)

1. **No visibility calibration exists in the repo** → optical `visibility_m`
   evidence is structured-blocked until the team documents one. The kernel
   would also need a real metres-based source (or an explicitly accepted
   fixture derivation) before optical evidence can be accepted in the
   flagship loop.
2. `sonar_ping` values are the kernel's unitless fixture return quality —
   the kernel emits no sonar distance metric. Any future policy adding a
   metres threshold on `sonar_ping` would be WRONG for this source and is
   exactly the failure the recorded `qualityUnits` audit field exists to
   expose.
3. **Zone/route alignment finding (for Agent A / Omar):** the ROV's
   obstruction-survey route (world `rov` route, x 60→170) is mostly OUTSIDE
   the flagship policy zone (circle c=(0,0) r=80): only the route start
   (~60.8 m) and the first ~34 steps of each pass are inside. A survey
   capture covering the full obstruction grid will correctly reject
   `outside_zone` until the policy zone or the route is aligned by its
   owners. This adapter does not change either.
4. The kernel's global snapshot sequence means a telemetry disconnect
   creates per-robot sequence gaps; the verifier's `maxMissingSamples`
   therefore honestly rejects captures spanning multi-step disconnects
   (tested) — broken continuity is insufficient evidence.

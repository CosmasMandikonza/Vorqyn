# VORQYN lane-2 simulation kernel (`services/simulation/core`)

Standalone deterministic scenario kernel for the VORQYN flagship three-machine
port-inspection scenario. Implements **VQ-08-PREP ([issue #20](https://github.com/CosmasMandikonza/Vorqyn/issues/20))** as a
preparatory foundation for **VQ-08 / issue #9**. Pure ES modules, zero
dependencies, no build step, no I/O in the kernel.

**Status:** internal preparation artifact. It does **not** complete issue #9,
which later requires integration with the authoritative shared mission
contracts (VQ-01 / #2), the mission event stream, persistence and end-to-end
failure semantics.

## What it provides

- Three autonomous machine roles with deterministic waypoint routes:
  `drone-01` (aerial, z = +30 m), `rover-01` (ground, z = 0 waterline datum),
  `rov-01` (underwater, z = −8 m).
- Explicit **local metre-scale ENU coordinates** (`ENU_PORT_LOCAL`): +x east,
  +y north, +z up, origin at the south-west quay corner at the waterline
  datum; underwater poses use negative z.
- Seeded simulation state and **reproducible fixed time-stepping**:
  `simulatorTimeMs` advances by exactly `stepMs = 500` integer milliseconds
  per step and is fully independent of wall clocks, service clocks and any
  blockchain clock.
- Controlled movement (speed-clamped waypoint following, no teleport) and
  **task-coverage observations** measured as deterministic grid occupancy
  over each role's task region.
- Explicit sensor capabilities with **measured observation quality**:
  per-sample `quality01` from documented fixture baselines and bounded seeded
  noise (drone optical 0.92, rover optical 0.88, ROV optical 0.71 turbid-water
  fixture, ROV sonar 0.63 with an independent range-ring coverage model).
- An underwater **low-visibility fault that genuinely degrades optical
  measurements** (severe factor 0.12 → measured quality ≈ 0.085, delta ≈ 0.62
  versus a 0.71 baseline; far outside the ±0.02 noise band). Sonar is a
  separate modality: its measurements and coverage are untouched by the
  optical fault and are **not** automatically policy-acceptable.
- Pause / resume / stop, deterministic replay, and **idempotent fault
  commands** (`idempotencyKey`-scoped, exactly-once effect).
- Honest provenance: every observation is labelled
  `sourceKind: "SYNTHETIC_SIM"`; stale, paused and disconnected states are
  explicit fields, and frozen states carry `measured: null` rather than fake
  fresh readings. The kernel structurally cannot emit chain events,
  transaction confirmations or any non-simulator clock.

Every numeric sensor value in `scenario.mjs` is an **explicit internal
fixture** chosen for testability — a documented synthetic test model, not
invented physical truth and not a measurement of any real harbour.

## Files

| File | Responsibility |
| --- | --- |
| `rng.mjs` | SplitMix32 seeded PRNG; per-sensor noise-stream derivation |
| `enu.mjs` | ENU frame primitives; no-teleport `stepToward`; plan-view grids |
| `scenario.mjs` | `PORT-LOCAL-001` fixture: roles, routes, sensors, fault model, demo thresholds |
| `kernel.mjs` | The kernel: stepping, commands, fault lifecycle, observations, replay |
| `sample.mjs` | Deterministic sample-run generator (`buildSampleRun()` + CLI) |
| `fixtures/sample-run.json` | Committed golden sample output (52 observations, seed 20261107) |
| `*.test.mjs` | Dependency-free `node:test` suites (45 tests) |

## Running

```bash
# Full test suite (from repo root; Node >= 22, no install needed)
node --test services/simulation/core/*.test.mjs

# Deterministic sample output (stdout)
node services/simulation/core/sample.mjs

# Regenerate the committed golden fixture after a reviewed, intentional change
node services/simulation/core/sample.mjs > services/simulation/core/fixtures/sample-run.json
```

Latest observed run (see PR for full output): **45 tests, 45 pass, 0 fail**;
the sample generator is byte-identical across separate processes
(SHA-256 `7bbb8190b8ad374da378d933cd0bf1d419e128b542c0299fbadf5911f2e6e548`).

## Kernel API (internal — not a shared contract)

```js
import { createScenarioKernel, replayScenario } from "./kernel.mjs";

const kernel = createScenarioKernel({ seed: 20261107 });
kernel.step(20); // advance exactly 20 × 500ms of simulator time
kernel.issueCommand({
  type: "injectOpticalVisibilityFault",
  robotId: "rov-01",          // underwater role only
  severity: "severe",         // fixture: "moderate" | "severe"
  durationMs: 9000,           // bounded: 1000..120000
  idempotencyKey: "unique-command-key",
});
kernel.step(18);
kernel.getState();            // frozen full-state snapshot
kernel.getObservationLog();   // frozen per-step observation snapshots
kernel.getRunTrace();         // replay tape (steps + accepted commands)

const replayed = replayScenario({ seed: 20261107, trace: kernel.getRunTrace() });
// replayed.getObservationLog() deep-equals the original log
```

Commands (all require a non-empty `idempotencyKey ≤ 128` chars; strict field
schemas — unknown fields, e.g. a forged `sourceKind`, are rejected):

| Command | Effect |
| --- | --- |
| `pause` / `resume` / `stop` | lifecycle; stop is terminal |
| `injectOpticalVisibilityFault` | ROV role only; exactly-once per key; one active fault per robot |
| `clearOpticalVisibilityFault` | ROV role only; idempotent no-op when clear |
| `disconnectTelemetry` / `reconnectTelemetry` | per-robot link state |

Invalid input never throws: `issueCommand` returns
`{ ok: false, failure: { code, message } }` with codes `unknown_command`,
`malformed_command`, `invalid_command_fields`, `invalid_idempotency_key`,
`unknown_robot`, `fault_target_invalid`, `invalid_fault_severity`,
`invalid_fault_duration`, `fault_already_active`, `invalid_transition`.
Stepping a stopped kernel throws the typed `KernelStoppedError`.

### Observation snapshot (abbreviated)

```js
{
  sequence: 19,               // global, monotonic, dense from 1
  simulatorTimeMs: 9500,      // the ONLY clock in the kernel
  stepIndex: 19,
  kernelState: "running" | "paused" | "stopped",
  appliedStepMs: 500,         // 0 while paused
  robots: [{
    robotId: "rov-01", role: "underwater-rov",
    pose: { x, y, z },        // metres, ENU_PORT_LOCAL, rounded to 1e-6
    linkState: "connected" | "disconnected",
    fresh: true,              // false while paused/disconnected
    staleness: "none" | "kernel-paused" | "link-disconnected",
    staleSinceSimMs: null,    // last fresh simulator time when not fresh
    activeOpticalFault: { faultId, kind, severity, startedAtSimMs, expiresAtSimMs } | null,
    sensors: [{
      sensorId: "rov-01-optical", kind: "optical",
      measured: {
        quality01: 0.0852,                       // the MEASURED value
        opticalVisibilityFactorApplied: 0.12,    // fixture factor in effect
      },
      coverage: { modelCellsVisited, modelCellsTotal, coverage01 },
    }],
  }],
  provenance: { sourceKind: "SYNTHETIC_SIM", scenarioId, seed, frameId, positionUnits, simulatorClock },
}
```

While paused or disconnected, `measured` is `null` (no fabricated readings)
and poses freeze at the last authoritative state. Reconnection resumes from
the frozen pose — the kernel never invents where a robot "would have been".

### Fault semantics (fixture `OPTICAL_VISIBILITY_FAULT`)

- Deterministic window: a step's measurements are faulted while the step's
  starting simulator time is `< startedAtSimMs + durationMs`; expiry is a
  pure function of simulator time.
- Idempotency: a retried `injectOpticalVisibilityFault` with the same key
  returns `{ ok: true, duplicate: true, original }` and changes nothing; a
  *different* key while a fault is active fails `fault_already_active` (no
  stacking). Keys are consumed permanently for the kernel's lifetime.
- Effect is in the measurements: optical `quality01` is multiplied by the
  severity's `opticalQualityFactor` (moderate 0.35 / severe 0.12) before
  clamping; sonar quality and both coverage models are untouched.

## Deliberate boundaries

- **No public contract definitions.** The observation snapshots above are
  internal, model-independent views. This module intentionally does NOT
  define `MissionEvent`, `MissionTask`, `ChainEvent`, evidence, payout or
  assignment types — that is VQ-01 (#2)'s exclusive authority, and importing
  from `packages/contracts/**` is forbidden here.
- **No policy authority.** The kernel emits measurements only. It never
  accepts/rejects evidence and contains no verdict fields. The demo
  thresholds exported from `scenario.mjs` exist so *tests* can demonstrate
  insufficiency detection; the authoritative evaluator is the future VQ-10
  verifier.
- **No external control API.** Robot motion follows the fixture routes;
  user-defined waypoint/task commands need the future mission contracts
  (VQ-08) and are out of scope here.
- **Sonar ≠ acceptance.** Sonar is a separate capability with its own
  coverage model and measured quality (~0.63 fixture). Tests demonstrate the
  same sonar measurement passing a mapping bar (0.5) and failing a strict
  structural bar (0.8) — acceptance is measurement + threshold, never the
  capability flag.

## Future adapter boundary (integration note for issue #9 / VQ-08)

When VQ-01 (#2) freezes the shared contracts, integration should add an
adapter (outside this directory, e.g. `services/simulation/adapter.ts`) that:

1. Subscribes to kernel observation snapshots (`sequence`, `simulatorTimeMs`,
   poses, per-sensor measurements) and maps them onto the authoritative
   `TelemetrySample` / `MissionEvent` shapes — preserving `sourceKind`
   (`SYNTHETIC_SIM`), `frameId`, units, sequence and simulator time verbatim.
2. Keeps this kernel as the single **simulation-clock authority**; the
   service supplies its own event receipt times and the chain supplies
   confirmation times. The kernel must never be fed wall or chain time.
3. Maps `injectOpticalVisibilityFault` to the scoped demo fault endpoint
   (`POST /tasks/:id/faults` per docs/ARCHITECTURE.md §7), reusing the
   idempotency key as the command idempotency key.
4. Hands **measurements** (never kernel verdicts) to the external policy
   evaluator, which owns acceptance decisions and rule IDs.
5. Persists `getRunTrace()` output so a mission can be deterministically
   replayed; stale/disconnected markers map to the UI's honest
   "telemetry unavailable" states.

Nothing in this directory needs to change for that integration except
reviewed, versioned updates.

## Known limitations

- Synthetic fidelity only: fixture kinematics (constant speeds, sharp
  waypoint turns, no inertia/current/tide models). No SITL/MAVLink — that is
  VQ-09's genuine-telemetry adapter lane, with this kernel clearly labelled
  `SYNTHETIC_SIM`.
- Observation log grows unboundedly in memory; a production service streams
  or windows it. Replay re-executes the full trace (no snapshot/checkpoint
  fast-forward yet).
- The fault model is a bounded visibility degradation; it does not model
  sonar noise loss, equipment failure or cascading multi-sensor faults.
- Coverage is plan-view grid occupancy; it is not photogrammetric or
  bathymetric reconstruction.
- Tests were executed on Node v24.20.0 (Windows, Git Bash); the repo pins
  Node 22.21.1 (`.nvmrc`). Only stable `node:test` / `node:assert/strict`
  APIs are used, and all arithmetic is engine-independent IEEE-754, so the
  suite is expected to pass identically on Node 22 (CI will confirm).

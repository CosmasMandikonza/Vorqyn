# Issue #16 cross-system development QA gate

This gate exercises real existing code and prepares connections to owners' pending modules. It is not a deployment report, chain run or completion claim. No root dependency, lockfile, CI, service, contract or mission-world implementation is changed.

Use the repository's pinned Node/pnpm, install the frozen lockfile, commit intended changes, then:

```bash
node scripts/integration/gate.mjs --out ../integration-gate-01
```

Use a new directory outside the checkout. Exit **0 = every exercised/required gate PASS; 1 = FAIL; 2 = BLOCKED/incomplete**. Read `report.json` even after nonzero exit. The runner first performs a frozen installation and refuses to use leftover dependencies after any installation failure. It rejects dirty trees unless explicitly diagnosing with `--allow-dirty`, records harness/target SHAs and dirtiness, invokes the locked web Vitest dependency, rejects zero-test or skipped/todo runs, and records commands, output and machine reports. It never fetches/merges another branch, signs or sends a transaction. Existing-boundary tests also run automatically under the ordinary `pnpm test` CI job.

`existing-boundaries` executes actual simulator → journal → canonical telemetry and actual merged verifier calls. It also exercises shared reducer semantics using existing **CONTRACT FIXTURES ONLY**. Fixture signatures are not observed RPC receipts. A passing negative test proves rejection, not a successful verified recovery. Current metric/clock incompatibilities remain explicit BLOCKED checks even though safe rejection tests pass. When the owning adapters change, independently review and replace the current-boundary expectations with source-backed acceptance; never rename unitless quality to metres or silently relax thresholds/time windows.

## Independent checks while installation is blocked

These commands use Node built-ins and checked-in source/data; they do not invoke workspace packages, the browser, a model provider or a chain RPC:

```bash
node --test services/simulation/core/*.test.mjs
node --test services/simulation/integration/*.test.mjs
node --test scripts/integration/tooling.test.mjs
```

The tooling suite deliberately supplies a **failing installation fixture only** and proves no dependent product checks can run. It validates copies of the historical 32-state evidence packet, refusing false source/run/viewport metadata, missing images and a hash-matching desktop PNG substituted for mobile. Its PASS means the QA tools reject invalid proof; the historical eight camera layout failures remain FAIL. Originals are not edited. No mocked successful install or fabricated product adapter is supplied. The full integration runner also requires these tool checks **after** a real successful frozen install; it does not waive that prerequisite.

## Pending connections

The runner checks real module presence and runs separate `*.acceptance.ts` suites when available; absent modules are BLOCKED, not skipped Vitest cases. These acceptance files are deliberately outside ordinary `*.test.tsx` discovery because pending packages do not exist on main. They become mandatory in the integration runner as those modules merge. Keep the ordinary CI result distinct from the integration report.

- **#50 chain client:** real lifecycle functions, RPC test doubles for unseen signature, direct finalized status and outage monotonicity; expiry conversion compared to the merged verifier. Test replies are explicitly not chain receipts or funded instructions.
- **#51 recovery:** real gate/prompt/proposal functions fed QA offers and real verifier failure reasons; top-up arithmetic, malformed quote totality, lossless prompt JSON, cross-mission attempt ledger isolation and stale unsigned intents. Scripted failure client is labelled; no live AI claim.
- **#53 economic handoff:** actual read-only owner projection; observation records and foreign events cannot display confirmed stages; verified-only task cannot claim a payout was initiated before a submission exists. Existing contract fixtures test presentation semantics only.
- **Agent A orchestration:** API not yet merged. `apps/web/tests/cross-system/orchestrator-port.ts` defines a **test-driver interface, not a new production contract/state model**. Bind it to the actual implementation using `--orchestration-driver /absolute/path/to/driver.ts`. The driver must be committed with bytes matching the recorded harness or target SHA; the runner records its path/hash/commit and blocks untracked or changed driver files. This proves source attribution only, not authorization. The driver must map the actual single-event `append(missionId, event, expectedLastSequence)`/read/restart/untrusted observation ingestion to the real store/service, use fresh isolated durable backing and dispose only its own test data. No in-memory substitute or fabricated authority adapter is supplied here. Tests require atomic concurrent CAS, mission isolation, exact idempotency, tampered duplicates, command reuse, sequence gaps, restart/reducer replay and observation-path rejection of canonical verdict/payment/confirmation injection. If real durability or an untrusted authority boundary is absent, leave that connection BLOCKED; do not write a fake adapter to satisfy assertions.

A read-only diagnostic against an owner's actual checked-out PR source is supported without copying its implementation into this branch:

```bash
node scripts/integration/gate.mjs --component recovery \
  --target-root /absolute/path/to/reviewed-pr-checkout --out ../recovery-check-01
```

Use `chain-client` or `handoff` for those components. The target must be a Git checkout. Reports label this as candidate evidence, not merged-main integration. Other component checks remain NOT RUN and overall status cannot certify the full flow. The harness resolves shared contracts from this QA checkout; record both SHAs and do not equate this with the target's own full workspace CI or local-validator tests. Inspect target code/dependency changes before running. No target files are modified by the runner.

`--component evidence-adapter` additionally runs the actual owner capture/clock/calibration exports: real sonar fidelity and deterministic mapping, unavailable optical calibration, partial-domain rejection, and rejection of records whose measurement/pose/mission/seed/ordinal bytes are absent from the supplied accepted journal. The partial calibration is deliberately artificial QA input; it is never approved physical evidence. Missing merged adapters remain BLOCKED. A read-only candidate result cannot clear merged-main metric/clock blockers.

To execute the owner's own component tests without copying their implementation, after the harness frozen install:

```bash
INTEGRATION_TARGET_ROOT=/absolute/path/to/reviewed-pr-checkout \
INTEGRATION_OWNER_SUITE=mission-orchestration \
  pnpm --filter @vorqyn/web exec vitest run \
  --config ../../scripts/integration/owner-vitest.config.mts \
  --reporter=json --outputFile=/absolute/new/output.json
```

Use `evidence-adapter` for that owner suite. Record both clean checkout SHAs and the exact command with the machine result. The config executes the actual target test files with this installed harness's Vitest and shared contracts, in Node. This is a compatibility/component diagnostic, not that target's frozen installation/full workspace CI. Contract fixture signatures remain fixtures; local file replay is not authenticated ingestion, cloud durability or a live chain workflow. No orchestration driver is synthesized by this config. Require positive test counts and zero failures/skips/todos before describing these component checks as PASS.

## Browser regression

After a production build, run the existing strict suite plus the added full-row tests:

```bash
RELEASE_ARTIFACT_DIR="$PWD/../integration-browser-01" \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @vorqyn/web exec playwright test \
  --config ../../scripts/release/judge-qa.config.mjs
node scripts/release/validate-judge-qa.mjs --dir ../integration-browser-01
node scripts/release/audit-camera-captures.mjs --dir ../integration-browser-01
node scripts/integration/validate-camera-evidence.mjs --dir ../integration-browser-01
```

The original 26 cases remain unchanged. Eight added cases capture four actual camera states at each of 320/390/1024/1440 in both themes, asserting **all six controls** after station changes, both edges within the frame/viewport and touch-target dimensions. Mobile cases use actual touch-enabled contexts and natural taps; desktop uses ordinary clicks. Every PNG is genuine viewport size with IHDR/hash/options/commit/run/theme/DOM sidecars in `integration-camera/`. Soft layout failures preserve all 32 captures; they still fail their tests. Do not treat document width alone or a focused/scrolled button as proof the full row fits. Existing tests retain no-WebGL, keyboard, source/API fault/replay, header/zoom and navigation checks. Keep native browser zoom distinct from CSS zoom.

See the source-pinned [integration blocker report](../../docs/evidence/integration16/README.md) for actual results. Stop for independent review; no merge or parent-issue closure.

/** Existing-system integration, not a synthetic substitute for an authorized mission loop. */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyEvent,
  buildPort001Script,
  canonicalJson,
  initMissionProjection,
  makeTelemetrySample,
  runEventScript,
  validateMissionEvent,
} from "@vorqyn/contracts";
import { executeDemoSimulation } from "@/lib/demo-simulation/execute";
import { deriveGuestTrace } from "@/lib/simulation-journal/trace-execute";
import {
  appendKernelSnapshot,
  canonicalJournal,
  replayJournal,
} from "../../../../services/mission/simulation/observation-journal";
import { normalizeSnapshotToTelemetry } from "../../../../services/mission/simulation/telemetry-bridge";
import {
  POLICY_SEA_OBSTRUCTION_1,
  verifyEvidence,
} from "../../../../services/verifier/src/index";
import {
  currentBoundaryFindings,
  MISSION,
  OPERATIONS,
  scenario,
  SEED,
  TASK,
  unwrap,
  verifierInput,
} from "./scenario";

const fixtureEvents = () => buildPort001Script(); // CONTRACT FIXTURE ONLY; embedded signatures are not observed transactions.
afterAll(() => {
  if (process.env.INTEGRATION_ARTIFACT_DIR) {
    const out = resolve(process.env.INTEGRATION_ARTIFACT_DIR);
    mkdirSync(out, { recursive: true });
    writeFileSync(
      resolve(out, "boundary-findings.json"),
      JSON.stringify(currentBoundaryFindings(), null, 2) + "\n",
    );
  }
});

describe("real simulator → journal → shared contracts → merged verifier", () => {
  it("preserves measured optical failure and independent sonar at the same seed/clock", () => {
    const faulted = scenario();
    const control = executeDemoSimulation({
      seed: SEED,
      operations: [{ op: "step", count: 8 }],
    });
    const a = faulted.execution.snapshots[2]!.robots.find(
      (r) => r.robotId === "rov-01",
    )!;
    const b = control.snapshots[2]!.robots.find((r) => r.robotId === "rov-01")!;
    const measure = (robot: typeof a, kind: string) =>
      robot.sensors.find((s) => s.kind === kind)!.measured!;
    expect(measure(a, "optical").quality01).toBeLessThan(
      measure(b, "optical").quality01 * 0.2,
    );
    expect(measure(a, "sonar")).toEqual(measure(b, "sonar"));
    const sample = faulted.journal.records[2]!.telemetry.find(
      (t) => t.sample.robotId === "rov-01",
    )!.sample;
    expect(sample.quality.status).toBe("degraded");
    expect(sample.qualityMetric).toEqual({
      kind: a.sensors[0]!.sensorId,
      value: measure(a, "optical").quality01,
    });
    expect(unwrap(makeTelemetrySample(sample))).toEqual(sample);
    expect(sample.sourceKind).toBe("SYNTHETIC_SIM");
  });
  it("re-executes operations and replays serialized journal without changing observations or fault transitions", () => {
    const a = scenario(),
      b = scenario();
    expect(canonicalJournal(a.journal)).toBe(canonicalJournal(b.journal));
    const replay = unwrap(replayJournal(JSON.parse(JSON.stringify(a.journal))));
    expect(replay).toEqual(unwrap(replayJournal(b.journal)));
    expect(replay.faultTimeline.map((f) => f.phase)).toEqual([
      "fault-started",
      "fault-ended",
    ]);
    expect(replay.samples).toEqual(
      a.journal.records.flatMap((r) => r.telemetry.map((t) => t.sample)),
    );
  });
  it("guest trace paging recombines to the exact journal-backed unpaged records", () => {
    const full = scenario().trace;
    const pages = [];
    let afterSequence = 0;
    for (;;) {
      const page = deriveGuestTrace({
        seed: SEED,
        operations: OPERATIONS,
        cursor: { afterSequence, limit: 3 },
      }).response;
      expect(page.clockDomains.chain).toBeNull();
      pages.push(...page.trace.records);
      if (!page.paging.hasMore) break;
      afterSequence = page.paging.nextAfterSequence!;
    }
    expect(pages).toEqual(full.trace.records);
    expect(canonicalJson(scenario().trace)).toBe(canonicalJson(full));
  });
  it("isolates different seed streams, audits a cross-stream append, and keeps accepted state unchanged", () => {
    const a = scenario(),
      b = scenario(SEED + 1);
    const before = canonicalJournal(a.journal);
    const rejected = appendKernelSnapshot(
      a.journal,
      b.execution.snapshots.at(-1)!,
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok)
      expect(rejected.error.code).toBe("cross_stream_contamination");
    expect(rejected.journal.records).toEqual(a.journal.records);
    expect(canonicalJournal(a.journal)).toBe(before);
    expect(new Set(b.samples.map((s) => s.missionId))).toEqual(
      new Set([`guest-port-${SEED + 1}`]),
    );
  });
  it("duplicate delivery cannot move a contract track or append a second record", () => {
    const { journal } = scenario();
    const result = appendKernelSnapshot(
      journal,
      journal.records.at(-1)!.snapshot,
    );
    expect(result.ok).toBe(false);
    expect(result.journal.records).toEqual(journal.records);
    expect(unwrap(replayJournal(result.journal)).telemetryStore).toEqual(
      unwrap(replayJournal(journal)).telemetryStore,
    );
  });
  it.each([
    ["sourceKind", "LIVE_SITL"],
    ["frameId", "ENU_WRONG_LOCAL"],
    ["positionUnits", "centimetres"],
  ])(
    "rejects forged kernel provenance %s before telemetry reaches contracts",
    (field, value) => {
      const snapshot = structuredClone(scenario().execution.snapshots[0]!);
      Object.assign(snapshot.provenance, { [field]: value });
      expect(
        normalizeSnapshotToTelemetry(snapshot, {
          missionId: MISSION,
          receivedAtMs: 1762000000000,
        }).ok,
      ).toBe(false);
    },
  );
  it("preserves source/simulator versus receipt clocks without inventing chain time", () => {
    const { journal, trace } = scenario();
    for (const [index, record] of journal.records.entries()) {
      expect(record.receivedAtMs).toBe(
        journal.fixtureReceiptEpochBaseMs + index,
      );
      for (const item of record.telemetry) {
        expect(item.sample.sourceTimestampMs).toBe(
          record.snapshot.simulatorTimeMs,
        );
        expect(item.sample.receivedAtMs).toBe(record.receivedAtMs);
        expect(item.sample).not.toHaveProperty("chainTimeMs");
      }
    }
    expect(trace.clockDomains.chain).toBeNull();
  });
  it("unconverted real kernel evidence is rejected by the merged verifier instead of silently receiving invented visibility metres", () => {
    const { submission, context } = verifierInput();
    const before = canonicalJson(submission);
    const a = unwrap(
      verifyEvidence(submission, POLICY_SEA_OBSTRUCTION_1, context),
    );
    expect(a.verdict.accepted).toBe(false);
    expect(a.verdict.reasons).toContain("metric_missing:visibility_m");
    expect(a.verdict.reasons.some((r) => r.startsWith("sample_stale:"))).toBe(
      true,
    );
    expect(a).toEqual(
      unwrap(verifyEvidence(submission, POLICY_SEA_OBSTRUCTION_1, context)),
    );
    expect(canonicalJson(submission)).toBe(before);
  });
  it("renaming the submitted sensor to sonar cannot turn the optical-only bridge metric into sonar evidence", () => {
    const { submission, context } = verifierInput("sonar");
    const result = unwrap(
      verifyEvidence(submission, POLICY_SEA_OBSTRUCTION_1, context),
    );
    expect(result.verdict.accepted).toBe(false);
    expect(result.verdict.reasons).toContain(
      "sensor_backing_missing:sonar:kind=sonar_ping",
    );
  });
  it.each([
    ["expectedMissionId", "wrong-mission", "mission_mismatch:"],
    ["expectedTaskId", "wrong-task", "task_mismatch:"],
    ["currentAssignmentVersion", 2, "stale_assignment_version:"],
    ["expectedOperatorId", "wrong-operator", "operator_mismatch:"],
  ])(
    "verifier independently binds authority context %s",
    (key, value, reason) => {
      const { submission, context } = verifierInput();
      const result = unwrap(
        verifyEvidence(submission, POLICY_SEA_OBSTRUCTION_1, {
          ...context,
          [key]: value,
        }),
      );
      expect(result.verdict.accepted).toBe(false);
      expect(
        result.verdict.reasons.some((r) => r.startsWith(String(reason))),
      ).toBe(true);
    },
  );
  it("cross-mission samples and synthetic-to-SITL claims are rejected, not relabelled", () => {
    const { submission, context } = verifierInput();
    const forged = {
      ...submission,
      simulatorSource: "LIVE_SITL" as const,
      samples: scenario(SEED + 1).samples,
    };
    const result = unwrap(
      verifyEvidence(forged, POLICY_SEA_OBSTRUCTION_1, context),
    );
    expect(result.verdict.accepted).toBe(false);
    expect(
      result.verdict.reasons.some((r) => r.startsWith("cross_mission_sample:")),
    ).toBe(true);
    expect(
      result.verdict.reasons.some((r) =>
        r.startsWith("origin_claim_mismatch:"),
      ),
    ).toBe(true);
  });
  it("observations never become canonical evidence acceptance, payment or chain events", () => {
    const { journal, trace } = scenario();
    for (const record of journal.records)
      expect(validateMissionEvent(record).ok).toBe(false);
    expect(validateMissionEvent(trace).ok).toBe(false);
    for (const sample of scenario().samples) {
      expect(sample).not.toHaveProperty("taskId");
      expect(sample).not.toHaveProperty("assignmentVersion");
    }
    expect(Object.keys(trace)).not.toEqual(
      expect.arrayContaining(["verdict", "transactionSignature"]),
    );
  });
});

describe("shared reducer guards — CONTRACT FIXTURES ONLY, no observed chain receipts", () => {
  it("a measurement envelope cannot mutate the canonical projection", () => {
    const state = unwrap(initMissionProjection(fixtureEvents()[0]));
    const before = canonicalJson(state);
    expect(applyEvent(state, scenario().journal.records[0]).ok).toBe(false);
    expect(canonicalJson(state)).toBe(before);
  });
  it("payment without a prior confirmed payout fails even after fixture evidence acceptance", () => {
    const events = fixtureEvents();
    const accepted = events.findIndex(
      (e) => e.kind === "task.evidenceAccepted",
    );
    const ready = runEventScript(events.slice(0, accepted + 1));
    expect(ready.ok).toBe(true);
    if (!ready.ok) throw new Error(ready.error.message);
    const payment = events.find((e) => e.kind === "task.paymentConfirmed")!;
    const attempt = { ...payment, sequence: accepted + 2 };
    const before = canonicalJson(ready.state);
    const result = applyEvent(ready.state, attempt);
    expect(result.ok).toBe(false);
    expect(canonicalJson(ready.state)).toBe(before);
    expect(ready.state.tasks[TASK]!.status).toBe("verified");
  });
  it("replayed fixture event is idempotent; tampered duplicates and other mission events are refused", () => {
    const events = fixtureEvents();
    const state = unwrap(initMissionProjection(events[0]));
    const exact = applyEvent(state, events[0]);
    expect(exact.ok && exact.duplicate).toBe(true);
    expect(
      applyEvent(state, {
        ...events[0],
        observedAtMs: events[0]!.observedAtMs + 1,
      }).ok,
    ).toBe(false);
    expect(
      applyEvent(state, { ...events[1], missionId: "different-mission" }).ok,
    ).toBe(false);
  });
});

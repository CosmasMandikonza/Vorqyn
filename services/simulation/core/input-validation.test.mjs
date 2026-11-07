/**
 * Input validation tests — VQ-08-PREP (#20) mandatory adversarial cases:
 * - Invalid robot, fault target, severity, duration, mission-state
 *   transition, command shape or forged field returns a clear typed
 *   failure (never a silent success, never a throw to the caller).
 * - Unknown command types and malformed commands are rejected.
 * - Kernel construction validates its seed; step() validates its count.
 *
 * Run: node --test services/simulation/core/input-validation.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioKernel, KernelStoppedError } from "./kernel.mjs";

const SEED = 31337;

function injectFault(overrides = {}, key = "validation-key") {
  return {
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 60000,
    idempotencyKey: key,
    ...overrides,
  };
}

test("unknown robot ids are rejected with a clear failure", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  const cases = [
    { type: "injectOpticalVisibilityFault", robotId: "rov-99", severity: "severe", durationMs: 60000, idempotencyKey: "k1" },
    { type: "disconnectTelemetry", robotId: "does-not-exist", idempotencyKey: "k2" },
    { type: "clearOpticalVisibilityFault", robotId: "", idempotencyKey: "k3" },
  ];
  for (const command of cases) {
    const outcome = kernel.issueCommand(command);
    assert.equal(outcome.ok, false, `rejected: ${JSON.stringify(command)}`);
    assert.equal(outcome.failure.code, "unknown_robot");
    assert.match(outcome.failure.message, /robotId/i);
    assert.equal(typeof outcome.failure.message, "string");
  }

  // A MISSING robotId is caught one step earlier, by field validation.
  const missingId = kernel.issueCommand({ type: "reconnectTelemetry", idempotencyKey: "k4" });
  assert.equal(missingId.ok, false);
  assert.equal(missingId.failure.code, "invalid_command_fields");
});

test("invalid fault target, severity and duration each return distinct typed failures", () => {
  const kernel = createScenarioKernel({ seed: SEED });

  const onDrone = kernel.issueCommand(injectFault({ robotId: "drone-01" }, "t1"));
  assert.equal(onDrone.ok, false);
  assert.equal(onDrone.failure.code, "fault_target_invalid");

  const badSeverity = kernel.issueCommand(injectFault({ severity: "catastrophic" }, "t2"));
  assert.equal(badSeverity.ok, false);
  assert.equal(badSeverity.failure.code, "invalid_fault_severity");

  const nonInteger = kernel.issueCommand(injectFault({ durationMs: 1234.5 }, "t3"));
  assert.equal(nonInteger.ok, false);
  assert.equal(nonInteger.failure.code, "invalid_fault_duration");

  const negative = kernel.issueCommand(injectFault({ durationMs: -5000 }, "t4"));
  assert.equal(negative.ok, false);
  assert.equal(negative.failure.code, "invalid_fault_duration");
});

test("invalid lifecycle transitions return clear failures and change nothing", () => {
  const kernel = createScenarioKernel({ seed: SEED });

  const resumeWhileRunning = kernel.issueCommand({ type: "resume", idempotencyKey: "r1" });
  assert.equal(resumeWhileRunning.ok, false);
  assert.equal(resumeWhileRunning.failure.code, "invalid_transition");

  const stateBefore = kernel.getState();
  kernel.step(3);
  kernel.issueCommand({ type: "pause", idempotencyKey: "p1" });

  const pauseWhilePaused = kernel.issueCommand({ type: "pause", idempotencyKey: "p2" });
  assert.equal(pauseWhilePaused.ok, false);
  assert.equal(pauseWhilePaused.failure.code, "invalid_transition");

  const faultWhilePaused = kernel.issueCommand(injectFault({}, "p3"));
  assert.equal(faultWhilePaused.ok, false);
  assert.equal(faultWhilePaused.failure.code, "invalid_transition");

  kernel.issueCommand({ type: "stop", idempotencyKey: "s1" });
  const stopTwice = kernel.issueCommand({ type: "stop", idempotencyKey: "s2" });
  assert.equal(stopTwice.ok, false);
  assert.equal(stopTwice.failure.code, "invalid_transition");

  const pauseAfterStop = kernel.issueCommand({ type: "pause", idempotencyKey: "s3" });
  assert.equal(pauseAfterStop.ok, false);
  assert.equal(pauseAfterStop.failure.code, "invalid_transition");

  // Invalid transitions wrote nothing: audit log holds exactly the accepted
  // commands (pause p1, stop s1), and the sequence of world state is intact.
  const accepted = kernel.getCommandAuditLog().map((entry) => entry.command.type);
  assert.deepEqual(accepted, ["pause", "stop"]);
  assert.ok(kernel.getState().stepIndex >= stateBefore.stepIndex);
});

test("unknown command types, malformed commands and forged fields are rejected", () => {
  const kernel = createScenarioKernel({ seed: SEED });

  const unknownType = kernel.issueCommand({ type: "selfDestruct", idempotencyKey: "u1" });
  assert.equal(unknownType.ok, false);
  assert.equal(unknownType.failure.code, "unknown_command");

  const nullCommand = kernel.issueCommand(null);
  assert.equal(nullCommand.ok, false);
  assert.equal(nullCommand.failure.code, "malformed_command");

  const arrayCommand = kernel.issueCommand(["pause"]);
  assert.equal(arrayCommand.ok, false);
  assert.equal(arrayCommand.failure.code, "malformed_command");

  const missingKey = kernel.issueCommand({ type: "pause" });
  assert.equal(missingKey.ok, false);
  assert.equal(missingKey.failure.code, "invalid_command_fields");

  const emptyKey = kernel.issueCommand({ type: "pause", idempotencyKey: "" });
  assert.equal(emptyKey.ok, false);
  assert.equal(emptyKey.failure.code, "invalid_idempotency_key");

  // Attempting to forge a provenance label through a command is impossible:
  // sourceKind is not a field of any command schema.
  const forgedSource = kernel.issueCommand({ type: "pause", idempotencyKey: "forge", sourceKind: "GENUINE_SITL" });
  assert.equal(forgedSource.ok, false);
  assert.equal(forgedSource.failure.code, "invalid_command_fields");
  assert.match(forgedSource.failure.message, /unexpected field: sourceKind/);
});

test("kernel construction validates the seed; step() validates the count", () => {
  for (const badSeed of [-1, 1.5, 4294967296, "7", NaN]) {
    assert.throws(() => createScenarioKernel({ seed: badSeed }), RangeError, `seed ${badSeed} must be rejected`);
  }
  const kernel = createScenarioKernel({ seed: SEED });
  for (const badCount of [0, -1, 2.5, NaN]) {
    assert.throws(() => kernel.step(badCount), RangeError, `step count ${badCount} must be rejected`);
  }
});

test("stepping a stopped kernel throws the typed stopped error and freezes state", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(4);
  const before = kernel.getState();
  kernel.issueCommand({ type: "stop", idempotencyKey: "stop-1" });

  assert.throws(() => kernel.step(), KernelStoppedError);
  assert.throws(() => kernel.step(5), KernelStoppedError);
  assert.equal(kernel.getState().simulatorTimeMs, before.simulatorTimeMs + 0, "no time passes after stop");
  assert.deepEqual(kernel.getState().robots.map((r) => r.pose), before.robots.map((r) => r.pose), "poses frozen after stop");
});

test("successful commands land in the audit log with their step index and outcome", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(2);
  const injected = kernel.issueCommand(injectFault({}, "audit-key"));
  assert.equal(injected.ok, true);
  const audit = kernel.getCommandAuditLog();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].stepIndex, 2);
  assert.equal(audit[0].simulatorTimeMs, 1000);
  assert.equal(audit[0].command.idempotencyKey, "audit-key");
  assert.equal(audit[0].result.fault.severity, "severe");
});

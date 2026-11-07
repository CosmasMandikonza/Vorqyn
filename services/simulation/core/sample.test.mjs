/**
 * Sample fixture tests — VQ-08-PREP (#20):
 * - buildSampleRun() is deterministic: two invocations are identical, and
 *   the regenerated document deep-equals the committed golden fixture
 *   (fixtures/sample-run.json). If this test fails, sample output drifted
 *   — regenerate the fixture ONLY with a reviewed, intentional change.
 * - The sample demonstrates the mandatory semantics: measured fault delta,
 *   idempotent duplicate fault attempt, honest rejection failures.
 *
 * Run: node --test services/simulation/core/sample.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildSampleRun } from "./sample.mjs";

const fixturePath = fileURLToPath(new URL("./fixtures/sample-run.json", import.meta.url));

test("buildSampleRun is deterministic across invocations", () => {
  const a = buildSampleRun();
  const b = buildSampleRun();
  assert.deepEqual(b, a);
});

test("regenerated sample deep-equals the committed golden fixture", () => {
  const committed = JSON.parse(readFileSync(fixturePath, "utf8"));
  const regenerated = buildSampleRun();
  assert.deepEqual(regenerated, committed);
});

test("sample demonstrates a measured optical fault delta far above noise", () => {
  const sample = buildSampleRun();
  const { optical, sonar } = sample.faultDelta;
  assert.ok(optical.cleanSamples > 0 && optical.faultedSamples > 0);
  assert.ok(optical.meanDelta01 > 0.5, `fault delta measured in output: ${optical.meanDelta01}`);
  assert.ok(optical.faultedMeanQuality01 < 0.09, `faulted mean: ${optical.faultedMeanQuality01}`);
  // Sonar means on both sides of the fault window are within fixture noise
  // of each other: the optical fault does not touch the sonar modality.
  assert.ok(Math.abs(sonar.cleanMeanQuality01 - sonar.faultedMeanQuality01) < 0.01);
});

test("sample records the idempotent duplicate fault attempt and typed rejections", () => {
  const sample = buildSampleRun();
  const duplicate = sample.commandOutcomes.find((c) => c.label.includes("duplicate retry"));
  assert.ok(duplicate, "duplicate retry is demonstrated");
  assert.equal(duplicate.duplicate, true);
  assert.ok(duplicate.faultId, "duplicate resolves to the original fault record");

  const failureCodes = new Map(sample.commandOutcomes.filter((c) => !c.ok).map((c) => [c.label, c.failure.code]));
  assert.equal(failureCodes.get("fault on aerial drone (wrong role)"), "fault_target_invalid");
  assert.equal(failureCodes.get("unknown robot"), "unknown_robot");
  assert.equal(failureCodes.get("unknown severity"), "invalid_fault_severity");
  assert.equal(failureCodes.get("out-of-bounds duration"), "invalid_fault_duration");
  assert.equal(failureCodes.get("resume while running"), "invalid_transition");
  assert.equal(failureCodes.get("forged provenance field"), "invalid_command_fields");
});

test("sample document contains no chain/wall-clock/verdict FIELD anywhere", () => {
  // Scan field names (not prose — the honesty notes legitimately explain
  // what the document does NOT contain).
  const keys = new Set();
  JSON.stringify(buildSampleRun(), (k, v) => {
    if (k !== "" && !/^\d+$/.test(k)) keys.add(k);
    return v;
  });
  for (const key of keys) {
    assert.ok(!/chain|transaction|signature|solana|blockhash|slot|lamports|wallet|payout/i.test(key), `no chain-domain field: ${key}`);
    assert.ok(!/occurredAt|observedAt|confirmedAt|receivedAt|createdAt|wallClock|epochMs/i.test(key), `no external-clock field: ${key}`);
    assert.ok(!/^accepted$|^verdict$|^sufficient$/i.test(key), `no verdict field: ${key}`);
  }
  // The only clock fields in the document are the simulator clock family
  // (compact names: tMs = simulatorTimeMs, dMs = appliedStepMs).
  const timeKeys = [...keys].filter((k) => /Ms$|time/i.test(k));
  assert.deepEqual(
    timeKeys.sort(),
    ["dMs", "simulatorTimeMs", "stepMs", "tMs"].sort(),
  );
});

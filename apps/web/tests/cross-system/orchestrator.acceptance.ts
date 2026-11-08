/** Requires an explicitly supplied adapter to Agent A's real store. Missing adapter is BLOCKED by the runner, never skipped. */
import { afterEach, beforeAll, expect, it } from "vitest";
import {
  applyEvent,
  buildPort001Script,
  canonicalJson,
  initMissionProjection,
  rehydrate,
} from "@vorqyn/contracts";
import type { IntegrationStore, OrchestratorDriver } from "./orchestrator-port";
import { scenario, unwrap } from "./scenario";
let driver: OrchestratorDriver;
const stores: IntegrationStore[] = [];
beforeAll(async () => {
  driver = await import(process.env.INTEGRATION_ORCHESTRATION_DRIVER!);
});
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
});
async function store() {
  const value = await driver.createIntegrationStore();
  stores.push(value);
  return value;
}
const events = () => buildPort001Script(); // CONTRACT FIXTURE ONLY. Storage behavior, never live authority proof.
it("restart retains byte-identical canonical history and reducer replay", async () => {
  const s = await store(),
    input = events().slice(0, 6);
  expect((await s.append(input, 0)).ok).toBe(true);
  await s.restart();
  const read = await s.read(input[0]!.missionId);
  expect(canonicalJson(read)).toBe(canonicalJson(input));
  expect(unwrap(rehydrate(read)).projection).toEqual(
    unwrap(rehydrate(input)).projection,
  );
});
it("concurrent writers sharing expected sequence yield exactly one append", async () => {
  const s = await store(),
    input = events();
  expect((await s.append([input[0]], 0)).ok).toBe(true);
  const result = await Promise.all([
    s.append([input[1]], 1),
    s.append(
      [
        {
          ...input[1],
          eventId: "qa-other-event",
          commandId: "qa-other-command",
        },
      ],
      1,
    ),
  ]);
  expect(result.filter((r) => r.ok)).toHaveLength(1);
  expect(await s.read(input[0]!.missionId)).toHaveLength(2);
});
it("tampered duplicate, sequence gap and wrong-mission batch cannot corrupt history", async () => {
  const s = await store(),
    input = events();
  await s.append([input[0]], 0);
  const before = canonicalJson(await s.read(input[0]!.missionId));
  for (const candidate of [
    { ...input[0], observedAtMs: input[0]!.observedAtMs + 1 },
    { ...input[1], sequence: 3 },
    { ...input[1], missionId: "qa-wrong-mission" },
  ])
    expect((await s.append([candidate], 1)).ok).toBe(false);
  expect(canonicalJson(await s.read(input[0]!.missionId))).toBe(before);
});
it("untrusted observation ingestion cannot add verification, payment or confirmed chain events", async () => {
  const s = await store(),
    input = events();
  await s.append([input[0]], 0);
  const mission = input[0]!.missionId;
  const prior = await s.read(mission);
  await s.ingestObservation(mission, scenario().journal.records[0]);
  for (const kind of [
    "task.evidenceAccepted",
    "task.paymentConfirmed",
    "chain.transactionUpdated",
  ]) {
    const forged = input.find((e) => e.kind === kind)!;
    expect((await s.ingestObservation(mission, forged)).ok).toBe(false);
  }
  const after = await s.read(mission);
  for (const e of after.slice(prior.length))
    expect([
      "task.evidenceAccepted",
      "task.paymentConfirmed",
      "chain.transactionUpdated",
    ]).not.toContain(e.kind);
  let projection = unwrap(initMissionProjection(after[0]));
  for (const e of after.slice(1)) {
    const next = applyEvent(projection, e);
    expect(next.ok).toBe(true);
    if (next.ok) projection = next.state;
  }
  expect(projection.paidLamports).toBe(0);
});
it("exact duplicates are idempotent while a changed event under the same command is refused", async () => {
  const s = await store(),
    input = events();
  expect((await s.append(input.slice(0, 2), 0)).ok).toBe(true);
  expect((await s.append([input[1]], 2)).ok).toBe(true);
  expect(await s.read(input[0]!.missionId)).toHaveLength(2);
  expect(
    (
      await s.append(
        [{ ...input[1], eventId: "qa-duplicate-command", sequence: 3 }],
        2,
      )
    ).ok,
  ).toBe(false);
  expect(await s.read("qa-other-mission")).toEqual([]);
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DemoContractError,
  validateDemoSimResponse,
  totalSimulatedSteps,
  buildClientRequestGuard,
} from "@/components/mission-world/demo-sim/contract";

const EMPTY = JSON.parse(
  readFileSync(path.resolve(__dirname, "fixtures/demo-sim-seed20261107-empty.json"), "utf8"),
) as unknown;
const RUN = JSON.parse(
  readFileSync(path.resolve(__dirname, "fixtures/demo-sim-seed20261107.json"), "utf8"),
) as unknown;

describe("VQ-DEMO-SIM/1 response contract validation", () => {
  it("accepts both kernel-generated fixtures (empty trace + demo run)", () => {
    expect(validateDemoSimResponse(EMPTY).snapshots).toHaveLength(0);
    const run = validateDemoSimResponse(RUN);
    expect(run.schema).toBe("vorqyn.demo-sim/response/1");
    expect(run.snapshots[0]?.provenance.sourceKind).toBe("SYNTHETIC_SIM");
    expect(run.snapshots[0]?.provenance.frameId).toBe("ENU_PORT-001_LOCAL");
    expect(run.state.robots).toHaveLength(3);
  });

  it("rejects a drifted sourceKind (e.g. someone relabels synthetic as live)", () => {
    const bad = { ...(RUN as object), sourceKind: "LIVE" };
    expect(() => validateDemoSimResponse(bad)).toThrow(DemoContractError);
  });

  it("rejects a wrong frameId (prevents rendering a foreign frame as PORT-001)", () => {
    const bad = { ...(RUN as object), frameId: "ENU_OTHER_WORLD" };
    expect(() => validateDemoSimResponse(bad)).toThrow(/frameId/);
  });

  it("rejects non-finite poses (NaN/Infinity telemetry cannot render)", () => {
    const bad = JSON.parse(JSON.stringify(RUN)) as { snapshots: Array<{ robots: Array<{ pose: { x: number } }> }> };
    bad.snapshots[0]!.robots[0]!.pose.x = Number.NaN;
    expect(() => validateDemoSimResponse(bad)).toThrow(/non-finite pose/);
  });

  it("counts simulated steps for the client-side budget", () => {
    const ops = (RUN as { operations: Array<{ op: string; count?: number }> }).operations;
    expect(totalSimulatedSteps(ops as never)).toBe(13);
  });
});

describe("client request guard", () => {
  it("builds the exact request envelope", () => {
    const request = buildClientRequestGuard(20261107, [{ op: "step", count: 1 }]);
    expect(request).toEqual({
      schema: "vorqyn.demo-sim/request/1",
      seed: 20261107,
      operations: [{ op: "step", count: 1 }],
    });
  });

  it("rejects step counts above the per-operation contract limit", () => {
    expect(() => buildClientRequestGuard(20261107, [{ op: "step", count: 13 }])).toThrow(/per-operation/);
  });

  it("rejects traces exceeding the total simulated step budget", () => {
    const ops = Array.from({ length: 40 }, () => ({ op: "step" as const, count: 12 }));
    expect(() => buildClientRequestGuard(20261107, ops)).toThrow(/budget/);
  });

  it("rejects a non-uint32 seed", () => {
    expect(() => buildClientRequestGuard(-1, [])).toThrow(/seed/);
    expect(() => buildClientRequestGuard(4294967296, [])).toThrow(/seed/);
  });
});

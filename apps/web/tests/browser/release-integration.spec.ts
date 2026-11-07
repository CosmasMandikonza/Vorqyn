import { test, expect } from "@playwright/test";

const requestSchema = "vorqyn.demo-sim/request/1";
test("DEMO-01 actual transport: deterministic fault and stale observations", async ({
  request,
}) => {
  const base = [{ op: "step", count: 2 }];
  const first = await request.post("/api/demo/simulation", {
    data: { schema: requestSchema, seed: 20261107, operations: base },
  });
  if ([404, 405].includes(first.status()))
    throw new Error(
      `BLOCKED: DEMO-01 endpoint is absent (HTTP ${first.status()}); Issue #32 must merge.`,
    );
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toContain("no-store");
  const clean = await first.json();
  expect(clean.schema).toBe("vorqyn.demo-sim/response/1");
  expect(clean.sourceKind).toBe("SYNTHETIC_SIM");
  expect(clean.snapshots).toHaveLength(2);
  expect(clean.frameId).toBe("ENU_PORT-001_LOCAL");
  const operations = [
    ...base,
    {
      op: "command",
      command: {
        type: "injectOpticalVisibilityFault",
        robotId: "rov-01",
        severity: "severe",
        durationMs: 9000,
        idempotencyKey: "release-fault",
      },
    },
    { op: "step", count: 2 },
  ];
  const faulted = await request.post("/api/demo/simulation", {
    data: { schema: requestSchema, seed: 20261107, operations },
  });
  expect(faulted.status()).toBe(200);
  const data = await faulted.json();
  const before = clean.snapshots
    .at(-1)
    .robots.find((r: { robotId: string }) => r.robotId === "rov-01");
  const after = data.snapshots
    .at(-1)
    .robots.find((r: { robotId: string }) => r.robotId === "rov-01");
  const optical = (r: typeof before) =>
    r.sensors.find((s: { kind: string }) => s.kind === "optical").measured
      .quality01;
  expect(optical(after)).toBeLessThan(optical(before) * 0.3);
  const repeated = await request.post("/api/demo/simulation", {
    data: { schema: requestSchema, seed: 20261107, operations },
  });
  expect(await repeated.json()).toEqual(data);
  const stale = await request.post("/api/demo/simulation", {
    data: {
      schema: requestSchema,
      seed: 20261107,
      operations: [
        ...base,
        {
          op: "command",
          command: {
            type: "disconnectTelemetry",
            robotId: "rov-01",
            idempotencyKey: "release-disconnect",
          },
        },
        { op: "step", count: 1 },
      ],
    },
  });
  expect(stale.status()).toBe(200);
  const frozen = (await stale.json()).snapshots
    .at(-1)
    .robots.find((r: { robotId: string }) => r.robotId === "rov-01");
  expect(frozen.fresh).toBe(false);
  expect(frozen.staleness).toBe("link-disconnected");
  for (const sensor of frozen.sensors) expect(sensor.measured).toBeNull();
});

test("DEMO-02 real browser playback must use actual transport, not fixtures", async ({
  page,
}) => {
  await page.goto("/demo/mission");
  await expect(page.getByTestId("honesty-badge")).toBeVisible();
  const start = page.getByRole("button", { name: /Start synthetic survey/i });
  if ((await start.count()) === 0)
    throw new Error(
      "BLOCKED: DEMO-02 dynamic controls are absent; Issue #33 must merge. Static anchors are not playback.",
    );
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/demo/simulation") &&
      r.request().method() === "POST",
  );
  await start.click();
  const response = await responsePromise;
  if ([404, 405].includes(response.status()))
    throw new Error(
      "BLOCKED: dynamic UI is present but DEMO-01 transport is absent.",
    );
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.sourceKind).toBe("SYNTHETIC_SIM");
  await expect(page.getByText(/SYNTHETIC_SIM/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Advance/i })).toBeEnabled();
});

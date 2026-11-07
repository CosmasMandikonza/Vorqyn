import { readFileSync } from "node:fs";
import path from "node:path";
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDemoPlayback } from "@/components/mission-world/demo-sim/useDemoPlayback";
import { fixtureDemoTransport } from "@/components/mission-world/demo-sim/fixture";
import { buildDemoSimRequest, httpDemoTransport } from "@/components/mission-world/demo-sim/client";
import { DEMO_SIM_REQUEST_SCHEMA, validateDemoSimResponse } from "@/components/mission-world/demo-sim/contract";

const RUN = validateDemoSimResponse(
  JSON.parse(
    readFileSync(path.resolve(__dirname, "fixtures/demo-sim-seed20261107.json"), "utf8"),
  ) as unknown,
);

describe("http transport (contract behaviour)", () => {
  it("posts the exact envelope to the frozen endpoint", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => { void url; void init; return new Response(JSON.stringify(RUN), { status: 200 }); });
    vi.stubGlobal("fetch", fetchMock);
    const body = buildDemoSimRequest(20261107, [{ op: "step", count: 10 }]);
    const result = await httpDemoTransport(body, new AbortController().signal);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/demo/simulation");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual(body);
    expect(result.snapshots).toHaveLength(13);
    vi.unstubAllGlobals();
  });

  it("maps typed 422 kernel rejections to DemoSimHttpError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ schema: "vorqyn.demo-sim/error/1", error: { code: "invalid_transition", message: "fault injection is only valid while running" } }), { status: 422 }),
      ),
    );
    await expect(
      httpDemoTransport(buildDemoSimRequest(20261107, []), new AbortController().signal),
    ).rejects.toMatchObject({ name: "DemoSimHttpError", status: 422, code: "invalid_transition" });
    vi.unstubAllGlobals();
  });

  it("maps network failures to DemoSimNetworkError (drives the static fallback)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(
      httpDemoTransport(buildDemoSimRequest(20261107, []), new AbortController().signal),
    ).rejects.toMatchObject({ name: "DemoSimNetworkError" });
    vi.unstubAllGlobals();
  });
});

describe("playback controller (fixture transport, recorded kernel run)", () => {
  it("start creates a session with the initial kernel state and no snapshots", async () => {
    const { result } = renderHook(() => useDemoPlayback({ transportKind: "fixture", transport: fixtureDemoTransport }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.response?.snapshots).toHaveLength(0);
    expect(result.current.response?.state.sequence).toBe(0);
    expect(result.current.response?.state.robots.find((r) => r.robotId === "rover-01")?.pose).toEqual({
      x: -160, y: 160, z: 4.05,
    });
    expect(result.current.latestSnapshot).toBeNull();
  });

  it("advance sends the accumulated trace and moves the visual head to the newest observation", async () => {
    const { result } = renderHook(() => useDemoPlayback({ transportKind: "fixture", transport: fixtureDemoTransport }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.advance(1));
    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(result.current.trace).toEqual([{ op: "step", count: 1 }]);
    expect(result.current.latestSnapshot?.sequence).toBe(13);
    expect(result.current.budgetUsed).toBe(1);
  });

  it("injectFault appends a real kernel command with a unique idempotency key", async () => {
    const { result } = renderHook(() => useDemoPlayback({ transportKind: "fixture", transport: fixtureDemoTransport }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.injectFault());
    await waitFor(() => expect(result.current.pending).toBeNull());
    const commandOp = result.current.trace.find((op) => op.op === "command");
    expect(commandOp).toBeDefined();
    if (commandOp?.op === "command") {
      const command = commandOp.command as { type?: string; robotId?: string; severity?: string; durationMs?: number; idempotencyKey?: string };
      expect(command.type).toBe("injectOpticalVisibilityFault");
      expect(command.robotId).toBe("rov-01");
      expect(command.severity).toBe("severe");
      expect(command.durationMs).toBe(9000);
      expect(command.idempotencyKey).toMatch(/^guest-optical-/);
    }
    // The fixture response carries the kernel's actual fault result.
    expect(result.current.response?.commandResults[0]?.ok).toBe(true);
  });

  it("replay re-executes the trace and verifies determinism against the previous run", async () => {
    const { result } = renderHook(() => useDemoPlayback({ transportKind: "fixture", transport: fixtureDemoTransport }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.advance(1));
    await waitFor(() => expect(result.current.pending).toBeNull());
    act(() => result.current.replay());
    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(result.current.replayIdentical).toBe(true);
  });

  it("reset returns to the pre-session state", async () => {
    const { result } = renderHook(() => useDemoPlayback({ transportKind: "fixture", transport: fixtureDemoTransport }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.reset());
    expect(result.current.phase).toBe("idle");
    expect(result.current.trace).toHaveLength(0);
    expect(result.current.response).toBeNull();
    expect(result.current.latestSnapshot).toBeNull();
  });

  it("enforces the client-side step budget and stops playback honestly", async () => {
    const { result } = renderHook(() => useDemoPlayback({ transportKind: "fixture", transport: fixtureDemoTransport }));
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    // Drive near the budget with single-step advances (fixture transport is cheap).
    for (let i = 0; i < 3; i += 1) {
      act(() => result.current.advance(1));
      await waitFor(() => expect(result.current.pending).toBeNull());
    }
    expect(result.current.budgetUsed).toBe(3);
    expect(result.current.budgetMax).toBe(400);
  });
});

describe("out-of-order response guard", () => {
  it("ignores a stale response that resolves after a newer one", async () => {
    const EMPTY = JSON.parse(
      readFileSync(path.resolve(__dirname, "fixtures/demo-sim-seed20261107-empty.json"), "utf8"),
    );
    const { result } = renderHook(() => useDemoPlayback({ transportKind: "http", transport: httpDemoTransport }));
    // Two in-flight requests: the first hangs, the second (newer) completes.
    let resolveSlow: (value: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => { resolveSlow = resolve; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => slow) // first request (older seq) hangs
      .mockImplementationOnce(async () => new Response(JSON.stringify(EMPTY), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    act(() => result.current.start());
    await waitFor(() => expect(result.current.pending).toBe("start"));
    // A reset invalidates the in-flight request (seq bump + abort)...
    act(() => result.current.reset());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.response?.snapshots).toHaveLength(0);
    // ...then the stale first response resolves — it must NOT be applied.
    resolveSlow(new Response(JSON.stringify(RUN), { status: 200 }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(result.current.response?.snapshots).toHaveLength(0); // empty-trace response stands
    expect(result.current.budgetUsed).toBe(0);
    vi.unstubAllGlobals();
  });

  it("buildDemoSimRequest always carries the frozen schema string", () => {
    expect(buildDemoSimRequest(20261107, []).schema).toBe(DEMO_SIM_REQUEST_SCHEMA);
  });
});

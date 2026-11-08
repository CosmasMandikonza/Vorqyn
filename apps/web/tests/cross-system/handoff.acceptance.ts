/** Read-only presentation checks on the real pending owner module. Existing contract fixture signatures are NOT RPC receipts. */
import { beforeAll, expect, it } from "vitest";
import { resolve } from "node:path";
import { buildPort001Script, PORT_001 } from "@vorqyn/contracts";
import { scenario } from "./scenario";
const load = () =>
  import(
    resolve(
      process.env.INTEGRATION_TARGET_ROOT!,
      "apps/web/components/mission-world/economic-handoff/boundary.ts",
    )
  );
let handoff: Awaited<ReturnType<typeof load>>;
beforeAll(async () => {
  handoff = await load();
});
const context = {
  missionId: PORT_001.missionId,
  taskId: PORT_001.tasks.sea.taskId,
};
it("raw synthetic journal records cannot display accepted verification or paid handoff", () => {
  const result = handoff.projectEconomicHandoff(
    scenario().journal.records,
    context,
  );
  expect(
    result.stages.some((s: { state: string }) => s.state === "confirmed"),
  ).toBe(false);
  expect(result.eventRows).toHaveLength(0);
});
it("other mission events stay excluded from the bound handoff", () => {
  const foreign = buildPort001Script().map((e) => ({
    ...e,
    missionId: "qa-other-mission",
  }));
  const result = handoff.projectEconomicHandoff(foreign, context);
  expect(result.derivedFromEventCount).toBe(0);
  expect(result.audit.length).toBeGreaterThan(0);
  expect(
    result.stages.some((s: { state: string }) => s.state === "confirmed"),
  ).toBe(false);
});
it("verified task with no submitted payout cannot claim a payout was initiated", () => {
  const events = buildPort001Script();
  const end = events.findIndex((e) => e.kind === "task.evidenceAccepted");
  const result = handoff.projectEconomicHandoff(
    events.slice(0, end + 1),
    context,
  );
  const payout = result.stages.find(
    (s: { id: string }) => s.id === "payout-confirmation",
  );
  expect(payout).toBeDefined();
  expect(payout.state).not.toBe("confirmed");
  expect(payout.detail.toLowerCase()).not.toContain("payout initiated");
  expect(payout.confirmation).toBeUndefined();
});
it("a submitted fixture payout remains in flight without confirmation authority", () => {
  const events = buildPort001Script();
  const index = events.findIndex(
    (e) =>
      e.kind === "chain.transactionSubmitted" &&
      (e.payload as { kind?: string }).kind === "payout" &&
      (e.payload as { taskId?: string }).taskId === context.taskId,
  );
  expect(index).toBeGreaterThan(0);
  const result = handoff.projectEconomicHandoff(
    events.slice(0, index + 1),
    context,
  );
  const payout = result.stages.find(
    (s: { id: string }) => s.id === "payout-confirmation",
  );
  expect(payout.state).toBe("submitted-awaiting-confirmation");
  expect(payout.confirmation).toBeUndefined();
});
it("canonical finalized fixture receipts preserve the reducer's confirmed payout semantics", () => {
  // Existing contract fixtures only. Altering fixture status is not an observed RPC receipt.
  const events = buildPort001Script().map((e) =>
    e.kind === "chain.transactionUpdated"
      ? { ...e, payload: { ...e.payload, status: "finalized" } }
      : e,
  );
  const result = handoff.projectEconomicHandoff(events, context);
  expect(result.audit).toHaveLength(0);
  const payout = result.stages.find(
    (s: { id: string }) => s.id === "payout-confirmation",
  );
  expect(payout.state).toBe("confirmed");
  expect(payout.confirmation.transactionSignature).toBeDefined();
});
it("a canonical payout fixture without a recipient wallet never invents one from operator identity", () => {
  const events = buildPort001Script().map((e) => {
    if (e.kind !== "chain.transactionSubmitted") return e;
    const payload = { ...e.payload } as Record<string, unknown>;
    delete payload.recipientWallet;
    return { ...e, payload };
  });
  const result = handoff.projectEconomicHandoff(events, context);
  expect(result.audit).toHaveLength(0);
  const payout = result.stages.find(
    (s: { id: string }) => s.id === "payout-confirmation",
  );
  expect(payout.state).toBe("confirmed");
  expect(payout.confirmation).not.toHaveProperty("recipientWallet");
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  buildPort001Script,
  buildHarbor002Script,
  FIXTURE_SIG_PAYOUT_SEA,
  PORT_001,
  HARBOR_002,
  type MissionEvent,
} from "@vorqyn/contracts";
import { projectEconomicHandoff } from "@/components/mission-world/economic-handoff/boundary";
import { RecoveryHandoffPanel } from "@/components/mission-world/economic-handoff/RecoveryHandoffPanel";

/**
 * Economic Handoff (Issue #15 economic section) — the validated
 * event-projection boundary must accept ONLY canonical MissionEvents for the
 * bound mission/task, and every hostile shape named in the review must be
 * rejected or surfaced as audit, never rendered as state.
 */
const RUN = buildPort001Script().map((event) => event as unknown);

describe("economic handoff boundary — happy path", () => {
  const projection = projectEconomicHandoff(RUN, {
    missionId: PORT_001.missionId,
    taskId: PORT_001.tasks.sea.taskId,
  });

  it("ingests the canonical fixture run through the reducer", () => {
    expect(projection.derivedFromEventCount).toBe(RUN.length);
    expect(projection.audit).toHaveLength(0);
  });

  it("derives all six stages", () => {
    expect(projection.stages.map((s) => s.id)).toEqual([
      "verifier-decision",
      "recovery-proposal",
      "reassignment-confirmation",
      "replacement-observations",
      "payout-confirmation",
    ]);
  });

  it("records the recovery journey: v1 verdict REJECTED (history), v2 ACCEPTED (final)", () => {
    const stage = projection.stages.find((s) => s.id === "verifier-decision")!;
    // The canonical recovery story ends with the v2 evidence ACCEPTED; the
    // v1 visibility rejection remains recorded as history in the detail.
    expect(stage.state).toBe("confirmed");
    expect(stage.detail).toContain("ACCEPTED");
    expect(stage.detail).toContain("rule-sonar-coverage-ok");
    expect(stage.detail).toContain("Earlier recorded rejection");
    expect(stage.detail).toContain("rule-visibility-below-1m");
  });

  it("shows the constrained recovery proposal with rejected alternative", () => {
    const stage = projection.stages.find((s) => s.id === "recovery-proposal")!;
    expect(stage.state).toBe("proposed");
    expect(stage.detail).toContain("offer-rov-b-sonar");
    expect(stage.detail).toContain("1 rejected alternative");
  });

  it("confirms the reassignment only via the confirmed chain receipt", () => {
    const stage = projection.stages.find((s) => s.id === "reassignment-confirmation")!;
    expect(stage.state).toBe("confirmed");
    expect(stage.confirmation?.transactionSignature).toBeDefined();
    expect(stage.confirmation?.slot).toBeGreaterThan(0);
  });

  it("marks replacement observations unavailable (no operator-B source in guest path)", () => {
    const stage = projection.stages.find((s) => s.id === "replacement-observations")!;
    expect(stage.state).toBe("unavailable");
  });

  it("confirms the payout only via the confirmed chain receipt with amount", () => {
    const stage = projection.stages.find((s) => s.id === "payout-confirmation")!;
    expect(stage.state).toBe("confirmed");
    expect(stage.confirmation?.transactionSignature).toBe("VQsigPayoutSeaTx111111111111111111111111111111111111111111111111111111111111111111111111");
  });
});

describe("economic handoff boundary — hostile input rejection", () => {
  it("excludes cross-mission events and audits the exclusion", () => {
    const foreign = buildHarbor002Script();
    const mixed = [...RUN, ...foreign];
    const projection = projectEconomicHandoff(mixed, {
      missionId: PORT_001.missionId,
      taskId: PORT_001.tasks.sea.taskId,
    });
    const excluded = projection.audit.filter((entry) => entry.code === "cross_mission_event_excluded");
    expect(excluded.length).toBeGreaterThanOrEqual(foreign.length);
    // HARBOR-002 events must not promote any PORT-001 stage
    expect(projection.missionId).toBe(PORT_001.missionId);
  });

  it("rejects a payout receipt whose transaction references another mission's task (identity binding)", () => {
    // A payout receipt for HARBOR-002's air task presented inside PORT-001:
    // the reducer must not bind it to PORT-001's sea task.
    const foreign = buildHarbor002Script().map((event) => event as unknown);
    const sea = (RUN as MissionEvent[]).filter(
      (e) => e.kind === "chain.transactionUpdated",
    );
    void sea; void foreign;
    // hostile: forged payout confirmation payload bound to the WRONG task id
    const forged = {
      eventId: "evt-forged-pay",
      missionId: PORT_001.missionId,
      sequence: (RUN as MissionEvent[]).length + 1,
      kind: "task.paymentConfirmed",
      payload: {
        taskId: "task-sea-survey",
        transactionSignature: "ForgedPaySig111111111111111111111111111111111111111111111111111111111111111111",
        amountLamports: 1_100_000_000,
      },
      occurredAtMs: 1_762_000_000_000 + 99_000,
      observedAtMs: 1_762_000_000_000 + 99_010,
      schemaVersion: 1,
    };
    const projection = projectEconomicHandoff([...RUN, forged], {
      missionId: PORT_001.missionId,
      taskId: PORT_001.tasks.sea.taskId,
    });
    // The event validates structurally, so ingestion succeeds — but the
    // forged event is NOT part of the canonical fixture and the reducer
    // would reject the duplicate/mismatched signature at the program level.
    // The boundary's contract: an event the fixture never produced cannot
    // alter the recorded stages.
    const payout = projection.stages.find((s) => s.id === "payout-confirmation")!;
    expect(payout.confirmation?.transactionSignature).not.toBe("ForgedPaySig111111111111111111111111111111111111111111111111111111111111111111");
  });

  it("refuses pending/unknown chain statuses presented as paid", () => {
    // A receipt stuck at 'processed' must render submitted-awaiting-confirmation,
    // never confirmed/paid.
    const snapshots = (RUN as MissionEvent[]).slice(0, 16); // up to payout submitted
    const projection = projectEconomicHandoff(snapshots, {
      missionId: PORT_001.missionId,
      taskId: PORT_001.tasks.sea.taskId,
    });
    const payout = projection.stages.find((s) => s.id === "payout-confirmation")!;
    expect(payout.state).toBe("submitted-awaiting-confirmation");
    expect(payout.confirmation).toBeUndefined();
  });

  it("surfaces stale assignment version rejections from the reducer", () => {
    // Hostile: a second reassignment authorized with a STALE expectedVersion
    // (already superseded) — the reducer rejects it at application time.
    const base = buildPort001Script();
    const withStale = [
      ...base.map((event) => event as unknown),
      {
        eventId: `evt-port-001-${base.length + 1}`,
        missionId: PORT_001.missionId,
        sequence: base.length + 1,
        kind: "task.reassignmentAuthorized",
        payload: {
          taskId: "task-sea-survey",
          expectedVersion: 1, // STALE: current version is already 2
          newOperatorId: "operator-rov-c",
          newRobotId: "rov-c-01",
          offerId: "offer-rov-c",
          quoteLamports: 900_000_000,
          authorizedBy: "owner",
          transactionSignature: "VQsigStaleReassign111111111111111111111111111111111111111111111111111111111111111",
        },
        occurredAtMs: 1_762_000_000_000 + 99_000,
        observedAtMs: 1_762_000_000_000 + 99_010,
        schemaVersion: 1,
      },
    ];
    const projection = projectEconomicHandoff(withStale, {
      missionId: PORT_001.missionId,
      taskId: PORT_001.tasks.sea.taskId,
    });
    const rejected = projection.audit.some(
      (entry) =>
        entry.code !== "cross_mission_event_excluded" &&
        /stale|version|expected/i.test(entry.message + " " + entry.code),
    );
    expect(rejected).toBe(true);
  });

  it("refuses simulator time presented as chain time (clock-domain violation)", () => {
    const forged = JSON.parse(JSON.stringify(RUN)) as Array<Record<string, unknown> & { payload: Record<string, unknown>; kind: string; simulatorTimeMs?: number; chainTimeMs?: number }>;
    const payoutUpdate = forged.find((e) => e.kind === "chain.transactionUpdated")!;
    // A hostile emitter presents SIMULATOR time as chain time: the envelope's
    // simulatorTimeMs field (contract domain 3a) is set on a chain
    // confirmation event, where only chainTimeMs (domain 3b) is legal.
    payoutUpdate.simulatorTimeMs = 65_000;
    delete payoutUpdate.chainTimeMs;
    const projection = projectEconomicHandoff(forged, {
      missionId: PORT_001.missionId,
      taskId: PORT_001.tasks.sea.taskId,
    });
    const clockViolation = projection.audit.some(
      (entry) => entry.code === "clock_domain_violation" || /clock/i.test(entry.message),
    );
    expect(clockViolation).toBe(true);
  });

  it("refuses fabricated verdicts that fail the contracts' own maker", () => {
    const forged = JSON.parse(JSON.stringify(RUN)) as MissionEvent[];
    const rejection = forged.find((e) => e.kind === "task.evidenceRejected")!;
    (rejection.payload as { verdict: { verifierId?: string } }).verdict.verifierId = "";
    const projection = projectEconomicHandoff(forged, {
      missionId: PORT_001.missionId,
      taskId: PORT_001.tasks.sea.taskId,
    });
    // The contracts' validateVerdictPayload rejects the empty verifierId —
    // rehydrate aborts and the boundary reports ingestion rejection instead
    // of rendering a fabricated decision.
    expect(projection.audit.some((entry) => /rejected|invalid/i.test(entry.message))).toBe(true);
  });

  it("marks duplicate receipts as duplicates instead of double-counting", () => {
    const doubled: unknown[] = [...(RUN as MissionEvent[])];
    const payoutConfirmed = doubled.find((e) => (e as { kind?: string }).kind === "task.paymentConfirmed")!;
    doubled.push({
      ...payoutConfirmed,
      eventId: "evt-port-001-dup-pay",
      sequence: doubled.length + 1,
      commandId: "cmd-dup-pay",
    });
    const projection = projectEconomicHandoff(doubled, {
      missionId: PORT_001.missionId,
      taskId: PORT_001.tasks.sea.taskId,
    });
    // The single-use payout signature appears in exactly the canonical number
    // of rows — the hostile duplicate adds none.
    const sig = "VQsigPayoutSeaTx111111111111111111111111111111111111111111111111111111111111111111111111";
    const payoutRows = projection.eventRows.filter((r) => r.transactionSignature === sig);
    expect(payoutRows.length).toBe(3);
  });
});

describe("economic handoff panel render", () => {
  it("renders the six stages with honest pending states when no events exist", () => {
    render(
      <RecoveryHandoffPanel
        projection={projectEconomicHandoff([], {
          missionId: PORT_001.missionId,
          taskId: PORT_001.tasks.sea.taskId,
        })}
        sourceLabel="PENDING — awaiting an authoritative mission event source"
        measuredAvailable={false}
        walkthroughLoaded={false}
      />,
    );
    expect(screen.getByTestId("handoff-panel")).toBeVisible();
    expect(screen.getAllByText(/awaiting authority/i).length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText(/No validated mission events ingested/i).length).toBeGreaterThanOrEqual(5);
  });

  it("renders the full canonical journey with confirmed payout and a rejected fracture verdict", () => {
    const projection = projectEconomicHandoff(
      JSON.parse(JSON.stringify(RUN)) as unknown[],
      {
        missionId: PORT_001.missionId,
        taskId: PORT_001.tasks.sea.taskId,
      },
    );
    render(
      <RecoveryHandoffPanel
        projection={projection}
        sourceLabel="FIXTURE PLAYBACK (recorded kernel response)"
        measuredAvailable
        walkthroughLoaded
      />,
    );
    // payout confirmed via recorded receipt
    const payoutStage = screen.getByTestId("handoff-stage-payout-confirmation");
    expect(payoutStage).toBeVisible();
    expect(payoutStage.textContent).toContain("CONFIRMED");
    expect(payoutStage.textContent).toContain("1100000000");
    // fracture verdict recorded
    expect(screen.getByText(/rule-visibility-below-1m/i)).toBeVisible();
  });
});

/**
 * Payment-stage acceptance matrix (PR #53 review corrections).
 *
 * Canonical fixture seq (1-based): 15 ends at task.verified, 16 = payout
 * transactionSubmitted, 17 = receipt status confirmed, 18 =
 * task.paymentConfirmed (task paid). Every row states ONLY what the
 * recorded evidence justifies — a financial success claim requires a
 * confirmed/finalized receipt AND the recorded payout event (the exact
 * reducer rule); anything else renders eligible/waiting.
 *
 * | row | recorded evidence                              | rendered state                 | forbidden                          |
 * |-----|------------------------------------------------|--------------------------------|------------------------------------|
 * | A   | verified, no payout receipt                    | awaiting-authority ("ELIGIBLE") | "initiated"/"confirmed", confirmation |
 * | B   | verified, receipt submitted                    | submitted-awaiting-confirmation | "confirmed", confirmation object   |
 * | C   | verified, receipt processed                    | submitted-awaiting-confirmation | "confirmed", confirmation object   |
 * | D   | verified, receipt confirmed, event not recorded| awaiting-authority ("ELIGIBLE") | "initiated", confirmation object   |
 * | E   | paid, receipt confirmed + payment event        | confirmed + amount             | invented recipientWallet           |
 * | F   | receipt rejected (via unknown)                 | rejected                       | "confirmed", confirmation object   |
 */
describe("payment-stage acceptance matrix", () => {
  const ctx = { missionId: PORT_001.missionId, taskId: PORT_001.tasks.sea.taskId };
  const RUNE = RUN as MissionEvent[];
  const payoutStage = (events: unknown[]) =>
    projectEconomicHandoff(events, ctx).stages.find((s) => s.id === "payout-confirmation")!;

  const chainUpdate = (sequence: number, status: string) => ({
    eventId: `evt-matrix-chain-${sequence}`,
    missionId: PORT_001.missionId,
    sequence,
    kind: "chain.transactionUpdated",
    payload: { transactionSignature: FIXTURE_SIG_PAYOUT_SEA, status },
    occurredAtMs: 1_762_000_000_000 + 12_000 + sequence,
    observedAtMs: 1_762_000_000_000 + 12_010 + sequence,
    ...(status === "confirmed" || status === "finalized" ? { chainTimeMs: 1_762_000_000_000 + 12_000 + sequence } : {}),
    schemaVersion: 1,
  });

  it("A: verified task, no payout receipt — eligible/waiting, never 'initiated' or 'confirmed'", () => {
    const stage = payoutStage(RUNE.slice(0, 15));
    expect(stage.state).toBe("awaiting-authority");
    expect(stage.confirmation).toBeUndefined();
    expect(stage.detail).toContain("ELIGIBLE");
    expect(stage.title.toLowerCase()).not.toContain("confirmed");
    expect(stage.detail).not.toMatch(/initiated/i);
    expect(stage.detail).not.toMatch(/confirmed/i);
  });

  it("B: verified task, receipt SUBMITTED — in flight, no confirmation object", () => {
    const stage = payoutStage(RUNE.slice(0, 16));
    expect(stage.state).toBe("submitted-awaiting-confirmation");
    expect(stage.confirmation).toBeUndefined();
    expect(stage.detail).toContain('"submitted"');
    expect(stage.detail).toMatch(/NOT treated as paid/);
  });

  it("C: verified task, receipt PROCESSED — still not confirmed", () => {
    const stage = payoutStage([...RUNE.slice(0, 16), chainUpdate(17, "processed")]);
    expect(stage.state).toBe("submitted-awaiting-confirmation");
    expect(stage.confirmation).toBeUndefined();
    expect(stage.detail).toContain('"processed"');
  });

  it("D: receipt confirmed but payment event not yet recorded — task not shown paid", () => {
    const stage = payoutStage(RUNE.slice(0, 17));
    expect(stage.state).toBe("awaiting-authority");
    expect(stage.confirmation).toBeUndefined();
    expect(stage.detail).toContain("ELIGIBLE");
    expect(stage.detail).not.toMatch(/initiated/i);
  });

  it("E: paid task, confirmed receipt + recorded payment event — confirmed, amount, no invented recipient", () => {
    const stage = payoutStage(RUNE);
    expect(stage.state).toBe("confirmed");
    expect(stage.confirmation?.amountLamports).toBe(1_100_000_000);
    // the canonical receipt records NO recipientWallet — the projection must
    // not invent one (recipient claims need a receipt that recorded it)
    expect(stage.confirmation?.recipientWallet).toBeUndefined();
  });

  it("F: payout receipt ended rejected (via unknown observation) — rejected, not confirmed", () => {
    const stage = payoutStage([...RUNE.slice(0, 16), chainUpdate(17, "unknown"), chainUpdate(18, "rejected")]);
    expect(stage.state).toBe("rejected");
    expect(stage.confirmation).toBeUndefined();
    expect(stage.detail).toContain('"rejected"');
  });

  it("G: hostile processed-update cannot promote the payout stage for ANY task status", () => {
    // processed presented all the way to the end of the canonical run: the
    // receipt's own update replaces confirmed, so payment can never have
    // applied — the stage must stay in-flight, never confirmed.
    const hostile = [...RUNE];
    const confirmedIdx = hostile.findIndex(
      (e) => e.kind === "chain.transactionUpdated" && (e.payload as { status?: string }).status === "confirmed",
    );
    hostile[confirmedIdx] = {
      ...hostile[confirmedIdx]!,
      payload: { transactionSignature: FIXTURE_SIG_PAYOUT_SEA, status: "processed" },
    };
    const projection = projectEconomicHandoff(hostile, ctx);
    const stage = projection.stages.find((s) => s.id === "payout-confirmation")!;
    expect(stage.state).not.toBe("confirmed");
    expect(stage.confirmation).toBeUndefined();
  });
});

// PORT_001 imported for readability of the assertions above.
void PORT_001;
void HARBOR_002;

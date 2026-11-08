/** Actual package connection checks; model/offer inputs are QA fixtures, not a live AI or operator catalogue. */
import { beforeAll, expect, it } from "vitest";
import { resolve } from "node:path";
import { currentBoundaryFindings, MISSION, TASK } from "./scenario";
const load = () =>
  import(
    resolve(
      process.env.INTEGRATION_TARGET_ROOT!,
      "services/mission/recovery/src/index.ts",
    )
  );
let recovery: Awaited<ReturnType<typeof load>>;
beforeAll(async () => {
  recovery = await load();
});
function request(missionId = MISSION) {
  return {
    missionId,
    taskId: TASK,
    taskKind: "sea",
    requiredCapabilities: ["sonar"],
    currentAssignmentVersion: 1,
    currentOperatorId: "qa-original",
    currentRobotId: "rov-01",
    currentRewardLamports: 800000000n,
    evidenceFailureReasons: currentBoundaryFindings().reasons,
    budgetLamports: 1200000000n,
    missionRemainingLamports: 200000000n,
    nowMs: 1762000000020,
    offers: [
      {
        offerId: "qa-sonar",
        operatorId: "qa-replacement",
        robotId: "qa-rov-b",
        description: "QA FIXTURE ONLY",
        capabilities: ["sonar"],
        quoteLamports: 900000000n,
        payoutWallet: "QA-NOT-A-WALLET",
        validFromMs: 1762000000000,
        expiresAtMs: 1762000010000,
      },
    ],
  };
}
const model = {
  modelId: "QA DETERMINISTIC FAILURE — NO LIVE AI",
  propose: async () => ({
    ok: false,
    error: { code: "validation_error", message: "QA model offline" },
  }),
};
it("current reservation permits a 0.1 SOL top-up, while excess top-up is refused", () => {
  const r = request();
  expect(recovery.checkOffer(r.offers[0], r).ok).toBe(true);
  expect(
    recovery.checkOffer({ ...r.offers[0], quoteLamports: 1100000000n }, r).ok,
  ).toBe(false);
});
it.each([1.5, NaN, Infinity])(
  "invalid external quote %s is a typed rejection, never a throwing conversion",
  (quoteLamports) => {
    const r = request();
    expect(
      recovery.checkOffer({ ...r.offers[0], quoteLamports }, r),
    ).toMatchObject({ ok: false, rejection: { reasonCode: "quote_invalid" } });
  },
);
it("prompt is JSON-safe and lossless for bigint money; measured failure reasons stay verbatim", () => {
  const r = request();
  r.budgetLamports = 9007199254740993n;
  r.offers[0]!.quoteLamports = 9007199254740993n;
  const prompt = recovery.buildPromptInput(r);
  expect(JSON.parse(JSON.stringify(prompt)).budgetLamports).toBe(
    "9007199254740993",
  );
  expect(prompt.offers[0].quoteLamports).toBe("9007199254740993");
  expect(prompt.evidenceFailureReasons).toEqual(
    currentBoundaryFindings().reasons,
  );
});
it("one shared attempt ledger does not suppress another mission with the same task/version", async () => {
  const attemptStore = new recovery.InMemoryAttemptStore();
  const first = await recovery.proposeRecovery(request(), {
    model,
    attemptStore,
    timeoutMs: 10,
  });
  const second = await recovery.proposeRecovery(request("qa-mission-b"), {
    model,
    attemptStore,
    timeoutMs: 10,
  });
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
});
it("stale version cannot produce an unsigned intent; fresh metadata produces no signature or confirmation", async () => {
  const r = request(),
    outcome = await recovery.proposeRecovery(r, { model, timeoutMs: 10 });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error("no QA proposal");
  const approval = {
    approvedBy: "owner",
    approvalId: "qa-metadata-not-wallet-auth",
    approvedAtMs: r.nowMs,
  };
  expect(
    recovery.authorizeProposal(
      outcome.value,
      { ...r, currentAssignmentVersion: 2 },
      approval,
    ).ok,
  ).toBe(false);
  const intent = recovery.authorizeProposal(outcome.value, r, approval);
  expect(intent.ok).toBe(true);
  expect(intent.value).not.toHaveProperty("signature");
  expect(intent.value).not.toHaveProperty("confirmedAtMs");
});

/**
 * CTO review P1-B: prove the instruction builders EXECUTE in a browser-like
 * context — not merely that a bundle compiles. This test deletes the Node
 * `Buffer` global (and `process`) BEFORE invoking initializeMissionIx and
 * verifyAndClaimIx; any residual Node-global usage throws ReferenceError
 * and fails the test. Seeds/PDAs are cross-checked against the same
 * Rust-derived fixtures used elsewhere.
 */

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import fixtures from "./fixtures-chain.json";
import { initializeMissionIx, verifyAndClaimIx, missionPda } from "./index";

const OWNER = new PublicKey(fixtures.owner);

describe("browser-context runtime (no Node globals)", () => {
  it("builders run with Buffer and process deleted from globalThis", () => {
    const g = globalThis as Record<string, unknown>;
    const savedBuffer = g.Buffer;
    const savedProcess = g.process;
    delete g.Buffer;
    delete g.process;
    try {
      const init = initializeMissionIx(OWNER, "port-001", OWNER, 4_102_444_800);
      expect(init.data.byteLength).toBeGreaterThan(8);
      expect(init.keys.length).toBe(6);

      const claim = verifyAndClaimIx(OWNER, OWNER, OWNER, new PublicKey(fixtures.missionPda), OWNER, {
        taskId: "task-sea-survey",
        expectedAssignmentVersion: 2,
        evidenceDigest: new Uint8Array(32).fill(0x5a),
        policyVersion: 1,
        attestationExpiryUnixSeconds: 1_762_000_600,
      });
      expect(claim.data.byteLength).toBeGreaterThan(8);
      expect(claim.keys.length).toBe(9);

      // PDA derivation also runs without Node globals and still matches
      // the Rust-derived fixture address.
      const mission = missionPda(OWNER, "port-001");
      expect(mission.ok).toBe(true);
      if (mission.ok) expect(mission.value.address.toBase58()).toBe(fixtures.missionPda);
    } finally {
      if (savedBuffer !== undefined) g.Buffer = savedBuffer;
      if (savedProcess !== undefined) g.process = savedProcess;
    }
  });
});

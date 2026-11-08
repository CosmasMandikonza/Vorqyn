/**
 * VQ-12 local-validator end-to-end run (issue #13 DoD evidence).
 *
 * SKIPPED unless E2E_VALIDATOR=1 and VORQYN_TEST_REGISTRY_ADMIN_KEYPAIR
 * are set (CI has no validator service). Runs the FULL mission flow
 * through @vorqyn/chain-client against a locally running
 * solana-test-validator with the actual compiled program, decoding every
 * account after each step and recording real transaction signatures.
 *
 * Prereqs (from the escrow worktree):
 *   solana-test-validator --bpf-program ChqJne5i8L5rZebCJrRde1wx76czKuSHpZJTKNkSNAGL \
 *     <escrow-worktree>/programs/vorqyn/target/deploy/vorqyn.so --quiet
 * The .so must be built with VORQYN_REGISTRY_ADMIN=$(solana-keygen pubkey
 * <admin.json>) and VORQYN_TEST_REGISTRY_ADMIN_KEYPAIR must point at the
 * same file for this script (see the escrow CI job).
 *
 * Usage: node scripts/local-validator-e2e.mjs <path-to-admin-keypair.json>
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  assignTaskIx,
  authorizeReassignmentIx,
  closeMissionIx,
  createTaskIx,
  decodeMission,
  decodeTask,
  decodeVerifierRegistry,
  explorerTxUrl,
  fundMissionIx,
  initializeMissionIx,
  initializeVerifierRegistryIx,
  missionAddresses,
  registryPda,
  registerVerifierIx,
  toChainAttestationExpirySeconds,
  verifyAndClaimIx,
} from "../src/index.ts";

const gate = process.env.E2E_VALIDATOR === "1" && process.env.VORQYN_TEST_REGISTRY_ADMIN_KEYPAIR !== undefined;

describe.skipIf(!gate)("VQ-12 local-validator end-to-end (real program, real RPC)", () => {
  it("runs the full mission lifecycle with read-backs and real signatures", async () => {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const adminPath = process.env.VORQYN_TEST_REGISTRY_ADMIN_KEYPAIR;
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(adminPath!, "utf8"))));
  const owner = Keypair.generate();
  const verifier = Keypair.generate();
  const operator = Keypair.generate();
  const replacement = Keypair.generate();

  const sent = [];
  async function sendIx(payer, ix, label, extraSigners = []) {
    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(connection, tx, [payer, ...extraSigners]);
    sent.push({ label, signature, explorer: explorerTxUrl(signature, "localnet") });
    console.log(`✓ ${label}: ${signature}`);
    return signature;
  }
  async function airdrop(kp, sol) {
    await connection.confirmTransaction(await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL), "confirmed");
  }

  console.log("== VQ-12 local-validator E2E (real program, real RPC) ==");
  for (const kp of [admin, owner, verifier, operator, replacement]) await airdrop(kp, 20);

  // 0. registry bootstrap + verifier registration (deploy-time admin)
  await sendIx(admin, initializeVerifierRegistryIx(admin.publicKey, { policyVersion: 1 }), "initialize_verifier_registry");
  await sendIx(admin, registerVerifierIx(admin.publicKey, verifier.publicKey), "register_verifier");
  const reg = decodeVerifierRegistry((await connection.getAccountInfo(registryPda())).data);
  console.log(`  registry: policy=${reg.policyVersion} verifiers=${reg.verifiers.length} admin=${reg.admin.toBase58() === admin.publicKey.toBase58()}`);

  // 1. mission lifecycle
  const expirySec = toChainAttestationExpirySeconds(Date.now() + 24 * 3600 * 1000);
  await sendIx(owner, initializeMissionIx(owner.publicKey, "port-001", verifier.publicKey, expirySec), "initialize_mission");
  const addrs = missionAddresses(owner.publicKey, "port-001", ["task-sea-survey"]);
  if (!addrs.ok) throw new Error(addrs.error.message);
  await sendIx(owner, fundMissionIx(owner.publicKey, addrs.value.mission, 3 * LAMPORTS_PER_SOL), "fund_mission(3 SOL)");
  await sendIx(owner, createTaskIx(owner.publicKey, addrs.value.mission, { taskId: "task-sea-survey", taskKind: "Sea", budgetLamports: LAMPORTS_PER_SOL }), "create_task(1 SOL)");
  await sendIx(owner, assignTaskIx(owner.publicKey, addrs.value.mission, { taskId: "task-sea-survey", operator: operator.publicKey, rewardLamports: 400_000_000 }), "assign_task(v1, 0.4)");

  let mission = decodeMission((await connection.getAccountInfo(addrs.value.mission)).data);
  console.log(`  mission: funded=${mission.fundedLamports} reserved=${mission.reservedLamports} remaining=${mission.remainingLamports} status=${mission.status}`);

  // 2. reassignment (the flagship recovery)
  await sendIx(owner, authorizeReassignmentIx(owner.publicKey, addrs.value.mission, { taskId: "task-sea-survey", expectedAssignmentVersion: 1, newOperator: replacement.publicKey, rewardLamports: 900_000_000 }), "authorize_reassignment(v1→v2, 0.9)");
  let task = decodeTask((await connection.getAccountInfo(addrs.value.tasks[0].address)).data);
  console.log(`  task: version=${task.currentAssignmentVersion} operator=${task.currentOperator?.toBase58() === replacement.publicKey.toBase58() ? "replacement" : "WRONG"} reward=${task.rewardLamports}`);

  // 3. verifier-authorized claim (digest = 32 bytes of 0x5a fixture)
  const attestationSec = toChainAttestationExpirySeconds(Date.now() + 60_000);
  await sendIx(owner, verifyAndClaimIx(owner.publicKey, verifier.publicKey, owner.publicKey, addrs.value.mission, replacement.publicKey, {
    taskId: "task-sea-survey",
    expectedAssignmentVersion: 2,
    evidenceDigest: new Uint8Array(32).fill(0x5a),
    policyVersion: 1,
    attestationExpiryUnixSeconds: attestationSec,
  }), "verify_and_claim(v2)", [verifier]);
  task = decodeTask((await connection.getAccountInfo(addrs.value.tasks[0].address)).data);
  const replacementSol = (await connection.getBalance(replacement.publicKey)) / LAMPORTS_PER_SOL;
  console.log(`  task after claim: status=${task.status} paidVersion=${task.paidVersion} digestSet=${task.evidenceDigest !== null}`);
  console.log(`  replacement wallet: ${replacementSol.toFixed(4)} SOL (airdrop 20 + 0.9 reward)`);

  // 4. close
  await sendIx(owner, closeMissionIx(owner.publicKey, addrs.value.mission), "close_mission");
  mission = decodeMission((await connection.getAccountInfo(addrs.value.mission)).data);
  const ownerSol = (await connection.getBalance(owner.publicKey)) / LAMPORTS_PER_SOL;
  console.log(`  mission after close: status=${mission.status} funded=${mission.fundedLamports}`);
  console.log(`  owner wallet: ${ownerSol.toFixed(4)} SOL`);

  console.log("\n== signatures (LOCALNET — no devnet claim) ==");
  for (const s of sent) console.log(`${s.label}\n  ${s.signature}\n  ${s.explorer}`);
    expect(sent.length).toBe(9); // registry(2) + mission flow(7)
  }, 120_000);
});

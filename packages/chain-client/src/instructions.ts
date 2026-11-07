/**
 * Typed instruction builders (VQ-12 / #13).
 *
 * Instruction data = sha256("global:<snake_name>")[:8] + borsh(args) —
 * the Anchor wire format. The discriminators are verified end-to-end by
 * the local-validator run (a wrong discriminator fails the on-chain
 * instruction), not merely self-consistently computed here.
 */

import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { registryPda, missionPda, taskPda, vaultPda } from "./pdas";
import { PROGRAM_ID } from "./config";

function ixDiscriminator(name: string): Uint8Array {
  return createHash("sha256").update(`global:${name}`, "utf8").digest().subarray(0, 8);
}

// --- borsh writers ---------------------------------------------------------

class Writer {
  readonly parts: Uint8Array[] = [];
  u8(v: number): void { this.parts.push(new Uint8Array([v & 0xff])); }
  u64(v: bigint | number): void {
    const n = BigInt(v);
    if (n < 0n || n > 0xffff_ffff_ffff_ffffn) throw new Error("u64 out of range");
    const out = new Uint8Array(8);
    let x = n;
    for (let i = 0; i < 8; i += 1) { out[i] = Number(x & 0xffn); x >>= 8n; }
    this.parts.push(out);
  }
  pubkey(p: PublicKey): void { this.parts.push(p.toBytes()); }
  string(s: string): void {
    const bytes = new TextEncoder().encode(s);
    // Borsh string length is u32 LE.
    if (bytes.length > 0xffff_ffff) throw new Error("string too long");
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, true);
    this.parts.push(len);
    this.parts.push(bytes);
  }
  bytes32(b: Uint8Array): void {
    if (b.length !== 32) throw new Error("expected 32 bytes");
    this.parts.push(b);
  }
  finish(disc: Uint8Array): Uint8Array {
    const total = disc.length + this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    out.set(disc, 0);
    let off = disc.length;
    for (const p of this.parts) { out.set(p, off); off += p.length; }
    return out;
  }
}

function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

// --- mission flow ----------------------------------------------------------

export interface InitializeVerifierRegistryArgs { policyVersion: number }

export function initializeVerifierRegistryIx(
  payer: PublicKey,
  args: InitializeVerifierRegistryArgs,
): TransactionInstruction {
  const w = new Writer();
  w.u64(args.policyVersion);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(registryPda(), false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.from(w.finish(ixDiscriminator("initialize_verifier_registry"))),
  });
}

export function registerVerifierIx(admin: PublicKey, verifier: PublicKey): TransactionInstruction {
  const w = new Writer();
  w.pubkey(verifier);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(registryPda(), false, true),
    ],
    data: Buffer.from(w.finish(ixDiscriminator("register_verifier"))),
  });
}

export function revokeVerifierIx(admin: PublicKey, verifier: PublicKey): TransactionInstruction {
  const w = new Writer();
  w.pubkey(verifier);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(registryPda(), false, true),
    ],
    data: Buffer.from(w.finish(ixDiscriminator("revoke_verifier"))),
  });
}

export function setPolicyVersionIx(admin: PublicKey, policyVersion: number): TransactionInstruction {
  const w = new Writer();
  w.u64(policyVersion);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(admin, true, true),
      meta(registryPda(), false, true),
    ],
    data: Buffer.from(w.finish(ixDiscriminator("set_policy_version"))),
  });
}

export function initializeMissionIx(
  owner: PublicKey,
  missionId: string,
  verifierAuthority: PublicKey,
  expiryUnixSeconds: number,
): TransactionInstruction {
  const mission = missionPda(owner, missionId);
  if (!mission.ok) throw new Error(mission.error.message);
  const w = new Writer();
  w.string(missionId);
  w.pubkey(verifierAuthority);
  w.u64(0); // i64 expiry, positive-only via u64 writer
  const data = w.finish(ixDiscriminator("initialize_mission"));
  // expiry is i64 — rewrite the last 8 bytes as signed LE (all our values fit)
  const exp = BigInt(expiryUnixSeconds);
  if (exp < 0n) throw new Error("expiry must be non-negative unix seconds");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigInt64(data.length - 8, exp, true);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner, true, true),
      meta(registryPda(), false, false),
      meta(mission.value.address, false, true),
      meta(vaultPda(mission.value.address), false, true),
      meta(SystemProgram.programId, false, false),
      meta(SYSVAR_CLOCK_PUBKEY, false, false),
    ],
    data: Buffer.from(data),
  });
}

export function fundMissionIx(owner: PublicKey, missionAddress: PublicKey, amountLamports: number): TransactionInstruction {
  const w = new Writer();
  w.u64(amountLamports);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner, true, true),
      meta(missionAddress, false, true),
      meta(vaultPda(missionAddress), false, true),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.from(w.finish(ixDiscriminator("fund_mission"))),
  });
}

export interface CreateTaskArgs { taskId: string; taskKind: "Air" | "Land" | "Sea"; budgetLamports: number }

export function createTaskIx(owner: PublicKey, missionAddress: PublicKey, args: CreateTaskArgs): TransactionInstruction {
  const task = taskPda(missionAddress, args.taskId);
  if (!task.ok) throw new Error(task.error.message);
  const w = new Writer();
  w.string(args.taskId);
  w.u8({ Air: 0, Land: 1, Sea: 2 }[args.taskKind]);
  w.u64(args.budgetLamports);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner, true, true),
      meta(missionAddress, false, true),
      meta(task.value.address, false, true),
      meta(SystemProgram.programId, false, false),
      meta(SYSVAR_CLOCK_PUBKEY, false, false),
    ],
    data: Buffer.from(w.finish(ixDiscriminator("create_task"))),
  });
}

export interface AssignTaskArgs { taskId: string; operator: PublicKey; rewardLamports: number }

export function assignTaskIx(owner: PublicKey, missionAddress: PublicKey, args: AssignTaskArgs): TransactionInstruction {
  const task = taskPda(missionAddress, args.taskId);
  if (!task.ok) throw new Error(task.error.message);
  const w = new Writer();
  w.string(args.taskId);
  w.pubkey(args.operator);
  w.u64(args.rewardLamports);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner, true, true),
      meta(missionAddress, false, true),
      meta(task.value.address, false, true),
      meta(SYSVAR_CLOCK_PUBKEY, false, false),
    ],
    data: Buffer.from(w.finish(ixDiscriminator("assign_task"))),
  });
}

export interface AuthorizeReassignmentArgs { taskId: string; expectedAssignmentVersion: number; newOperator: PublicKey; rewardLamports: number }

export function authorizeReassignmentIx(owner: PublicKey, missionAddress: PublicKey, args: AuthorizeReassignmentArgs): TransactionInstruction {
  const task = taskPda(missionAddress, args.taskId);
  if (!task.ok) throw new Error(task.error.message);
  const w = new Writer();
  w.string(args.taskId);
  w.u64(args.expectedAssignmentVersion);
  w.pubkey(args.newOperator);
  w.u64(args.rewardLamports);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner, true, true),
      meta(missionAddress, false, true),
      meta(task.value.address, false, true),
      meta(SYSVAR_CLOCK_PUBKEY, false, false),
    ],
    data: Buffer.from(w.finish(ixDiscriminator("authorize_reassignment"))),
  });
}

export interface VerifyAndClaimArgs {
  taskId: string;
  expectedAssignmentVersion: number;
  /** 32 raw bytes (hexToBytes of the verifier service's digest). */
  evidenceDigest: Uint8Array;
  policyVersion: number;
  /** Unix SECONDS — use toChainAttestationExpirySeconds(). */
  attestationExpiryUnixSeconds: number;
}

export function verifyAndClaimIx(
  payer: PublicKey,
  verifier: PublicKey,
  missionOwner: PublicKey,
  missionAddress: PublicKey,
  payoutWallet: PublicKey,
  args: VerifyAndClaimArgs,
): TransactionInstruction {
  const task = taskPda(missionAddress, args.taskId);
  if (!task.ok) throw new Error(task.error.message);
  const w = new Writer();
  w.string(args.taskId);
  w.u64(args.expectedAssignmentVersion);
  w.bytes32(args.evidenceDigest);
  w.u64(args.policyVersion);
  w.u64(0);
  const data = w.finish(ixDiscriminator("verify_and_claim"));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigInt64(data.length - 8, BigInt(args.attestationExpiryUnixSeconds), true);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(payer, true, true),
      meta(verifier, true, false),
      meta(missionOwner, false, false),
      meta(missionAddress, false, true),
      meta(registryPda(), false, false),
      meta(task.value.address, false, true),
      meta(vaultPda(missionAddress), false, true),
      meta(payoutWallet, false, true),
      meta(SYSVAR_CLOCK_PUBKEY, false, false),
    ],
    data: Buffer.from(data),
  });
}

export function closeMissionIx(owner: PublicKey, missionAddress: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(owner, true, true),
      meta(missionAddress, false, true),
      meta(vaultPda(missionAddress), false, true),
      meta(SYSVAR_CLOCK_PUBKEY, false, false),
    ],
    data: Buffer.from(ixDiscriminator("close_mission")),
  });
}


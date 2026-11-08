/**
 * Account codecs (VQ-12 / #13) — borsh decoding for the program's fixed
 * account layouts (ACCOUNTS.md §1), verified byte-for-byte against
 * Rust-serialized fixtures.
 */

import { PublicKey } from "@solana/web3.js";

export type MissionStatus = "Active" | "Closed";
export type TaskStatus = "Unassigned" | "Assigned" | "Paid";
export type TaskKind = "Air" | "Land" | "Sea";

export interface MissionAccount {
  readonly owner: PublicKey;
  readonly verifierAuthority: PublicKey;
  readonly missionId: string;
  readonly fundedLamports: bigint;
  readonly remainingLamports: bigint;
  readonly reservedLamports: bigint;
  readonly status: MissionStatus;
  /** Unix seconds; 0 = no expiry. */
  readonly expiry: bigint;
  readonly bump: number;
}

export interface TaskAccount {
  readonly mission: PublicKey;
  readonly taskId: string;
  readonly taskKind: TaskKind;
  readonly budgetLamports: bigint;
  readonly currentAssignmentVersion: bigint;
  readonly currentOperator: PublicKey | null;
  readonly rewardLamports: bigint;
  readonly status: TaskStatus;
  readonly evidenceDigest: Uint8Array | null;
  readonly acceptedVersion: bigint | null;
  readonly paidVersion: bigint | null;
  readonly bump: number;
}

export interface VerifierRegistryAccount {
  readonly admin: PublicKey;
  readonly verifiers: readonly PublicKey[];
  readonly policyVersion: bigint;
  readonly bump: number;
}

// --- borsh primitives ------------------------------------------------------

class Reader {
  private offset = 0;
  constructor(private readonly buf: Uint8Array) {}
  private take(n: number): Uint8Array {
    if (this.offset + n > this.buf.length) throw new Error("account buffer underflow");
    const out = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  u8(): number { return this.take(1)[0] ?? 0; }
  bool(): boolean { return (this.take(1)[0] ?? 0) === 1; }
  u64(): bigint { return this.leBigInt(8, false); }
  i64(): bigint { return this.leBigInt(8, true); }
  private leBigInt(bytes: number, signed: boolean): bigint {
    const b = this.take(bytes);
    let v = 0n;
    for (let i = bytes - 1; i >= 0; i -= 1) v = (v << 8n) | BigInt(b[i] ?? 0);
    if (signed && (b[bytes - 1] ?? 0) & 0x80) v -= 1n << BigInt(bytes * 8);
    return v;
  }
  pubkey(): PublicKey { return new PublicKey(this.take(32)); }
  option<T>(read: () => T): T | null { return this.bool() ? read() : null; }
  /** Borsh string length is u32 (not u64). */
  string(): string {
    const len = this.take(4).reduce((acc, b, i) => acc + b * 2 ** (8 * i), 0);
    return new TextDecoder().decode(this.take(len));
  }
  vec<T>(read: () => T): T[] {
    const len = this.take(4).reduce((acc, b, i) => acc + b * 2 ** (8 * i), 0);
    const out: T[] = [];
    for (let i = 0; i < len; i += 1) out.push(read());
    return out;
  }
  fixedBytes(n: number): Uint8Array { return this.take(n); }
  rest(): Uint8Array { return this.buf.subarray(this.offset); }
}

function samePrefix(a: Uint8Array, b: Uint8Array): boolean {
  return b.length <= a.length && b.every((byte, i) => a[i] === byte);
}

/** sha256("<type>")[:8] account discriminator prefixes (Anchor). */
export const ACCOUNT_DISCRIMINATORS = {
  mission: new Uint8Array([0xaa, 0x38, 0x74, 0x4b, 0x18, 0x0b, 0x6d, 0x0c]),
  task: new Uint8Array([0x4f, 0x22, 0xe5, 0x37, 0x58, 0x5a, 0x37, 0x54]),
  verifierRegistry: new Uint8Array([0x15, 0xdb, 0xa8, 0x87, 0x33, 0xb6, 0x58, 0x81]),
} as const;

/** Decode a Mission account (raw data incl. discriminator). */
export function decodeMission(data: Uint8Array): MissionAccount {
  if (!samePrefix(data, ACCOUNT_DISCRIMINATORS.mission))
    throw new Error("not a Mission account (discriminator mismatch)");
  const r = new Reader(data.subarray(8));
  // Borsh: fields in declaration order (ACCOUNTS.md §1).
  const owner = r.pubkey();
  const verifierAuthority = r.pubkey();
  const missionId = r.string();
  const fundedLamports = r.u64();
  const remainingLamports = r.u64();
  const reservedLamports = r.u64();
  const statusByte = r.u8();
  const expiry = r.i64();
  const bump = r.u8();
  return {
    owner,
    verifierAuthority,
    missionId,
    fundedLamports,
    remainingLamports,
    reservedLamports,
    status: statusByte === 0 ? "Active" : statusByte === 1 ? "Closed" : `Unknown(${statusByte})` as MissionStatus,
    expiry,
    bump,
  };
}

/** Decode a Task account (raw data incl. discriminator). */
export function decodeTask(data: Uint8Array): TaskAccount {
  if (!samePrefix(data, ACCOUNT_DISCRIMINATORS.task))
    throw new Error("not a Task account (discriminator mismatch)");
  const r = new Reader(data.subarray(8));
  const mission = r.pubkey();
  const taskId = r.string();
  const kind = r.u8();
  return {
    mission,
    taskId,
    taskKind: kind === 0 ? "Air" : kind === 1 ? "Land" : kind === 2 ? "Sea" : `Unknown(${kind})` as TaskKind,
    budgetLamports: r.u64(),
    currentAssignmentVersion: r.u64(),
    currentOperator: r.option(() => r.pubkey()),
    rewardLamports: r.u64(),
    status: (() => {
      const s = r.u8();
      return s === 0 ? "Unassigned" : s === 1 ? "Assigned" : s === 2 ? "Paid" : `Unknown(${s})` as TaskStatus;
    })(),
    evidenceDigest: r.option(() => r.fixedBytes(32)),
    acceptedVersion: r.option(() => r.u64()),
    paidVersion: r.option(() => r.u64()),
    bump: r.u8(),
  };
}

/** Decode the global VerifierRegistry account. */
export function decodeVerifierRegistry(data: Uint8Array): VerifierRegistryAccount {
  if (!samePrefix(data, ACCOUNT_DISCRIMINATORS.verifierRegistry))
    throw new Error("not a VerifierRegistry account (discriminator mismatch)");
  const r = new Reader(data.subarray(8));
  return {
    admin: r.pubkey(),
    verifiers: r.vec(() => r.pubkey()),
    policyVersion: r.u64(),
    bump: r.u8(),
  };
}

/** Hex helpers for digests (matches the verifier service's hex strings). */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("expected 64 lowercase hex chars");
  return new Uint8Array(hex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)));
}

/**
 * VORQYN chain client — PDA derivation (VQ-12 / #13).
 *
 * Seeds are the frozen CHAIN_SEAM §4 contract, cross-verified against
 * Rust-computed fixtures (see fixtures.ts): web3.js and the Anchor
 * program derive byte-identical addresses.
 */

import { PublicKey } from "@solana/web3.js";
import { asMissionId, asTaskId, ok, type Result } from "@vorqyn/contracts";
import { PROGRAM_ID } from "./config";

export const MISSION_SEED = "vorqyn:mission";
export const TASK_SEED = "vorqyn:task";
export const VAULT_SEED = "vorqyn:vault";
export const REGISTRY_SEED = "vorqyn:verifier-registry";

export interface MissionPda {
  readonly address: PublicKey;
  readonly bump: number;
}

/** [vorqyn:mission, owner, mission_id] — owner-scoped mission account. */
export function missionPda(owner: PublicKey, missionId: string): Result<MissionPda> {
  const id = asMissionId(missionId);
  if (!id.ok) return id;
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(MISSION_SEED, "utf8"), owner.toBuffer(), Buffer.from(missionId, "utf8")],
    PROGRAM_ID,
  );
  return ok({ address, bump });
}

/** [vorqyn:task, mission_pda, task_id]. */
export function taskPda(mission: PublicKey, taskId: string): Result<MissionPda> {
  const id = asTaskId(taskId);
  if (!id.ok) return id;
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(TASK_SEED, "utf8"), mission.toBuffer(), Buffer.from(taskId, "utf8")],
    PROGRAM_ID,
  );
  return ok({ address, bump });
}

/** [vorqyn:vault, mission_pda] — program-owned escrow vault. */
export function vaultPda(mission: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED, "utf8"), mission.toBuffer()],
    PROGRAM_ID,
  )[0];
}

/** [vorqyn:verifier-registry] — the single global registry PDA. */
export function registryPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(REGISTRY_SEED, "utf8")], PROGRAM_ID)[0];
}

/** Derive every address a mission flow needs, failing closed on bad IDs. */
export function missionAddresses(
  owner: PublicKey,
  missionId: string,
  taskIds: readonly string[] = [],
): Result<{ mission: PublicKey; vault: PublicKey; tasks: readonly { taskId: string; address: PublicKey }[] }> {
  const mission = missionPda(owner, missionId);
  if (!mission.ok) return mission;
  const tasks: { taskId: string; address: PublicKey }[] = [];
  for (const taskId of taskIds) {
    const task = taskPda(mission.value.address, taskId);
    if (!task.ok) return task;
    tasks.push({ taskId, address: task.value.address });
  }
  return ok({
    mission: mission.value.address,
    vault: vaultPda(mission.value.address),
    tasks,
  });
}

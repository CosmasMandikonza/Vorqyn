# Devnet Deployment Runbook — VORQYN Mission Escrow Program

> Status: **PREPARATION** — this runbook is committed with the config PR;
> actual deployment evidence lands here after Phase C–E execute.
> No devnet claim is made until signatures are recorded below.

## Program identity

| Field | Value |
|---|---|
| Program ID | `ChqJne5i8L5rZebCJrRde1wx76czKuSHpZJTKNkSNAGL` |
| Keypair location | `~/vorqyn-keys/vorqyn-devnet-program.json` (Lane 1 deployer only) |
| Backup | Encrypted Seahorse entry (GPG AES-256, round-trip verified) |
| Upgrade authority | Deployer wallet (upgradeable during hackathon) |
| Build-time admin | `VORQYN_REGISTRY_ADMIN` — **pending B1 designation** |

## Implementation status (honest — what exists vs. what is planned)

| Procedure | Status | What exists today |
|---|---|---|
| Local-validator E2E (all 9 instructions + financial assertions) | **EXECUTABLE** ✓ | `packages/chain-client/scripts/local-validator-e2e.test.ts` — gated (`E2E_VALIDATOR=1`), just verified against the NEW program ID |
| Devnet registry bootstrap (Phase D) | **DOCUMENTED ONLY** — no script yet | The runbook below describes the procedure; an executable script must be written before Phase C execution |
| Resumable mission-flow runner (Phase E) | **DOCUMENTED ONLY** — no script yet | The runbook below describes the design (state file + on-chain reconciliation); an executable script must be written before Phase C execution |
| Deployment commands (Phase C) | **DOCUMENTED** — standard `solana program deploy` | No wrapper needed; the runbook lists the exact commands to run manually |

These scripts are deliberately NOT in this PR — they are operational tooling
that should be written and tested against the deployed devnet program, not
committed blind. They land in Phase C/D.

## Prerequisites checklist (before Phase C)

- [ ] This PR merged (config approved)
- [ ] B1: Registry admin identity designated + acknowledged by Cosmas
- [ ] B2: Verifier identity holder decided
- [ ] B3: Deploy GO from Cosmas
- [ ] Devnet wallets funded (see cost table below)
- [ ] Final .so built with `VORQYN_REGISTRY_ADMIN=<real-admin-pubkey>`

## Cost table (rent-exempt minimums, CLI-verified)

| Item | Size | SOL |
|---|---|---|
| Program data account | ~272,336 B | ~1.384 |
| Deploy buffer (transient) | same | ~1.384 (returned) |
| Registry PDA | 309 B | 0.00222 |
| Mission PDA (per demo run) | 150 B | 0.00141 |
| Task PDA (per task) | 194 B | 0.00164 |
| Vault PDA (0 B data) | 0 B | 0.00065 (GC'd on close) |
| Fees (~15 sigs × 5k lamports) | — | ~0.00008 |

**Funding: deployer ≥ 4 SOL** (peak program+buffer); **registry admin ≥ 0.01 SOL**;
**demo owner ≥ 3 SOL** (escrow principal, round-trips).

## Phase C — Deploy the program

```bash
# 1. Checkout the approved merged commit
git checkout <approved-SHA>
cd programs/vorqyn

# 2. Final build with the REAL registry admin
VORQYN_REGISTRY_ADMIN=<admin-pubkey-from-B1> cargo build-sbf

# 3. Deploy to devnet
solana config set --url devnet
solana config set --keypair ~/vorqyn-keys/vorqyn-devnet-deployer.json
solana airdrop 4  # (repeat if rate-limited)
solana program deploy \
  --program-id ~/vorqyn-keys/vorqyn-devnet-program.json \
  target/deploy/vorqyn.so

# Expected output:
#   Program Id: ChqJne5i8L5rZebCJrRde1wx76czKuSHpZJTKNkSNAGL
#
# Verify:
solana program show ChqJne5i8L5rZebCJrRde1wx76czKuSHpZJTKNkSNAGL
#   → owner: BPFLoaderUpgradeab1e, data len: ..., authority: <deployer>
```

## Phase D — Registry bootstrap (ONE-TIME, admin-signed)

**Idempotent**: reads the registry PDA FIRST; skips everything if it already
exists. Never sends a second `initialize_verifier_registry`.

```bash
# 1. Fund the ADMIN wallet (it pays the registry's rent)
solana airdrop 0.01 <admin-pubkey>

# 2. Bootstrap — signed by the ADMIN keypair, NOT the deployer
#    (the program enforces payer == compiled-in admin)
solana config set --keypair ~/vorqyn-keys/vorqyn-registry-admin.json
# → run the bootstrap script (reads registry PDA; if absent: init + register verifier)

# 3. Verify
solana account <registry-pda> --output json
#   → parse: admin == <admin-pubkey>, policy_version == 1, verifiers.length == 1
```

## Phase E — Resumable mission-flow E2E

**Genuinely resumable**: state file at `target/devnet-runs/<missionId>.state.json`
persists mission ID, wallet refs, per-step signatures and lifecycle state.
On restart: reconcile from on-chain state; a new mission ID is minted ONLY
when the chain proves the first instruction never landed AND no signature
is pending. An RPC timeout alone NEVER restarts with a fresh ID.

```bash
# Each run uses a unique mission ID: port-demo-<unix-timestamp>
# Steps: init → fund → create_task → assign → reassign → claim → close
# All financial assertions from the local E2E apply.
# Explorer links recorded for every signature.
```

## Recovery procedures

| Scenario | Procedure |
|---|---|
| Key file lost | Seahorse entry → paste blob to file → `gpg --decrypt` → `chmod 600` → verify `sha256sum` = `0047d5bb…` + `solana-keygen pubkey` = `ChqJne5…` |
| Deploy interrupted | Buffer may exist → `solana program close <buffer>` → retry deploy |
| Registry exists on retry | Bootstrap script detects + reports + exits 0 (idempotent) |
| Mission run crashed mid-flow | State file + on-chain read-back → resume from last confirmed step |
| Upgrade needed | `solana program deploy --program-id <same-keypair> <new.so>` (same address) |

## Evidence to record (issue #17)

After Phase C–E complete:
- [ ] Deploy transaction signature + explorer link
- [ ] Program account read-back (owner, data len, authority)
- [ ] Registry bootstrap signature + account read-back
- [ ] Verifier registration signature
- [ ] All mission-flow signatures + account read-backs
- [ ] Exact source SHA deployed from
- [ ] Wallet pubkeys used (public info only)

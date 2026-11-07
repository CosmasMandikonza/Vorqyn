# VORQYN escrow — account layout, invariants and build/deploy notes (VQ-04)

> Status: implemented and tested with **LiteSVM simulated execution**
> (15 integration tests + 3 unit tests). **No devnet deployment has been
> performed and none is claimed.** Interface alignment:
> `packages/contracts/CHAIN_SEAM.md` (DRAFT agreement with the VQ-01 owner).

## 1. Accounts

### Mission (PDA, program-owned)

- Seeds: `["vorqyn:mission", owner_pubkey, mission_id_utf8]` (CHAIN_SEAM §4)
- Space: `8 + Mission::INIT_SPACE` (142 bytes of data)
- Fields: `owner`, `verifier_authority` (stored now, consumed by VQ-06),
  `mission_id` (ASCII 3..=32, `[a-z0-9-]`, first byte `[a-z0-9]` — enforced
  in-program), `funded_lamports`, `remaining_lamports`, `reserved_lamports`,
  `status` (`Active`; `Closed` lands with refunds), `expiry` (unix ts; 0 =
  none), `bump`.

### Escrow vault (PDA, program-owned, zero data)

- Seeds: `["vorqyn:vault", mission_pda]`
- Created by `initialize_mission` via Anchor `init` on an `UncheckedAccount`
  — Anchor assigns ownership to the program (standard escrow pattern: only
  program instructions can move funds out, via PDA seeds). All later
  contexts constrain it by seeds+bump and require it `mut` only in
  `fund_mission`.

### Task (PDA, program-owned)

- Seeds: `["vorqyn:task", mission_pda, task_id_utf8]`
- Space: `8 + Task::INIT_SPACE` (186 bytes of data, including the
  VQ-05/VQ-06-reserved `evidence_digest`/`accepted_version`/`paid_version`
  fields — zero-valued now so the layout never migrates)
- Fields: `mission`, `task_id` (same charset rule), `task_kind`
  (Air/Land/Sea), `budget_lamports`, `current_assignment_version`
  (**0 = unassigned, 1 on first assignment** — identical semantics to the
  contracts reducer), `current_operator: Option<Pubkey>` (payout wallet,
  CHAIN_SEAM §3), `reward_lamports`, `status`, `bump`.

## 2. Instructions (VQ-04 scope)

| Instruction | Signer | Key constraints |
| --- | --- | --- |
| `initialize_mission(mission_id, verifier_authority, expiry)` | owner (payer) | ID rule; expiry 0 or future (Clock); mission+vault PDAs created |
| `fund_mission(amount)` | owner | amount > 0; mission seeds+`has_one = owner`; vault delta verified == amount after CPI; ledger credited via checked `credit_funding` |
| `create_task(task_id, task_kind, budget_lamports)` | owner | ID rule; not expired; budget ≤ `remaining_lamports`; full budget reserved atomically; task PDA uniqueness makes duplicate IDs impossible |
| `assign_task(task_id, operator, reward_lamports)` | owner | not expired; task `Unassigned` (double-assign rejected — reassignment is VQ-05); reward ≤ task budget; `budget - reward` released back to remaining; version 0 → 1 |

**Explicitly out of scope (later issues):** `authorize_reassignment`
(VQ-05), `verify_and_claim` payout, AI delegate authority, close/refund
transfers.

## 3. Accounting invariants (all enforced with checked arithmetic)

- `reserved + remaining == funded` after every instruction (asserted in
  tests after each step).
- `funded_lamports` only ever increases through `fund_mission`, and only
  after the vault's actual lamport delta equals the amount.
- Task creation reserves the FULL budget; assignment shrinks the
  reservation to the agreed reward and returns the difference to
  `remaining`.
- Overflow: every arithmetic op is `checked_*` with `VorqynError::Overflow`.
  The u64 boundary is unit-tested via the pure `credit_funding` helper
  (`funding_ledger_overflows_are_rejected`); LiteSVM cannot provision
  near-`u64::MAX` balances, so the boundary is not re-exercised on-chain in
  tests.

## 4. Close/refund policy (chosen, implementation deferred)

Per SOLANA_PROTOCOL.md §4.6: `close_mission` will be implementable only
when no task holds a reservation (`reserved == 0`) or after expiry; refunds
go to `mission.owner` (a PDA-signed system transfer — never a
caller-supplied destination), idempotent or explicitly rejecting repeats.
No such instruction exists in VQ-04; funds can only ENTER the vault today.

## 5. Events

`MissionInitialized`, `MissionFunded`, `TaskCreated`, `TaskAssigned` —
emitted for the future TS client (VQ-12) and mirrored field-for-field with
CHAIN_SEAM §6 receipt semantics.

## 6. Build, test, deploy prerequisites

```bash
# Toolchain (see rust-toolchain.toml): Rust 1.98.1 (tests; the program
# itself compiles under the Anchor MSRV 1.89.0 — `cargo +1.89.0 check`).
# Agave CLI (cargo-build-sbf): https://release.anza.xyz/stable/install
cd programs/vorqyn
cargo build-sbf          # produces ../../target/deploy/vorqyn.so
cargo test               # 3 unit + 15 LiteSVM integration tests
cargo fmt --check && cargo clippy --all-targets -- -D warnings
```

- **Program id** `AHXUZz3HsnPjtUGdeg1VB4uyHN2WtVpkrQ2ZKgzX49dc` is a
  throwaway placeholder — **no keypair exists or is committed**. At devnet
  deployment time (later issue): `anchor keys generate` + `anchor keys
  sync` replace it in `declare_id!` and `Anchor.toml`. No secrets belong in
  this repo.
- **LiteSVM ≠ devnet.** All test results here are simulated local
  execution; no transaction signature in the test logs references any
  cluster.
- The Cargo.lock in this crate pins the Anchor 1.2 litesvm-template
  dependency graph (agave 4.1.x family); do not regenerate it casually —
  newer agave 4.4 crates currently fail to compile litesvm 0.15.

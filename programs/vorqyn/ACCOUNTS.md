# VORQYN escrow — account layout, invariants and build/deploy notes (VQ-04 + VQ-05 + VQ-06)

> Status: implemented and tested with **LiteSVM simulated execution**
> (39 integration tests + 3 unit tests). **No devnet deployment has been
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
| `assign_task(task_id, operator, reward_lamports)` | owner | not expired; task `Unassigned` (double-assign rejected — reassignment is `authorize_reassignment`); reward ≤ task budget; `budget - reward` released back to remaining; version 0 → 1 |
| `authorize_reassignment(task_id, expected_assignment_version, new_operator, reward_lamports)` (VQ-05) | owner | not expired; task `Assigned` **and** `paid_version` is None; `expected_assignment_version == current_assignment_version` (compare-and-set); `new_operator` ≠ default pubkey; quote ≤ task budget; raise topped up from remaining / cut released back; version +1 atomically; `evidence_digest`+`accepted_version` cleared (old operator's proof eligibility invalidated); emits `TaskReassigned` |
| `verify_and_claim(task_id, expected_assignment_version, evidence_digest, policy_version, attestation_expiry)` (VQ-06) | verifier authority (co-signer; any payer may relay) | mission Active + not expired; attestation window valid; signer == `mission.verifier_authority`; digest non-zero; task `Assigned` + `paid_version` None (TWO independent one-time guards); version CAS (stale proofs from before a reassignment rejected); payout destination is program-controlled == `task.current_operator`; direct checked lamport move vault→operator (program-owned PDA — the system program cannot CPI-debit it); `funded` and `reserved` shrink together; task → `Paid` terminal state; emits `TaskPaid` (recipientWallet etc.) |
| `close_mission()` (VQ-06) | owner | mission Active; `reserved == 0` OR mission expired (expiry/cancellation policy); full vault drain to `mission.owner` via direct lamports (zero-lamport vault GC'd); mission → `Closed` terminal; repeat close and ALL other mission instructions rejected afterwards |

**Explicitly out of scope (later issues):** operator registry,
AI delegate authority. `verify_and_claim` is implemented (VQ-06); the
evidence DIGEST producer is VQ-10 (typed fixture boundary until then).

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

`MissionInitialized`, `MissionFunded`, `TaskCreated`, `TaskAssigned`,
`TaskReassigned`, `TaskPaid`, `MissionClosed` — emitted for the future
TS client (VQ-12) and mirrored field-for-field with CHAIN_SEAM §6
receipt semantics. `TaskReassigned` carries the Finding-D bindings
(`task_id`, new `assignment_version`, `reward_lamports` == receipt
`amountLamports`) plus `new_payout_wallet` (IDL `newPayoutWallet`);
`TaskPaid` carries the same bindings plus `recipient_wallet` (IDL
`recipientWallet`) — together the complete CHAIN_SEAM §8 Q5 answer:
receipts are self-verifying for reassignment AND payout. Byte-exact
emission of both events is asserted in the test suite (discriminator +
borsh payload matched against the program-log base64).

## 5b. Payout & close semantics (VQ-06) — trusted boundary and invariants

- **TRUSTED VERIFIER BOUNDARY:** the chain validates AUTHORIZATION over
  an opaque 32-byte digest co-signed live by `mission
  .verifier_authority`. It does NOT validate physical/sensor truth —
  the verifier authority owns that responsibility. The digest producer
  is VQ-10; until it lands, digests are a typed fixture boundary.
- **Live co-signing beats replayable attestations:** the verifier signs
  the exact transaction (task, version, digest, policy, window), so an
  approval cannot be replayed against another task or a later version;
  the CAS on `expected_assignment_version` independently rejects proofs
  from before a reassignment (stale ROV A proof → ROV B threat).
- **One-time payout, defense in depth:** duplicates are rejected by TWO
  independently sufficient guards (`TaskStatus::Paid` and
  `paid_version`). Mutation checks confirm removing either single
  guard still rejects repeats; both set atomically after the transfer.
- **Money movement:** the vault is a program-owned PDA, so payouts and
  refunds use direct checked lamport moves (the system program refuses
  to CPI-debit non-system accounts — `ExternalAccountLamportSpend`).
  `funded`/`reserved` shrink together on payout, preserving
  `reserved + remaining == funded`; the vault always stays
  rent-exempt. Close drains to zero and the vault account is GC'd.
- **Claims after mission expiry are rejected** (SOLANA_PROTOCOL §6);
  **close after expiry is the release path** — it refunds everything
  including unclaimed reservations (documented expiry/cancellation
  policy). Claims and every other instruction are rejected on Closed
  missions.

## 5a. Reassignment semantics (VQ-05) — what the chain does and does NOT decide

- **Eligibility (on-chain subset):** `status == Assigned` and
  `paid_version.is_none()`. This is the money/authority layer only.
  The mission-workflow layer (only `evidence_insufficient` /
  `recovery_pending` tasks may be reassigned) stays in the contracts
  reducer — the two layers compose, they do not duplicate.
- **Failed/partial/paid task states:** do not exist on chain yet. When
  VQ-06 adds them, the single allowlist line in
  `authorize_reassignment` (`task.status == TaskStatus::Assigned`) is
  the only place to extend; the guard on `paid_version` already
  enforces "already-paid task cannot be reassigned"
  (SOLANA_PROTOCOL §5) for the paid end-state (regression-tested by
  forging a paid account through LiteSVM `set_account`).
- **Old-operator invalidation:** `current_operator` is replaced and
  `evidence_digest`/`accepted_version` are cleared. VQ-06's
  `verify_and_claim` must ADDITIONALLY require
  `accepted_version == Some(current_assignment_version)` at claim time,
  so a stale proof from before a reassignment can never pay
  (belt-and-suspenders with the clearing here).
- **Operator identity:** the chain takes the payout wallet `Pubkey`
  only (CHAIN_SEAM §3) and rejects the zero pubkey. Eligibility vs the
  `OperatorRegistration` registry, capability matching and
  new==old equality remain off-chain policy (registry integration is
  the documented VQ-03/VQ-04 dependency; issue #6 assigns those
  rejections to deterministic off-chain policy).
- **Delegate path (deferred):** issue #6 marks the mission-scoped,
  capped, revocable delegate as optional. NOT implemented: the
  owner-signed path is the P0 deliverable; delegate scope fields would
  expand the Mission account and are deferred with explicit sign-off.

## 6. Build, test, deploy prerequisites

```bash
# Toolchain (see rust-toolchain.toml): Rust 1.98.1 (tests; the program
# itself compiles under the Anchor MSRV 1.89.0 — `cargo +1.89.0 check`).
# Agave CLI (cargo-build-sbf): https://release.anza.xyz/stable/install
cd programs/vorqyn
cargo build-sbf          # produces target/deploy/vorqyn.so (crate-local)
cargo test               # 3 unit + 39 LiteSVM integration tests
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

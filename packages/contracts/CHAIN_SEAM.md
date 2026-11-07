# CHAIN_SEAM — proposed VQ-01 ↔ VQ-04 interface agreement (DRAFT)

> **Status: PROPOSAL — NOT FROZEN.** Written by the VQ-01 contracts owner
> (Lane 1 / Agent A) per the Issue #5 kickoff requirement. The VQ-04 escrow
> owner (Agent B) must review and agree before any of the blockchain-binding
> sections below are treated as final. Disagreements go back into this file
> via PR comment, not silent divergence. Non-chain sections (§1, §7) are
> VQ-01 scope and freeze with this PR.

## 1. What VQ-01 freezes now (non-chain)

- Entity ID lexical rule: `^[a-z0-9][a-z0-9-]{2,31}$` (lowercase ASCII, 3–32 chars).
- Money: non-negative integer lamports, `Number.isSafeInteger` ceiling
  (`MAX_SAFE_LAMPORTS` = 2^53-1 ≈ 9,007,199 SOL — far above hackathon scale).
  No floats, no SOL decimals in business logic; formatting happens at the UI.
- Clocks: three independent integer-millisecond domains —
  `occurredAtMs`/`observedAtMs` (service wall clock), `simulatorTimeMs`
  (scenario clock), `chainTimeMs` (chain confirmation clock; required on
  every confirmed/finalized `chain.transactionUpdated`).
- Event envelope: `eventId, missionId, sequence (gapless, per mission),
  kind, payload, occurredAtMs, observedAtMs, simulatorTimeMs?,
  chainTimeMs?, schemaVersion, commandId?` with `schemaVersion = 1`.
- Task assignment versions start at **1** on first assignment and increment
  by exactly 1 per authorized reassignment. Evidence, verdicts, reassignment
  and payout are all bound to the version they were issued for; the reducer
  rejects stale versions (`stale_assignment_version`).

## 2. Mission/task ID byte encoding (proposed)

Mission and task IDs are ASCII by the §1 rule, so **UTF-8 bytes == ASCII
bytes**, length 3..32. Rust side: `mission_id.as_bytes()` directly, no
normalization, no hashing. This is the entire encoding — keep IDs short and
stable (`port-001`, `task-sea-survey` style).

## 3. Operator identity (proposed)

`operatorId` stays an **opaque lowercase ID** (domain identity). It maps to
a registered payout wallet through `OperatorRegistration { operatorId,
payoutWallet: SolanaPublicKey }` (base58, 32–44 chars, lexical check in
contracts; ed25519 validation in the chain client). The Anchor program
stores/validates `payout_wallet` on the mission/task account and pays that
key — the on-chain authority is the key, never the display ID.

## 4. PDA seed derivation (proposed)

```
mission_pda  = seeds ["vorqyn:mission", owner_pubkey.as_bytes(), mission_id_bytes]
task_pda     = seeds ["vorqyn:task",    mission_pda.as_bytes(),  task_id_bytes]
escrow_vault = seeds ["vorqyn:vault",   mission_pda.as_bytes()]
```

- Tag prefixes are namespaced (`vorqyn:`) to avoid cross-program seed
  collisions; agent B may adjust exact prefixes if Anchor constraints
  require, but the three-level structure (owner key + id bytes / parent PDA
  + id bytes) is what the contracts assume.
- `assignment_version` is NOT a seed — it is an account field compared with
  the instruction's `expected_version` (see §5), so the PDA stays stable
  across reassignments.

## 5. Reassignment & settlement semantics (proposed)

- `authorize_reassignment(expected_version, new_operator, quote)`:
  program rejects when `expected_version != account.current_assignment_version`
  (the same compare-and-set the reducer enforces) and increments atomically.
- `verify_and_claim(evidence_digest, verdict_signature, expected_version)`:
  binds acceptance to `(task, current_assignment_version, assigned operator
  payout_wallet, evidence_digest)`; `evidence_digest` is the 64-hex-char
  SHA-256 already frozen in contracts (`Evidence.digest`).
- Chain client must translate `ChainTxStatus` (§6) from real RPC states —
  contracts never invent a `confirmed` that the chain did not report.
- **Verifier registry (VQ-06 security correction, 2026-11-07):** the
  program now carries a global verifier-registry PDA
  (`["vorqyn:verifier-registry"]`). `initialize_mission` only accepts a
  verifier CURRENTLY registered there (admin-controlled; bootstrap by the
  deploying party), and `verify_and_claim` re-checks registration plus
  requires the claim's `policy_version` to equal the registry's
  authoritative version. Chain clients (VQ-12) must bootstrap the
  registry before the first mission init and surface
  `VerifierNotRegistered`/`PolicyVersionMismatch` as configuration
  errors, not mission failures.

**Operator/wallet chain-binding (final PR #37 review, concern 2 — PROPOSED,
not frozen):** a confirmed reassignment receipt must carry enough
authoritative information to verify WHO the program actually assigned:

- reassignment receipt: `newPayoutWallet` — the payout wallet the program
  enacted for the new operator. The contracts package already accepts,
  validates and stores this field, and the reducer rejects a
  `task.reassignmentAuthorized` whose claimed wallet contradicts it.
  **Proposal: the program emits it (event/IDL account field) so receipts
  become self-verifying; until #5 agrees it remains optional.**
- payout receipt: `recipientWallet` — must equal the assigned operator's
  registered payout wallet (`OperatorRegistration`, §3). On-chain
  enforcement of the recipient is already required by
  SOLANA_PROTOCOL.md §5; emitting the field lets the off-chain ledger
  reconcile it. Full operatorId ↔ wallet mapping enforcement is an
  explicit integration dependency: #5 (program emits both fields) +
  VQ-03/VQ-04 services (operator registry feeding the reducer).

## 6. Transaction receipt shape (proposed — matches `ChainEventRecord`)

```json
{
  "kind": "reassignment",              // funding | reassignment | payout | refund
  "missionId": "port-001",
  "taskId": "task-sea-survey",          // REQUIRED for reassignment/payout
  "assignmentVersion": 2,               // REQUIRED for reassignment/payout
  "transactionSignature": "<base58 87-88 chars>",
  "cluster": "devnet",                  // localnet | devnet | mainnet-beta
  "statusHistory": ["submitted", "confirmed"],
  "submittedAtMs": 1762000008000,
  "confirmedAtMs": 1762000008500,
  "slot": 251000002,
  "amountLamports": 1100000000,         // REQUIRED for funding/reassignment/payout
  "authorizedBy": "owner",              // owner | delegate, reassignments only
  "newPayoutWallet": "<base58>",        // PROPOSED (concern 2): wallet enacted for the new operator (reassignment)
  "recipientWallet": "<base58>"         // PROPOSED (concern 2): payout recipient == assigned operator's wallet (payout)
}
```

`unknown` is a first-class status (RPC timeout), never coerced to
success/failure. Terminal statuses freeze the history. A funding amount is
credited exactly once per transaction, on its FIRST entry into
confirmed/finalized (later progressions such as confirmed→finalized or a
confirmed→unknown→confirmed observation gap never re-credit).

**Strengthened during PR #37 review (Finding D):** `taskId`,
`assignmentVersion` and `amountLamports` are REQUIRED at submission for
`reassignment` and `payout` receipts, and `amountLamports` for `funding` —
the reducer refuses to settle against a receipt that is not explicitly
bound to the current assignment version and exact amount. **Agent B (#5):
the program should emit/require the same fields in its events and IDL.**

## 7. JS ↔ Rust precision rules (frozen in contracts, mirrored on chain)

- Lamports and all timestamps are JSON **numbers** constrained to safe
  integers (≤ 2^53-1). If Agent B ever needs u64 beyond that range, the
  boundary rule becomes "decimal string above MAX_SAFE_LAMPORTS" — flag it
  and we bump `schemaVersion` together; do not improvise per-field.
- Enum wire values are lowercase snake_case strings mapping 1:1 to Rust
  variants (e.g. `TaskStatus::EvidenceInsufficient <-> "evidence_insufficient"`).

## 8. Open questions for Agent B (blockers before IDL freeze)

1. Are the §4 seed prefixes acceptable, or does Anchor constrain them?
2. Should `refund` transactions carry `taskId = null` plus an amount only
   (current assumption), or itemized task refunds?
3. ~~Does the program need `amountLamports` at submission time?~~
   **Resolved by PR #37 review (Finding D): yes — funding, reassignment and
   payout receipts all carry `amountLamports` at submission, and
   reassignment/payout must also carry `taskId` + `assignmentVersion`.**
4. Confirm `operatorId`-opaque + `payout_wallet`-on-chain split (§3).
5. **(Final review, concern 2)** Confirm the program emits
   `newPayoutWallet` on reassignments and `recipientWallet` on payouts so
   receipts can verify the enacted operator (§5). Contracts accept and
   cross-check these fields today; making them REQUIRED is blocked on this
   agreement, as is the operator-registry integration (VQ-03/VQ-04).
   **Resolved by the VQ-05/VQ-06 owner (issues #6/#7 / PRs, 2026-11-07):
   YES for reassignment — `authorize_reassignment` emits
   `TaskReassigned { task_id, assignment_version (new),
   expected_assignment_version, previous_operator, new_payout_wallet
   (IDL `newPayoutWallet`), reward_lamports, reserved_lamports }`; and
   YES for payout — `verify_and_claim` emits `TaskPaid { task_id,
   assignment_version, recipient_wallet (IDL `recipientWallet`),
   amount_lamports, vault_balance_lamports, evidence_digest,
   policy_version }`. Both events carry the Finding-D receipt bindings
   (`taskId`, `assignmentVersion`, `amountLamports`); both are asserted
   byte-exact in the LiteSVM suite. Making the fields REQUIRED in
   contracts validation can now proceed; the operator-registry
   integration remains a VQ-03/VQ-04 dependency.**

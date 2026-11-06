# Solana protocol — mission escrow, scoped reassignment and one-time payout

> **Design spec, not deployed code.** Financial and authorization semantics are P0. Anchor/Rust implementer must reconcile with current SDK/APIs, produce tests and actual devnet signatures. Do not claim Solana validates external physical truth.

## 1. Why Solana changes the product

Three independently owned robot operators are not merely viewers in one company's database. The mission customer locks funds under program rules. An original operator cannot collect the reward if the assigned work fails. A different eligible operator is selected under restricted authorization; the payout rules remain public and program-enforced.

Use **custom Anchor program state + PDAs** for assignment and escrow, rather than a wallet notification or a token/NFT with no mission function. Devnet-only test SOL is adequate; stablecoin support is a future extension.

## 2. Minimum account model

| Account | Conceptual fields |
| --- | --- |
| Mission (PDA, seeds mission + owner + missionId) | owner, authorizedDelegate?, verifierAuthority, nonce/identifier, fundedBudgetLamports, remainingLamports, reservedLamports, missionStatus, expiry, bump |
| Task (PDA, mission + taskId) | taskKind, taskBudgetLamports, currentAssignmentVersion, currentOperator, rewardLamports, status, evidenceDigest?, acceptedVersion?, paidVersion?, bump |
| Escrow vault (PDA / program-controlled lamport account) | funded lamports excluding minimum required rent; only program can debit per rules |
| Optional offer/assignment receipt | signed operator terms, price, expiry, acceptedBy; may be kept offchain and committed onchain |

The actual design may simplify PDAs/accounts to fit Anchor constraints, but **cannot** simplify away authority, budget, current assignment version or claim uniqueness. Document discriminators and seed constraints, initialize account sizes carefully, and avoid ambiguous seed collisions.

## 3. Authorities and signature boundaries

- **Customer/mission owner:** initializes, funds, assigns initial operator and may authorize a replacement; approves delegation scope.
- **AI mission delegate (optional):** separate low-value test wallet granted mission-scoped **reassignment-only** rights, with capped reward/remaining budget, expiry and revocation. It can propose and submit authorized replacement but cannot withdraw, fund, mark verified, raise budget or change verifier.
- **Operator:** controls their assigned payout wallet; never trusted to attest their own completion.
- **Verifier:** a separately managed signing identity; binds acceptance to *mission ID, task ID, current assignment version, operator, evidence digest, policy ID/version, expiration*. Signed approval can be a verifier-signed instruction or a verified signature instruction; choose one testable mechanism.
- **Program:** checks signer roles and current account state in every instruction. A backend's API token or UI role is not a substitute for a Solana signature.

**Important:** On-chain acceptance of a verifier signature proves that authorized authority approved a digest, not that physical observations are independently true.

## 4. Minimum instructions / state transitions

1. **initialize_mission**: verify customer signer, ID uniqueness, expected expiry and budget parameters; create state + vault with safe rent.
2. **fund_mission**: accept SOL transfer into escrow; update funded/remaining accounted lamports using checked math and actual balances. Avoid inconsistent stored amounts.
3. **create_task / assign_task**: set bounded reward and eligible operator wallet; reject if not enough unreserved funds, duplicate task ID, expired mission or invalid authority.
4. **authorize_reassignment**: allowed only if task is unfinished, recoverable and not paid; verify owner OR valid delegate scope/expiry; require expected assignment version; accept a new operator and quote within task's authorized budget; increment assignment version atomically, invalidate any prior proof eligibility.
5. **verify_and_claim** (or separate verify then claim): require independent authorized verifier signature on current task version/evidence digest/assigned operator and replay-resistant nonce; check accepted policy identity, payout destination, funds, already-paid flag; transfer reward exactly once from vault.
6. **close/refund_unused**: only after no payable task remains (or explicit expiry/cancellation policy), return unused unreserved balance to owner; never drain owed rewards; prevent double close.

**Preferred minimal on-chain AI demonstration:** AI selects between two structured operator offers, backend checks policy, and the owner confirms the reassignment. A pre-authorized mission delegate is an optional **stronger** path if its authority tests and UI are complete. Do not grant an LLM general custody.

## 5. Precision and accounting invariants

- Money is integer **lamports** end-to-end; format SOL at UI boundary only. No float summation or integer overflow.
- Funding + all refunds + all successful payouts cannot exceed contributed funds, excluding legitimate rent handling.
- Per-task reward cannot exceed authorized task budget or available unreserved funds.
- An already-paid task cannot be reassigned; a reassigned task cannot be paid to an old operator.
- Only one current assignment version; *expectedVersion* required on reassignment and settlement.
- Only designated verifier (not AI delegate or operator) may certify valid accepted evidence.
- Evidence digest bound to assignment version and operator; repeated digest/claim for paid task rejected.
- No arbitrary recipient account substitution; supplied recipient must match assigned operator's registered payout address and account constraints.
- Close/refund is idempotent or explicitly rejects repeats without transferring money again.
- Program accounts must validate ownership, seeds, required signers and destination accounts; avoid unchecked remaining accounts.
- Program must be compatible with devnet and local validator/test environment, no fake explorer URLs.

## 6. Threat cases / mandatory tests

| Attack / failure | Expected outcome |
| --- | --- |
| Non-owner creates or funds conflicting mission state | Unauthorized creation rejected or funds accounted to correct mission without corruption |
| Delegate tries change verifier / withdraw escrow | Reject |
| Delegate exceeds max authorized assignment amount or acts after expiry/revocation | Reject |
| Double-click reassignment, two concurrent actors with same expectedVersion | One succeeds; other stale/rejected |
| AI selects optical-only replacement for sonar-needed task | Off-chain policy rejects proposal before chain |
| Stale ROV A proof after reassignment to ROV B | Reject |
| Forged verifier signature, mismatched evidence digest or policy version | Reject |
| Old operator tries to redirect payout destination | Reject |
| New operator claims twice / tx retries | Only one payment, balance consistent |
| Expired/closed/paid task gets new claim or reassignment | Reject |
| Reward sum exceeds deposits or vault has insufficient spendable SOL | Reject safely |
| Incorrect PDA seeds, wrong program owner, wrong task/mission association | Reject |
| RPC timeout / blockhash expiration / unknown confirmation | Client queries authoritative account state before retry; never marks Paid prematurely |
| Closing mission before task obligations settled | Reject or safely reserve amount |

Tests must check before/after account balances and state, not merely that an RPC returned success.

## 7. Transaction UX contract

States: **not funded → wallet approval → submitted → processed → confirmed/finalized OR rejected/expired/unknown**. A transaction signature is displayed as a real explorer link tied to the correct cluster. Keep a durable record of missionId, taskId, assignmentVersion, tx signature, returned chain state and confirmation timestamp.

Do not claim 'Paid' when a wallet extension opens. When RPC is unavailable, label status 'Unknown — verifying', preserve signature, and reconcile on recovery. Separate simulation-event timestamp from blockchain confirmation timestamp in replay.

## 8. Deployment and proof

Implementer's minimum evidence:
- local unit/integration tests with concrete negative cases above;
- Anchor build and local validator transaction tests;
- deployed **devnet** program ID, cluster, transaction signatures for funding, reassignment and payout;
- verified failed unauthorized/duplicate claim attempts (local validator tests suffice for the negative path);
- stable documentation and **never** wallet private keys.

The repo documents setup in runnable commands only after code exists. No unverified commands or fabricated test pass totals.

## References

- [Solana program overview](https://solana.com/docs/core/programs)
- [Anchor program development](https://www.anchor-lang.com/docs)
- [Anchor PDA constraints](https://www.anchor-lang.com/docs/basics/pda)
- [Solana quickstart](https://solana.com/docs/intro/quick-start/build-first-program)

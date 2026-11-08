# @vorqyn/recovery — constrained AI operator matching (VQ-11 / #12)

Turns a measured evidence failure (VQ-10 verdict reasons) into a SAFE
reassignment proposal: a constrained model (or the deterministic
fallback) nominates an operator, an **independent deterministic policy
gate** re-verifies everything on real facts, and only **explicit owner
approval** produces a typed, unsigned chain intent.

## Safety architecture (all tested)

1. **Structured input only** — mission/task/version, measured failure
   reasons, offers (capability manifest, quote, validity window),
   budgets. Untrusted text (offer descriptions) never enters the model
   prompt and never becomes instructions.
2. **Strict JSON schema** for model output (`parseModelChoice`); free-form
   text is never passed onward.
3. **Deterministic gate, independent of the model**: existence
   (hallucination), task match, version freshness (CAS), capability
   coverage, expiry/validity window, budget + remaining-lamports ceilings,
   safe-integer quotes. The model's explanation is never trusted.
4. **Owner approval (P0)**: `authorizeProposal` requires an explicit
   owner approval and re-runs the gate at authorization time; output is a
   typed INTENT (data) — no signature, no key, no submission. The
   on-chain CAS remains the final authority. No bounded delegate is
   implemented (VQ-05 deferred it; nothing here grants wallet authority).
5. **Safe fallback**: model timeout/malformed/empty/rate-limited →
   transparent rule-based ranking (cheapest compatible unexpired in-budget
   offer), still gated, still owner-approval-only; `no_safe_proposal`
   when nothing viable exists.
6. **Duplicate suppression**: per task+version attempt ledger (injectable
   store) blocks repeat model calls from causing duplicate reassignments.

## Model labeling (honesty)

All committed model behaviour is **DETERMINISTIC FIXTURES**:
`ScriptedModelClient` and `FailingModelClient` label themselves in
`modelId`. `createHttpModelClient` is an adapter shell for a real
provider (credentials supplied at runtime by the operator); it is not
exercised by tests and **no real model trace is claimed anywhere**.

## Chain boundary

`OwnerApprovedIntent` maps 1:1 onto the chain client's
`authorizeReassignmentIx` (VQ-12, PR #50) — taskId,
expectedAssignmentVersion (CAS), operator wallet, quote. Nothing in this
package signs or submits.

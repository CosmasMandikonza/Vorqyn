/**
 * @vorqyn/recovery — constrained AI operator matching and safe recovery
 * proposals (VQ-11 / #12).
 *
 * Safety architecture:
 * 1. Structured input ONLY (actual mission/task/evidence facts; untrusted
 *    text never becomes instructions).
 * 2. Model output must satisfy a strict JSON schema.
 * 3. An INDEPENDENT deterministic policy gate re-verifies the choice on
 *    real offer/capability/budget/version facts — the model's explanation
 *    is never trusted.
 * 4. Output is a PROPOSAL. Explicit owner approval (P0) converts it to a
 *    typed, unsigned chain intent; the on-chain CAS is the final guard.
 * 5. Model timeout/failure → transparent rule-based fallback, still
 *    gated, still owner-approval-only. No autonomous wallet authority,
 *    no LLM evidence approval — anywhere.
 *
 * All model interactions in tests use clearly labeled DETERMINISTIC
 * FIXTURES (ScriptedModelClient / FailingModelClient). No real model
 * trace is claimed.
 */
export * from "./input";
export * from "./model";
export * from "./policy";
export * from "./recovery";
export * from "./fixtures";

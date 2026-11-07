/**
 * VORQYN DEMO transport adapter — `services/simulation/demo`.
 *
 * Transport-only shim over the pure simulation kernel for the frozen
 * VQ-DEMO-SIM/1 demo API (issue #32). This module adds NO logic and NO
 * simulation behavior: it re-exports the exact read-only kernel surface
 * (`services/simulation/core/**`) so the Next.js demo transport
 * (`apps/web/lib/demo-simulation/**`, `apps/web/app/api/demo/simulation/**`)
 * can import a stable, typed entry point without touching the kernel.
 *
 * Hand-written type declarations live next door in `kernel-adapter.d.mts`.
 * The kernel itself is unchanged and remains the single source of truth for
 * behavior; its own suites (`services/simulation/core/*.test.mjs`,
 * `services/simulation/integration/*.test.mjs`) keep this shim honest.
 *
 * SERVER-SIDE ONLY: never import from a client component.
 */

export { createScenarioKernel, KernelStoppedError } from "../core/kernel.mjs";
export { SOURCE_KIND_SYNTHETIC_SIM } from "../core/kernel.mjs";
export { SCENARIO_ID, STEP_MS } from "../core/scenario.mjs";
export { FRAME_ID, POSITION_UNITS } from "../core/enu.mjs";

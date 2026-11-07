/**
 * @vorqyn/contracts — VQ-00 scaffolding module.
 *
 * The real mission/task/telemetry event contracts, assignment-versioning
 * rules and deterministic reducer are deliberately NOT defined here yet:
 * they are frozen with schema tests in VQ-01 (#2) per docs/ARCHITECTURE.md
 * §3. This module exists so that workspace wiring, TypeScript compilation,
 * the test runner and the Next.js `transpilePackages` integration are all
 * proven end-to-end before any shared contract lands. Do not add mission
 * types to this package outside VQ-01.
 */
export const CONTRACTS_STATUS = "scaffolding-pending-vq-01" as const;

export type CONTRACTS_STATUS = typeof CONTRACTS_STATUS;

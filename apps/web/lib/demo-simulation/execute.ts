/**
 * Kernel execution for the frozen VQ-DEMO-SIM/1 transport.
 *
 * Reconstructs a fresh kernel from the supplied seed on EVERY call and
 * executes the validated ordered trace through the real
 * `createScenarioKernel` — this is what makes the endpoint stateless
 * (serverless-worker churn or parallel judges cannot mix sessions) and
 * deterministic (same seed + same operations => byte-stable response).
 *
 * A structurally valid operation that the KERNEL rejects (bad fields, bad
 * idempotency key, invalid transition, stopped kernel, ...) aborts the
 * whole request with HTTP 422 carrying the kernel's own failure code: a
 * rejected operation is never committed to a replayable trace.
 *
 * The transport never converts measurements into verdicts and never
 * fabricates events: snapshots/state are passed through unmodified.
 */

import {
  createScenarioKernel,
  FRAME_ID,
  POSITION_UNITS,
  SCENARIO_ID,
  SOURCE_KIND_SYNTHETIC_SIM,
  STEP_MS,
  KernelStoppedError,
} from "../../../../services/simulation/demo/kernel-adapter.mjs";
import { DemoKernelRejection, RESPONSE_SCHEMA, type DemoCommandResultView, type DemoOperation, type DemoSimResponse } from "./contract";

interface ExecuteOptions {
  seed: number;
  operations: DemoOperation[];
}

export function executeDemoSimulation({ seed, operations }: ExecuteOptions): DemoSimResponse {
  // Fresh kernel per request: no global state, no session memory.
  const kernel = createScenarioKernel({ seed });

  const acceptedOperations: DemoOperation[] = [];
  const commandResults: DemoCommandResultView[] = [];

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation === undefined) {
      throw new DemoKernelRejection("invalid_request", `operations[${index}] is missing`, index);
    }
    if (operation.op === "step") {
      try {
        kernel.step(operation.count);
      } catch (error) {
        if (error instanceof KernelStoppedError) {
          throw new DemoKernelRejection("kernel_stopped", `operations[${index}]: cannot step a stopped scenario`, index);
        }
        // Defensive: kernel.step only throws for validated inputs; any other
        // throw is surfaced without internals (no stack, no message leakage
        // beyond the safe code).
        throw new DemoKernelRejection("kernel_step_failed", `operations[${index}]: step failed kernel validation`, index);
      }
      acceptedOperations.push(operation);
      continue;
    }

    const outcome = kernel.issueCommand(operation.command);
    if (outcome.ok === false) {
      // Kernel rejected the command: the request ends here with 422 and the
      // kernel's typed failure. Nothing about this operation is echoed.
      throw new DemoKernelRejection(
        outcome.failure.code,
        `operations[${index}]: ${outcome.failure.message}`,
        index,
      );
    }
    commandResults.push({
      operationIndex: index,
      ok: outcome.ok,
      duplicate: outcome.duplicate,
      failure: null,
    });
    acceptedOperations.push(operation);
  }

  return {
    schema: RESPONSE_SCHEMA,
    scenarioId: SCENARIO_ID,
    seed,
    sourceKind: SOURCE_KIND_SYNTHETIC_SIM,
    frameId: FRAME_ID,
    positionUnits: POSITION_UNITS,
    stepMs: STEP_MS,
    operations: acceptedOperations,
    // Unmodified frozen kernel records — read once, serialized verbatim.
    snapshots: kernel.getObservationLog(),
    commandResults,
    state: kernel.getState(),
  } as DemoSimResponse;
}

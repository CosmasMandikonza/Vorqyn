/**
 * Pure request validation for the frozen VQ-DEMO-SIM/1 transport.
 *
 * Everything here is transport-structural (HTTP 400/413) and deliberately
 * strict: unknown fields anywhere are rejected, so a caller cannot smuggle
 * provenance, session tokens, verdicts or any field this contract does not
 * own. Field-level command content is NOT validated here — known command
 * types are forwarded verbatim to the kernel, whose own strict per-command
 * schemas produce the authoritative rejections (HTTP 422 in execute.ts).
 *
 * Pure functions only: no I/O, no clock, no globals — deterministic.
 */

import {
  ALLOWED_COMMAND_TYPES,
  DEFAULT_DEMO_SEED,
  DemoRequestError,
  LIMITS,
  REQUEST_SCHEMA,
  type DemoOperation,
  type DemoSimRequest,
} from "./contract";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse the raw request body into a validated DemoSimRequest. Throws DemoRequestError. */
export function parseAndValidateRequest(rawBody: string): DemoSimRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new DemoRequestError("invalid_json", "request body is not valid JSON");
  }
  return validateParsedRequest(parsed);
}

/** Validate an already-parsed payload (also used directly by tests). */
export function validateParsedRequest(payload: unknown): DemoSimRequest {
  if (!isPlainObject(payload)) {
    throw new DemoRequestError("invalid_request", "request must be a JSON object");
  }

  const schema = payload.schema;
  if (schema !== REQUEST_SCHEMA) {
    throw new DemoRequestError("schema_unsupported", `unsupported schema: ${JSON.stringify(schema ?? null)}; expected ${REQUEST_SCHEMA}`);
  }

  // Unknown root fields are rejected: no caller can forge provenance,
  // sessions, verdicts or any concept this contract does not own.
  const allowedRootFields = new Set(["schema", "seed", "operations"]);
  for (const key of Object.keys(payload)) {
    if (!allowedRootFields.has(key)) {
      throw new DemoRequestError("unknown_field", `unknown request field: ${key}`);
    }
  }

  let seed = DEFAULT_DEMO_SEED;
  if (payload.seed !== undefined) {
    const value = payload.seed;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4294967295) {
      throw new DemoRequestError("invalid_seed", "seed must be an integer in [0, 4294967295]");
    }
    seed = value;
  }

  const rawOperations = payload.operations;
  if (rawOperations === undefined) {
    throw new DemoRequestError("invalid_request", "operations is required (use an empty array for a fresh scenario)");
  }
  if (!Array.isArray(rawOperations)) {
    throw new DemoRequestError("invalid_request", "operations must be an array");
  }
  if (rawOperations.length > LIMITS.maxOperations) {
    throw new DemoRequestError("too_many_operations", `operations length ${rawOperations.length} exceeds limit ${LIMITS.maxOperations}`);
  }

  const operations: DemoOperation[] = rawOperations.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new DemoRequestError("invalid_request", `operations[${index}] must be an object`);
    }
    const op = entry.op;
    if (op === "step") {
      const allowed = new Set(["op", "count"]);
      for (const key of Object.keys(entry)) {
        if (!allowed.has(key)) {
          throw new DemoRequestError("unknown_field", `operations[${index}] has unknown field: ${key}`);
        }
      }
      const count = entry.count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < LIMITS.minStepCount || count > LIMITS.maxStepCount) {
        throw new DemoRequestError(
          "invalid_step_count",
          `operations[${index}] count must be an integer in [${LIMITS.minStepCount}, ${LIMITS.maxStepCount}], got ${JSON.stringify(count ?? null)}`,
        );
      }
      return { op: "step", count };
    }
    if (op === "command") {
      const allowed = new Set(["op", "command"]);
      for (const key of Object.keys(entry)) {
        if (!allowed.has(key)) {
          throw new DemoRequestError("unknown_field", `operations[${index}] has unknown field: ${key}`);
        }
      }
      const command = entry.command;
      if (!isPlainObject(command)) {
        throw new DemoRequestError("invalid_request", `operations[${index}].command must be an object`);
      }
      const type = command.type;
      if (typeof type !== "string" || !(ALLOWED_COMMAND_TYPES as readonly string[]).includes(type)) {
        throw new DemoRequestError("unknown_command_type", `operations[${index}].command.type is not a supported kernel command: ${JSON.stringify(type ?? null)}`);
      }
      // Field-level validation is delegated to the kernel's own strict
      // per-command schemas (unknown command fields, bad ids, bad targets
      // etc. are kernel rejections -> HTTP 422 in execute.ts).
      return { op: "command", command };
    }
    throw new DemoRequestError("unknown_operation", `operations[${index}].op is not a supported operation: ${JSON.stringify(op ?? null)}`);
  });

  const totalSteps = operations.reduce((sum, operation) => (operation.op === "step" ? sum + operation.count : sum), 0);
  if (totalSteps > LIMITS.maxTotalSteps) {
    throw new DemoRequestError("too_many_total_steps", `total simulated steps ${totalSteps} exceed limit ${LIMITS.maxTotalSteps}`);
  }

  return { schema: REQUEST_SCHEMA, seed, operations };
}

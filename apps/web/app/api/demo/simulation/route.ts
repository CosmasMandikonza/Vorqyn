/**
 * POST /api/demo/simulation — VQ-DEMO-SIM/1 transport (issue #32).
 *
 * Guest-only, stateless, bounded deterministic replay of the pure
 * world-aligned simulation kernel. Every request rebuilds the scenario from
 * the supplied seed + operation trace (`apps/web/lib/demo-simulation`), so
 * parallel guests and serverless workers cannot mix sessions and identical
 * inputs produce identical responses.
 *
 * This endpoint synthesizes no MissionEvents, evidence verdicts, AI
 * proposals, payouts, session tokens or wall-clock timestamps, and it never
 * executes chain logic. Errors are typed `{schema, error:{code,message}}`
 * with safe messages and no stack traces. Responses are `Cache-Control:
 * no-store`; no credentials are read or stored.
 *
 * HTTP mapping:
 * - 200 success (response schema `vorqyn.demo-sim/response/1`)
 * - 400 transport/structural validation failure (`vorqyn.demo-sim/error/1`)
 * - 413 request body above the 16 KiB limit
 * - 422 kernel rejected a structurally valid operation (kernel's own code)
 * - 405 non-POST methods (also in the error schema)
 */

import { DemoKernelRejection, DemoRequestError, ERROR_SCHEMA, LIMITS } from "@/lib/demo-simulation/contract";
import { executeDemoSimulation } from "@/lib/demo-simulation/execute";
import { parseAndValidateRequest } from "@/lib/demo-simulation/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: 400 | 405 | 413 | 422): Response {
  return new Response(JSON.stringify({ schema: ERROR_SCHEMA, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // Bound the input BEFORE parsing: reject oversized bodies with 413 without
  // allocating unbounded work. (The transfer layer may 413 earlier for its
  // own limits; this is the contract-enforcing check.)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse("invalid_request", "could not read request body", 400);
  }
  const bodyBytes = new TextEncoder().encode(rawBody).length;
  if (bodyBytes > LIMITS.maxBodyBytes) {
    return errorResponse("payload_too_large", `request body ${bodyBytes} bytes exceeds limit ${LIMITS.maxBodyBytes} bytes`, 413);
  }

  try {
    const validated = parseAndValidateRequest(rawBody);
    const result = executeDemoSimulation({ seed: validated.seed, operations: validated.operations });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof DemoRequestError) {
      return errorResponse(error.code, error.message, error.status);
    }
    if (error instanceof DemoKernelRejection) {
      return errorResponse(error.code, error.message, 422);
    }
    // Unknown internal failure: safe typed message, no stack trace, no internals.
    return errorResponse("internal_error", "the simulation transport failed to process the request", 500);
  }
}

export async function GET(): Promise<Response> {
  return errorResponse("method_not_allowed", "use POST with a vorqyn.demo-sim/request/1 body", 405);
}

export async function PUT(): Promise<Response> {
  return errorResponse("method_not_allowed", "use POST with a vorqyn.demo-sim/request/1 body", 405);
}

export async function DELETE(): Promise<Response> {
  return errorResponse("method_not_allowed", "use POST with a vorqyn.demo-sim/request/1 body", 405);
}

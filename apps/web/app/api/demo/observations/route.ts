/**
 * POST /api/demo/observations — VQ-GUEST-TRACE/1 (issue #9 guest slice).
 *
 * A trace/diagnostic view over the existing real kernel transport: accepts
 * the SAME bounded `vorqyn.demo-sim/request/1` body as
 * /api/demo/simulation (validated by the shared parser, executed by the
 * shared kernel runner), derives the canonical source-aware journal, and
 * returns an explicit read-only observation trace with deterministic
 * query-string paging (?afterSequence=N&limit=M).
 *
 * Stateless by construction: the trace is recomputed from the supplied
 * seed + bounded operation trace on every request — there are no
 * server-side sessions, and the same body + cursor yields a byte-identical
 * response. Every response is `Cache-Control: no-store`.
 *
 * Authority boundary: no funding state, verifier acceptance, AI proposal,
 * wallet, transaction or chain timestamp exists in any response; the
 * receipt clock is explicitly fixture-labelled; the chain clock domain is
 * `null` because no chain authority is in scope.
 *
 * HTTP mapping: 200 success · 400 malformed body/cursor · 413 body over the
 * 16 KiB limit · 422 kernel-rejected operation (kernel's own code) · 405
 * non-POST · 500 catch-all without stack traces. Errors use
 * `vorqyn.guest-trace/error/1`.
 */

import { DemoKernelRejection, DemoRequestError, LIMITS } from "@/lib/demo-simulation/contract";
import { parseAndValidateRequest } from "@/lib/demo-simulation/validate";
import { deriveGuestTrace, parseTraceCursor } from "@/lib/simulation-journal/trace-execute";
import { TRACE_ERROR_SCHEMA } from "@/lib/simulation-journal/trace-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: 400 | 405 | 413 | 422 | 500): Response {
  return new Response(JSON.stringify({ schema: TRACE_ERROR_SCHEMA, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // Budget first: reject oversized bodies before parsing (Content-Length
  // when the client declares it, then the buffered read re-checked).
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number.isInteger(Number(declaredLength)) && Number(declaredLength) > LIMITS.maxBodyBytes) {
    return errorResponse("payload_too_large", `declared request body ${declaredLength} bytes exceeds limit ${LIMITS.maxBodyBytes} bytes`, 413);
  }
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

  // Paging cursor from the query string (body stays pure VQ-DEMO-SIM/1).
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return errorResponse("cursor_invalid", "request URL is not resolvable", 400);
  }
  const cursor = parseTraceCursor(url.searchParams);
  if ("code" in cursor) {
    return errorResponse(cursor.code, cursor.message, 400);
  }

  try {
    const validated = parseAndValidateRequest(rawBody);
    const { response } = deriveGuestTrace({
      seed: validated.seed,
      operations: validated.operations,
      cursor,
    });
    return new Response(JSON.stringify(response), {
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
    return errorResponse("internal_error", "the guest trace transport failed to process the request", 500);
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

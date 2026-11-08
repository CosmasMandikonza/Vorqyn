/**
 * POST /api/demo/evidence — VQ-DEMO-EVIDENCE/1 (issue #9 guest slice).
 *
 * A read-only, stateless, bounded evidence-inspection journey over the
 * merged pipeline: the SAME bounded `vorqyn.demo-sim/request/1` body as
 * /api/demo/simulation (validated by the shared parser — unknown fields,
 * including any calibration input, are rejected) is executed by the REAL
 * kernel, fed through the canonical accepted observation journal and the
 * merged evidence adapter, and judged by the EXISTING verifier
 * (services/verifier, unchanged). The response carries the full
 * Observation → Evidence → Policy → Verdict → Provenance chain for the
 * underwater modalities plus explicit labels:
 * `SYNTHETIC_SIM` and `DEMO EVIDENCE — NOT PAYMENT AUTHORIZATION`.
 *
 * Truth boundaries: simulator measurements are fixture-model outputs; no
 * visibility calibration exists, so optical `visibility_m` evidence is
 * UNAVAILABLE by default (structured `optical_visibility_unsupported`); a
 * windowed sonar verdict covers exactly the captured window and is always
 * accompanied by the kernel's own coverage counters. No mission lifecycle
 * event, wallet authorization, verifier signature, chain transaction or
 * payout is created by this endpoint; the chain clock domain is `null`.
 *
 * Stateless by construction: recomputed from the supplied seed + bounded
 * operation trace on every request; the same body yields a byte-identical
 * response. HTTP mapping: 200 success · 400 malformed body · 413 body over
 * the 16 KiB limit · 422 kernel-rejected operation · 405 non-POST · 500
 * catch-all without stack traces. Errors use `vorqyn.demo-evidence/error/1`.
 */

import { DemoKernelRejection, DemoRequestError, LIMITS } from "@/lib/demo-simulation/contract";
import { parseAndValidateRequest } from "@/lib/demo-simulation/validate";
import { deriveDemoEvidence } from "@/lib/demo-evidence/derive";
import { EVIDENCE_ERROR_SCHEMA } from "@/lib/demo-evidence/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: 400 | 405 | 413 | 422 | 500): Response {
  return new Response(JSON.stringify({ schema: EVIDENCE_ERROR_SCHEMA, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * The same streamed 16 KiB boundary as the other guest endpoints:
 * Content-Length is an early hint, and every streamed chunk is counted even
 * if the header lies or is missing.
 */
async function readBoundedBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > LIMITS.maxBodyBytes) {
    throw new DemoRequestError("payload_too_large", "request body exceeds the 16 KiB limit", 413);
  }
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LIMITS.maxBodyBytes) {
        throw new DemoRequestError("payload_too_large", "request body exceeds the 16 KiB limit", 413);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const parts: Uint8Array[] = chunks;
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = parseAndValidateRequest(await readBoundedBody(request));
    const response = deriveDemoEvidence({ seed: parsed.seed, operations: parsed.operations });
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
    return errorResponse("internal_error", "unexpected server error", 500);
  }
}

export function GET(): Response {
  return errorResponse("method_not_allowed", "use POST with a vorqyn.demo-sim/request/1 body", 405);
}

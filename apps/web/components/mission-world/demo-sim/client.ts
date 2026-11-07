/**
 * Transport for the frozen VQ-DEMO-SIM/1 endpoint (owned by Agent A, #32).
 * The endpoint is expected at POST /api/demo/simulation. While that API is
 * unmerged, callers may inject a recorded-fixture transport; the production
 * default is always the real HTTP endpoint.
 */
import {
  DEMO_SIM_REQUEST_SCHEMA,
  validateDemoSimResponse,
  type DemoSimRequest,
  type DemoSimResponse,
} from "./contract";

export const DEMO_SIM_ENDPOINT = "/api/demo/simulation";
const DEFAULT_TIMEOUT_MS = 15000;

export type DemoTransport = (body: DemoSimRequest, signal: AbortSignal) => Promise<DemoSimResponse>;

export class DemoSimHttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DemoSimHttpError";
    this.status = status;
    this.code = code;
  }
}

export class DemoSimNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoSimNetworkError";
  }
}

/** Build the exact request envelope for a trace. */
export function buildDemoSimRequest(seed: number, operations: DemoSimRequest["operations"]): DemoSimRequest {
  return { schema: DEMO_SIM_REQUEST_SCHEMA, seed, operations };
}

/** Real HTTP transport against the frozen endpoint. */
export const httpDemoTransport: DemoTransport = async (body, signal) => {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal.addEventListener("abort", abortFromParent);
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(DEMO_SIM_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (cause) {
    throw new DemoSimNetworkError(
      signal.aborted && !controller.signal.aborted
        ? "request cancelled"
        : `simulation API unreachable (${String(cause)})`,
    );
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortFromParent);
  }
  if (!response.ok) {
    let code = `http_${response.status}`;
    let message = `simulation API returned HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      if (payload?.error?.code) code = payload.error.code;
      if (payload?.error?.message) message = payload.error.message;
    } catch {
      // keep defaults — body was not the documented error shape
    }
    throw new DemoSimHttpError(response.status, code, message);
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    throw new DemoSimHttpError(response.status, "bad_json", `simulation API returned invalid JSON: ${String(cause)}`);
  }
  return validateDemoSimResponse(parsed);
};

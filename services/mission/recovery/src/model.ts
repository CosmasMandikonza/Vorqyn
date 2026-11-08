/**
 * Model seam (VQ-11 / #12): strict JSON schema for whatever proposes an
 * operator, plus two client implementations.
 *
 * - ScriptedModelClient: DETERMINISTIC FIXTURE responses, clearly labeled
 *   MOCK — used by tests and as the fallback seed. Never presented as a
 *   real model trace.
 * - HttpModelClient: a thin, documented adapter shell for a real provider
 *   (endpoint + key supplied AT RUNTIME by the operator). No key or trace
 *   is committed; no real-model output is claimed anywhere in this repo.
 *
 * The model NEVER gets wallet authority and NEVER approves evidence: its
 * only output is a candidate offerId + explanation, which the independent
 * deterministic policy gate then accepts or rejects.
 */

import { err, ok, type Result } from "@vorqyn/contracts";
import type { ModelPromptInput } from "./input";

/** The strict schema the model must answer with (issue #12 checklist). */
export interface ModelChoice {
  readonly chosenOfferId: string;
  readonly taskId: string;
  readonly expectedAssignmentVersion: number;
  readonly explanation: string;
  /** Offer IDs the model considered and why it dismissed them. */
  readonly rejectedOfferReasons: readonly { offerId: string; reason: string }[];
}

export interface ModelClient {
  readonly modelId: string;
  propose(input: ModelPromptInput): Promise<Result<ModelChoice>>;
}

export function parseModelChoice(raw: string): Result<ModelChoice> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err("validation_error", "model output is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null)
    return err("validation_error", "model output must be a JSON object");
  const p = parsed as Record<string, unknown>;
  if (typeof p.chosenOfferId !== "string" || p.chosenOfferId.length === 0)
    return err("validation_error", "chosenOfferId must be a non-empty string");
  if (typeof p.taskId !== "string")
    return err("validation_error", "taskId must be a string");
  if (typeof p.expectedAssignmentVersion !== "number" || !Number.isSafeInteger(p.expectedAssignmentVersion) || p.expectedAssignmentVersion < 1)
    return err("validation_error", "expectedAssignmentVersion must be a positive integer");
  if (typeof p.explanation !== "string" || p.explanation.length > 2_000)
    return err("validation_error", "explanation must be a string of at most 2000 chars");
  if (!Array.isArray(p.rejectedOfferReasons))
    return err("validation_error", "rejectedOfferReasons must be an array");
  for (const r of p.rejectedOfferReasons) {
    if (typeof r !== "object" || r === null || typeof (r as Record<string, unknown>).offerId !== "string" || typeof (r as Record<string, unknown>).reason !== "string")
      return err("validation_error", "rejectedOfferReasons entries must be {offerId, reason}");
  }
  return ok({
    chosenOfferId: p.chosenOfferId,
    taskId: p.taskId,
    expectedAssignmentVersion: p.expectedAssignmentVersion,
    explanation: p.explanation,
    rejectedOfferReasons: p.rejectedOfferReasons as ModelChoice["rejectedOfferReasons"],
  });
}

/**
 * MOCK (deterministic fixture). Picks the cheapest capability-compatible,
 * unexpired, in-budget offer — the rule-based fallback logic itself,
 * exposed as a "model" so tests can pin the exact boundary behaviour.
 * Clearly labeled: no real model is invoked.
 */
export class ScriptedModelClient implements ModelClient {
  readonly modelId = "mock-scripted-policy-v1 (DETERMINISTIC FIXTURE — not a real model trace)";
  constructor(
    private readonly behaviour: (input: ModelPromptInput) => Result<ModelChoice> | Promise<Result<ModelChoice>>,
  ) {}
  async propose(input: ModelPromptInput): Promise<Result<ModelChoice>> {
    return this.behaviour(input);
  }
}

/** Model failure modes a caller can inject in tests. */
export class FailingModelClient implements ModelClient {
  readonly modelId: string;
  constructor(
    readonly mode: "timeout" | "malformed" | "empty" | "rate_limited",
    private readonly timeoutMs: number,
  ) {
    this.modelId = `mock-failing-${mode} (DETERMINISTIC FIXTURE)`;
  }
  async propose(): Promise<Result<ModelChoice>> {
    switch (this.mode) {
      case "timeout":
        await new Promise((resolve) => setTimeout(resolve, this.timeoutMs));
        return err("validation_error", "model did not answer in time");
      case "rate_limited":
        return err("validation_error", "provider returned 429");
      case "empty":
        return err("validation_error", "model returned an empty choice");
      default:
        return err("validation_error", "model returned unparseable output");
    }
  }
}

/**
 * Real-provider adapter SHELL. Constructed with an explicit endpoint and
 * fetch implementation; the operator supplies credentials at runtime.
 * Nothing here is exercised by the committed tests — no real model trace
 * is claimed to exist.
 */
export interface HttpModelOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly modelId: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createHttpModelClient(options: HttpModelOptions): ModelClient {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    modelId: options.modelId,
    async propose(input: ModelPromptInput): Promise<Result<ModelChoice>> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
      try {
        const response = await doFetch(options.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify({ model: options.modelId, input }),
          signal: controller.signal,
        });
        if (!response.ok) return err("validation_error", `provider returned ${response.status}`);
        return parseModelChoice(await response.text());
      } catch (e) {
        return err("validation_error", `model request failed: ${String(e)}`);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

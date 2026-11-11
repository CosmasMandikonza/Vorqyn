"use client";

/**
 * Economic Handoff panel (Issue #15 economic section) — READ-ONLY stage
 * display over the validated event-projection boundary.
 *
 * Stage 1 (measured degradation) is driven by the kernel playback already
 * rendered on this page; stages 2-6 are driven ONLY by canonical
 * MissionEvents projected through Lane 1's reducer via the boundary.
 * Missing authority renders as explicit pending/unavailable — this panel
 * never displays an evidence verdict, chain confirmation, payout or AI
 * decision that was not actually supplied as a validated event.
 */
import type { EconomicHandoffProjection, HandoffStage } from "./boundary";

const STATE_LABELS: Record<HandoffStage["state"], string> = {
  measured: "MEASURED",
  "awaiting-authority": "AWAITING AUTHORITY",
  "awaiting-verifier": "AWAITING VERIFIER",
  "awaiting-proposals": "AWAITING PROPOSALS",
  proposed: "PROPOSED",
  "authorized-awaiting-chain": "AUTHORIZED — AWAITING CHAIN",
  "submitted-awaiting-confirmation": "SUBMITTED — AWAITING CONFIRMATION",
  confirmed: "CONFIRMED",
  rejected: "REJECTED",
  unavailable: "UNAVAILABLE (no source)",
};

const STATE_TONE: Record<HandoffStage["state"], string> = {
  measured: "border-success text-success",
  "awaiting-authority": "border-border text-muted-foreground",
  "awaiting-verifier": "border-border text-muted-foreground",
  "awaiting-proposals": "border-border text-muted-foreground",
  proposed: "border-primary text-primary",
  "authorized-awaiting-chain": "border-warning text-warning",
  "submitted-awaiting-confirmation": "border-warning text-warning",
  confirmed: "border-success text-success",
  rejected: "border-danger text-danger",
  unavailable: "border-border text-muted-foreground",
};

export function RecoveryHandoffPanel({
  projection,
  sourceLabel,
  measuredAvailable,
  onLoadWalkthrough,
  walkthroughLoaded,
}: {
  projection: EconomicHandoffProjection;
  sourceLabel: string;
  /** True when kernel playback has produced a measured fault series. */
  measuredAvailable: boolean;
  /** Present when the recorded fixture walkthrough can be loaded. */
  onLoadWalkthrough?: () => void;
  walkthroughLoaded: boolean;
}) {
  return (
    <section
      aria-label="Economic handoff stages"
      className="rounded-md border border-border bg-surface-muted/60 p-4"
      data-testid="handoff-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow text-muted-foreground">
          Economic handoff · event/receipt-driven stages
        </p>
        <span
          className={`badge font-mono ${
            sourceLabel.startsWith("FIXTURE")
              ? "border-warning text-warning"
              : "border-border text-muted-foreground"
          }`}
          data-testid="handoff-source-badge"
        >
          {sourceLabel}
        </span>
      </div>

      <ol className="mt-3 space-y-2">
        {/* Stage 1 — measured degradation comes from kernel playback. */}
        <li className="rounded-sm border border-border-subtle bg-background/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-foreground">1 · Measured optical degradation</span>
            <span className={`badge font-mono text-[10px] ${measuredAvailable ? STATE_TONE.measured : STATE_TONE["awaiting-authority"]}`}>
              {measuredAvailable ? STATE_LABELS.measured : "AWAITING KERNEL OBSERVATIONS"}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {measuredAvailable
              ? "Kernel-observed optical series degraded under the injected visibility fault — see the measured-quality timeline above."
              : "Start the synthetic survey and inject the visibility fault to produce measured degradation."}
          </p>
        </li>

        {/* Stages 2-6 — from the validated event projection. */}
        {projection.stages.map((stage, index) => (
          <li
            key={stage.id}
            className="rounded-sm border border-border-subtle bg-background/60 p-3"
            data-testid={`handoff-stage-${stage.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-foreground">
                {index + 2} · {stage.title}
              </span>
              <span className={`badge font-mono text-[10px] ${STATE_TONE[stage.state]}`}>
                {STATE_LABELS[stage.state]}
              </span>
            </div>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">{stage.detail}</p>
            {stage.confirmation && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                sig {stage.confirmation.transactionSignature.slice(0, 24)}…
                {stage.confirmation.slot !== undefined ? ` · slot ${stage.confirmation.slot}` : ""}
                {stage.confirmation.chainTimeMs !== undefined ? ` · chain t ${stage.confirmation.chainTimeMs} ms` : ""}
                {stage.confirmation.amountLamports !== undefined ? ` · ${stage.confirmation.amountLamports} lamports` : ""}
              </p>
            )}
          </li>
        ))}
      </ol>

      {projection.audit.length > 0 && (
        <div className="mt-3" role="status">
          <p className="eyebrow text-muted-foreground">Boundary audit</p>
          <ul className="mt-1 space-y-1">
            {projection.audit.map((entry, index) => (
              <li key={index} className="font-mono text-[10px] text-muted-foreground">
                {entry.code}: {entry.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onLoadWalkthrough && !walkthroughLoaded && (
        <div className="mt-3">
          <button type="button" className="button button-secondary !min-h-11" onClick={onLoadWalkthrough}>
            Load recorded fixture walkthrough
          </button>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            Loads the canonical fixture script from packages/contracts through the
            validated boundary — deterministic recorded events, labelled FIXTURE
            WALKTHROUGH. No chain transactions were submitted by this page.
          </p>
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Chain-authority stages display pending/unavailable until a confirmed
        Solana receipt with cluster, mission+task identity, current assignment
        version, enacted recipient and signature arrives through a validated
        source (Omar's chain-client, #50). Simulator time is never shown as
        chain time. This panel is read-only — it performs no transactions.
      </p>
    </section>
  );
}

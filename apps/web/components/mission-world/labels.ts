/**
 * Truthfulness labels for the world preview. These statements are
 * load-bearing and MODE-DEPENDENT: before a synthetic survey session the
 * viewer shows static anchors; during kernel playback it shows real
 * SYNTHETIC_SIM observations. Every surface that could imply stronger
 * activity than actually exists must render the honest scope for its mode.
 */
export const HONESTY_BADGE =
  "World preview · Static vehicle anchors · No live mission telemetry";

export const PLAYBACK_BADGE =
  "World preview · SYNTHETIC_SIM kernel telemetry · No evidence, AI or settlement actions";

export const SOURCE_LABEL = "Static anchor fixture — no live telemetry";

export const SOURCE_LABEL_PLAYBACK = "SYNTHETIC_SIM · kernel observation";

export const LIMITATIONS_TEXT =
  "Static world preview of the PORT-001 template. Machines sit at fixed anchor poses from world.json; nothing moves, no mission runs, no evidence, AI decisions, wallet actions or chain activity exist here. Simulator pose-stream playback (this page's survey session) and live missions remain bounded, labelled work — Issue #8 integration continues.";

export const PLAYBACK_LIMITATIONS_TEXT =
  "Kernel-driven playback of the synthetic PORT-001 fixture. Machines move along their actually observed routes with measured quality and coverage — measurements only, never verdicts. There is no evidence acceptance, AI recovery decision, wallet approval or blockchain settlement here; those belong to later integrated issues. Simulator time advances in fixed 500 ms steps and is independent of wall-clock time.";

export const VIEWER_INTRO =
  "Explore the actual PORT-001 port world — one shared environment spanning air, ground and underwater inspection regions. Orbit freely, jump between calibrated camera stations and select machines to read their real world coordinates.";

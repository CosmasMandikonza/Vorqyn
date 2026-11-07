/**
 * Truthfulness labels for the 3D world preview. These statements are
 * load-bearing: the viewer renders static anchor fixtures only, and every
 * surface that could imply live activity must repeat the honest scope.
 */
export const HONESTY_BADGE =
  "World preview · Static vehicle anchors · No live mission telemetry";

export const SOURCE_LABEL = "Static anchor fixture — no live telemetry";

export const LIMITATIONS_TEXT =
  "Static world preview of the PORT-001 template. Machines sit at fixed anchor poses from world.json; nothing moves, no mission runs, no evidence, AI decisions, wallet actions or chain activity exist here. Dynamic poses arrive with simulator pose-stream integration (Issue #24) and live missions remain future work (Issue #8).";

export const VIEWER_INTRO =
  "Explore the actual PORT-001 port world — one shared environment spanning air, ground and underwater inspection regions. Orbit freely, jump between calibrated camera stations and select machines to read their real world coordinates.";

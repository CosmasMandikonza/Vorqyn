# Issue #16 — shared shell and independent judge QA

Branch `fix/lane2-judge-qa-shell` starts at main **`979133305a8008182b4b3179f91a180ef657c9d7`**. The API (#35) and playback (#38) are merged at this base. The [new QA evidence](../evidence/qa-final/README.md) records results separately from the historical release packet. This work does not certify deployment, video or accepted submission under #17.

## Proven shell defect and native-zoom distinction

The prior 89px finding is reproducible at **CSS root zoom 2**, with a 1440×900 Chromium viewport: document width 1529px; `.header-actions` rectangle `x=824.0625, y=34, width=705, height=130, right=1529.0625`. The earlier mission-world capture tool explicitly uses a CSS zoom proxy. It is not native browser zoom.

Genuine Chromium 200% zoom on the unchanged base had no shell overflow: a 1440px browser window has a 720px CSS layout viewport and uses the mobile navigation; a 2048px window has a 1024px layout viewport and retains desktop controls. Device pixel ratio becomes 2 while CSS root zoom remains 1. The original request's description of the 89px case as native zoom was not reproduced. Preserve this evidence distinction.

The focused fix wraps header/control groups and adds row spacing/padding. At the passing checkpoint, document width is 1440px and `.header-actions.right` is 1344px; navigation, Light/Dark/System and Create Workspace remain reachable. It does not hide horizontal overflow globally or clip controls. Production changes are confined to `globals.css` shell rules; mission-world remains unchanged.

## Reproduce

Use the pinned Node/pnpm and browser setup in [README](README.md). Build the selected committed checkout before browser testing. Choose a new artifact directory each time; stale evidence is rejected.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
RELEASE_ARTIFACT_DIR="$PWD/../judge-qa-run-01" \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @vorqyn/web exec playwright test \
  --config ../../scripts/release/judge-qa.config.mjs
node scripts/release/validate-judge-qa.mjs --dir ../judge-qa-run-01
```

For the narrow before/after regression, append `--grep 'CSS root zoom'` and use a fresh directory. Do not run separate browser commands concurrently against port 3110: server reuse is deliberately disabled.

The existing preflight now also runs this isolated suite and its capture validator inside its fresh committed-source snapshot, after the original release checks. It writes a separate `judge-qa/` namespace:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/release/preflight.mjs --out ../judge-preflight-01
```

## Strict browser matrix

The 26 cases exercise light/dark at 1440×900, 1024×900, 390×844 and 320×844, with five routes: `/`, `/demo`, `/demo/mission`, `/workspace`, `/workspace/create`. They also cover genuine native 200% Chromium zoom in 1440px/2048px windows, and the separately named CSS-root-zoom regression.

Tests assert document width, visible header control bounds, keyboard outlines, skip link, mobile focus trap/Escape/focus restoration, menu navigation and close-on-desktop, theme persistence and reduced motion. Real guest cases perform Start → step → select ROV/camera stations → actual optical fault → step → timeline keyboard navigation → identical HTTP replay → 2D textual observations. No-WebGL cases disable actual context creation and still use the real simulation endpoint. Unexpected console/page errors fail the normal journeys. Deliberately failed assets and API transport/fault/stale assertions remain in the original release suite.

The 126-capture inventory includes 40 route captures, four mobile menus, two CSS zoom cases, 20 native-zoom route captures, 56 mission states and four no-WebGL states. Every screenshot is taken directly by Playwright with `fullPage: false`, `animations: disabled`, `scale: device`. It is not cropped/resized after capture. PNG IHDR dimensions must match the **measured CSS viewport**; DPR, CSS root zoom, theme, source URL, screenshot options, source commit SHA, run ID, timestamp and SHA-256 are recorded. Native screenshots are named for their actual 720px/1024px layouts and measured heights, with browser DPR 2; this non-emulated Chromium/Playwright capture returns a layout-sized raster, so the test verifies actual PNG dimensions rather than multiplying by the browser's native-zoom DPR. Native images are never presented as 1440px or mobile evidence. Ordinary captures use DPR 1 and the exact named viewport.

The independent validator requires the entire inventory and matching run/commit/theme/viewport/options/hashes. A screenshot provenance PASS does not mean visual quality or layout PASS. Soft layout assertions preserve failure screenshots while still failing their cases. Missing captures fail validation; no silently skipped checks or proxy success for missing functionality.

## Ownership and remaining acceptance

Mission-world camera overflow, ROV framing and inspector/playback defects belong to the mission-world owner. Report precise selector, rectangle, viewport, source SHA and screenshot through existing #33/this PR; do not edit that component or another agent's evidence. Recheck after the owner's change is merged on main. Header success alone does not certify the entire product.

Review actual UW/INSPECT images for recognizable ROV/obstruction and readable measurements; inspect the replay controls and source labels, beyond numeric image validation. The broader quality gates still require physical/SITL provenance, independent evidence policy, runtime AI, real Solana funding/reassignment/payout and negative financial scenarios where claimed. Missing implementation/proof is BLOCKED; unperformed human outsider, screen-reader, physical GPU/performance or external publication checks are NOT RUN. See the observed evidence for the exact current result, not this procedure as a claim of readiness.

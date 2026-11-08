# Issue #17 — public readiness execution evidence

**Public deployment BLOCKED. Release quality FAIL.** No public URL, remote deployment SHA, recorded video or submission receipt exists in this packet. The founder confirmed there is no existing deployment. Hosting credentials were unavailable; [access observations](hosting-access.json) record this without credential values. Keep #17 open. No PR was merged by this work.

Initial main: `b8860883f1732f92d37d020038a82845c74b0fff`. Subsequently integrated main: `d5fd1129844082d5606b2446d979d2090f6f1da5` (including #45, #46 and #48). Clean archived application candidate tested: **`e1cb957d248f867aa014e008aaee07c50caca592`**, including the standalone Next deployment configuration. This is a main-integrated release candidate, not literal unmodified main. Final staging/local smoke harness: `cb0f2e68695ae4fce4b34f2c3aeeef9a0fc417b9`; later documentation/capture audit changes do not alter that application bundle. Reports retain execution UTC timestamps, actual source SHAs and local paths; those paths identify the original executor, not committed deployable binaries.

## Executed checks

| Command / scope | Actual result | Evidence |
| --- | --- | --- |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/release/preflight.mjs --out /workspace/work/public17-merged-qa` | Technical PASS, submission BLOCKED, exit 0 without `--require-submission` | [Full report](post-viewer-candidate-qa/report.json), [command logs](post-viewer-candidate-qa/commands) |
| Fresh frozen install; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` | PASS; 90 contract + 170 web tests | Same report/logs; source `e1cb957` |
| Kernel / coordinates / world assets / release tools | PASS: 48 / 18 / 50 / 7 tests | Same report/logs |
| Original / actual API integration / strict browser suites | PASS: 12/12, 2/2, 26/26; zero skipped or flaky | [Original](post-viewer-candidate-qa/playwright.json), [integration](post-viewer-candidate-qa/integration-playwright.json), [strict](post-viewer-candidate-qa/judge-qa/playwright.json) |
| Genuine PNG integrity | PASS: 46/46 original, 126/126 strict | [Original validation](post-viewer-candidate-qa/screenshots/validation.json), [strict validation](post-viewer-candidate-qa/judge-qa/validation.json) |
| `node scripts/release/stage-standalone.mjs --preflight /workspace/work/public17-merged-qa/report.json --out /workspace/work/public17-staged` | PASS: 2,032 files, 22 internal symlinks, zero escaping symlinks | [Payload report](standalone-payload.json) |
| `HOSTNAME=127.0.0.1 PORT=3218 NODE_ENV=production node /workspace/work/public17-staged/bundle/apps/web/server.js` | Local production server started outside checkout | [Runtime log](commands/standalone-server.txt) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/release/public-smoke.mjs --local-only --origin http://127.0.0.1:3218 --out /workspace/work/public17-staged-smoke` | PASS 9/9; **local only**, public HTTPS NOT RUN | [Report](local-smoke/report.json), [real screenshots and sidecars](local-smoke/screenshots) |
| `node scripts/release/public-smoke.mjs --out /workspace/work/public17-no-public-url` | BLOCKED, exit 2: no public origin | [Report](public-smoke-blocked.json) |
| `node scripts/release/audit-camera-captures.mjs --dir docs/release/evidence/public-readiness/post-viewer-candidate-qa/judge-qa` | **FAIL, exit 1: 24 PASS / 8 FAIL** | [Entire-row audit](post-viewer-candidate-qa/judge-qa/camera-capture-audit.json) |
| Final checkout `pnpm lint`; release-tool tests; narration check | PASS; 7/7 tools, both scripts under estimated 120 seconds | [Lint](commands/final-lint.txt), [tools](commands/final-release-tools.txt), [narration](commands/final-narration.txt) |
| Final lean Docker packaging | BLOCKED: executor's 8GB VFS filesystem exhausted during build; no final image runtime verified | [Attempt records](container-attempts) |

The earlier full-workspace Dockerfile built image `sha256:58ee755d0d9a8648b8fb9c5493b48e9c33529431d8290b364d60babc0dd0d585` at `96cb10d76bdf35a05387ce4dd5966f3db5cda64b`, but it could not start under disk limits and was superseded by the lean Dockerfile. This is not evidence the final Dockerfile built, ran or deployed. The native standalone artifact above did run successfully. No further Docker attempts are needed on this executor.

## Remaining camera defect — owner follow-up required

Historical [#43 failures](../../../evidence/qa-final/README.md) remain untouched at their own source SHA. The new unchanged strict suite's 26/26 PASS is a real command result after #45, but its loop asserts each focused camera button's **right** edge after focus has horizontally scrolled it. It does not check the entire camera row after subsequent station changes. The capture sidecars expose a remaining defect even though document width remains 320px:

- At 320×844 in both themes, `journey-clean-uw`: FOLLOW rectangle **x=285.5625, y=635.609375, width=68.1875, height=44, right=353.75**.
- After FOLLOW/INSPECT, RESET rectangle **x=-34, width=54.390625, right=20.390625**; INSPECT state y=567.609375 and FOLLOW/fault-UW state y=635.609375. The row clips controls rather than widening the document.
- Exact button classes: `!min-w-0 shrink-0 !px-2.5`; group accessible name `Camera station`. Reproduce: start synthetic survey → advance → select Inspection ROV → cycle camera stations → UW → FOLLOW → INSPECT. Test both themes at actual 320px, then inspect every control, including those not focused.

The new audit validates PNG hashes/dimensions and the existing measured DOM offenders across 32 camera-state captures; all eight failing states are at 320px. It is a capture analysis, not a new browser execution. It does not certify clipping inside containers or full accessibility. No mission-world files were changed; this evidence is ready for ZCode Agent B's review. Overall release quality remains FAIL until corrected and independently rerun. No new issue was created.

## Visual inspection and truthful demo scope

Manually inspected seven actual images: 1024px light Replay; 390px dark fault-UW; 320px dark INSPECT; native 200% dark home (1440×813 physical / 720×406 CSS) and light mission (2048×813 physical / 1024×406 CSS); local 1440px recorded-ghost/FOLLOW and no-WebGL screenshots. The inspector and replay text are readable in those inspected states, the selected ROV is visible in FOLLOW, and no-WebGL provides actual synthetic robot observations plus a static-anchor map. The mobile INSPECT image visibly clips the camera row. This is not a claim that all 181 images received manual review.

The original/strict PNG sets include both themes at genuine desktop/mobile dimensions and native zoom captures; sidecars retain IHDR dimensions, screenshot options, DPR, SHA, URL and theme. Local smoke adds nine genuine 1440×900 DPR1 images. No desktop image is represented as mobile evidence. The browser is Chromium 156.0.8078.79 with software WebGL; physical-device GPU performance was NOT RUN.

The local smoke uses empty browser storage/cookies, actual production API routes, no login/bypass headers, no TLS bypass and no response mocks. At matched seed/time 1000ms, optical quality falls from **0.692125 to 0.083055** under fault while sonar stays **0.63932**. The endpoint accepts 400 steps (200,000 simulated ms; 793,246 response bytes), rejects 408 total steps, 101 operations and 13 steps per operation with 400, and rejects 16,385 input bytes with 413. These request bounds are not a per-IP rate limiter. Host concurrency/response/time limits remain NOT RUN. Canonical observation pagination/repeatability and fixture-clock/source labels were exercised; no database or wall-clock telemetry receipt is implied.

Recorded ghosts are pre/post-fault observations of the same robot, **not replacement assignment or simulated recovery**. World Dive start/skip and reduced-motion behavior were checked with preferences set before reload; changing the OS preference live was NOT RUN. Mission copy still contains an old static-preview explanation and initial sensor headings can show n/a; owner changes are outside this slice. No runtime AI, verified physical/SITL telemetry, actual devnet escrow/reassignment/payout or external verdict was established. Main CI [42429323169](https://github.com/CosmasMandikonza/Vorqyn/actions/runs/42429323169) succeeded at `d5fd112`; that does not prove a live financial flow. Local Rust/Anchor/devnet signing was NOT RUN.

## Founder actions

1. Review this PR; retain the 320px failure and have its owner resolve it. Run the unchanged suites **and** entire-row audit on the final reviewed merged source. This branch does not merge itself.
2. Sign into a compatible host and perform the concrete [Railway import/Dockerfile/port/domain steps](../../DEPLOYMENT.md#exact-founder-hosting-action). No provider account or billing choice was made. Retain the actual provider source/deployment ID, then run the anonymous HTTPS smoke on the literal generated URL. Localhost is not a public deployment.
3. Use [confirmed-scope copy](../../SUBMISSION_COPY.md) and the [110-second recording plan](../../RECORDING_PLAN.md). Narration is 205 words / estimated 102.5 seconds at 120wpm; actual filming, media inspection and public upload are NOT RUN. Optional devnet inset requires Omar's genuine explorer/program/transaction proof first. Record, inspect audio/video/duration, upload publicly and verify signed out.
4. Sign in to the [actual MLH submission form](https://www.mlh.com/events/solana-hackathon/submissions/new) now; the unauthenticated probe redirected to sign-in, so required form fields and acceptance remain unverified. Follow the [submission desk](../../SUBMISSION.md): Sunday Nov 8 initial **9:00 AM CST / 10:00 AM EST**; final **10:45 AM CST / 11:45 AM EST**. Preserve actual public repository/video URLs and genuine receipt privately; do not infer receipt from opening the form.

[Summary](summary.json), [source/attribution observations](source-and-attribution.json) and all proof-null fields distinguish technical success from remaining release failures and human publication gates. Existing third-party notices were hashed/reviewed as existing files, not an exhaustive legal review.

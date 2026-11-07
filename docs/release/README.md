# RELEASE-01 — run, inspect, record, submit

This directory is the release entry point for [Issue #34](https://github.com/CosmasMandikonza/Vorqyn/issues/34). It supplies executable verification and materials; it is not a claim of a deployed app, produced video, real chain settlement or accepted submission. See [the observed evidence and findings](../evidence/release/README.md).

For the later merged API/playback and shared-shell audit under Issue #16, use [JUDGE_QA.md](JUDGE_QA.md) and its new evidence namespace. The older packet below records its original SHA; its absent-integration results are historical. The preflight now also runs the strict judge-QA matrix and capture validator.

## 1. Reproduce on Linux or Windows through WSL2

Use the selected, reviewed **committed SHA**, not an agent's unmerged working edits. Required tools: Git, tar, Node **22.21.1**, pnpm **10.34.5** and Chromium/Playwright. The Node/pnpm pins come from `.nvmrc` and `packageManager`. No app dependencies or root scripts are added by this work.

```bash
git clone https://github.com/CosmasMandikonza/Vorqyn.git
cd Vorqyn
# Check out the actual reviewed release SHA after the founder selects it.
nvm install 22.21.1
nvm use 22.21.1
corepack enable
corepack prepare pnpm@10.34.5 --activate
node scripts/release/preflight.mjs --out ../vorqyn-release-run-01
```

If Chromium is installed by the environment (the managed run used `/usr/bin/chromium`), explicitly select it:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/release/preflight.mjs --out ../vorqyn-release-run-02
```

On a new workstation without a browser binary, prepare the locked app dependencies and install the browser through the existing Playwright dependency, then rerun with a fresh output directory:

```bash
pnpm install --frozen-lockfile
pnpm --filter @vorqyn/web exec playwright install chromium
```

If Linux browser libraries are missing, install the appropriate Playwright system dependencies through your normal approved workstation/CI administration flow. Do not turn a failed launch into a passing browser result. Windows users should run the commands in **WSL2**, with the project in the WSL filesystem, and may use the host browser/recorder for manual filming. Native PowerShell/cmd preflight execution and native Windows browser automation were not tested. Linux CI can run the same Node command after the existing pinned setup; this PR does **not** change CI.

### What the preflight does

It archives **committed HEAD** into a fresh disposable directory, verifies that no `node_modules` exists there, and performs a frozen-lockfile install. It never deletes the working checkout's dependencies or copies ignored `.env` files. A dirty-working-tree flag means uncommitted changes were excluded; commit intended code before the real release check.

The report includes exact commands, exit codes, logs, source SHA and timings for lint, strict types, existing unit tests, production build, core simulation tests, world-coordinate integration tests, asset hashes/deterministic regeneration, release-tool tests, narration checks, offline kernel demo, browser smoke/capture and upcoming integration tests. Runtime configuration checks reject non-devnet public cluster settings, public credential-shaped service URLs and supported tracked-secret patterns without logging their values. A heuristic scan is not a guarantee that no secret exists; perform human review too. The static viewer and local planner require no external secret/service configuration.

The default browser projects use the **production build** at `127.0.0.1:3110`; that local origin is not a deployment URL. A conflicting existing server is an error, not silently reused. Existing Rust scaffold checks are exercised by the unchanged GitHub CI; no local Anchor/Solana validator, signing or devnet spending is performed by this preflight.

### Result semantics

- **PASS:** the recorded assertion/command actually succeeded.
- **FAIL:** a check ran and found a defect, including layout overflow or malformed output.
- **BLOCKED:** a required capability/proof is absent, including the unmerged simulation API/playback, public deployment/video or authenticated submission receipt.
- **NOT RUN:** no observation was made, with an explicit reason. It never aggregates to PASS.

Exit `0` means required technical checks passed. Exit `1` means at least one FAIL. Exit `2` means incomplete/blocked technical checks, or blocked submission readiness when `--require-submission` is supplied. **Always inspect `submissionStatus` separately:** local test success cannot certify external publication or receipt. `--technical-only` explicitly leaves browser checks NOT RUN, so it cannot certify all release gates. No test is silently skipped to make current missing functionality pass.

At the checked release base, the strict browser capture suite **fails at 320px** and the real upcoming integration assertions are **BLOCKED**. A nonzero preflight is the correct result. Fixes belong to the named integration/viewer owners, then rerun on merged main; do not weaken the release tests.

## 2. Run/capture separately after a production build

```bash
pnpm install --frozen-lockfile
pnpm build
RELEASE_ARTIFACT_DIR="$PWD/../release-captures-01" \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @vorqyn/web exec playwright test \
  --config ../../scripts/release/playwright.config.mjs \
  --project judge --project capture
node scripts/release/validate-captures.mjs --dir ../release-captures-01/screenshots
```

Use a **new artifact directory for every run**. Global setup rejects stale capture directories and writes a unique run marker; each PNG has a measured viewport/DPR/crop/hash sidecar tied to that marker. Reusing old sidecars cannot certify a new run.

The expected 46 viewport PNGs cover light/dark at **1440×900**, **390×844**, **320×844**: landing, guest, local-draft entry, viewer RESET/UW/INSPECT, fallback, plus in-flow mobile inspectors. Captures are **not** `fullPage`, canvas-only crops, resized images or filename-based dimension claims. Soft layout assertions still fail their tests while preserving every failure image for inspection. The validator verifies dimensions, run identity and hashes; it does **not** certify visual composition or accessibility.

Inspect `playwright.json`, `screenshots/validation.json` and the `*.json` measured sidecars. Look at UW/INSPECT for recognizable targets, readable inspector text and deliberate framing. Check mobile camera bounds and inspector separation. Old `docs/evidence/vq-07-view/04-underwater-light-1440.png` and `05-inspect-light-1440.png` are actually **1329×558**; they remain untouched and are superseded only by explicitly labeled new evidence. Old 390px captures are historical; use the new post-fix main captures and measured no-overlap checks. The native zoom smoke test sets real Chromium zoom through Settings; it is not a CSS scale or smaller viewport substitution.

Upcoming API/playback checks are a separate, real project:

```bash
RELEASE_ARTIFACT_DIR="$PWD/../release-integration-01" RELEASE_STAGE=integration \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @vorqyn/web exec playwright test \
  --config ../../scripts/release/playwright.config.mjs --project integration
```

Raw Playwright marks absent-implementation assertions failed with a `BLOCKED:` reason. The preflight preserves the raw nonzero result and classifies only those explicit missing dependencies as BLOCKED; a present-but-wrong endpoint remains FAIL. These tests never mock the transport. After #32/#33 merge, require an actual deterministic fault/stale response and browser POST/provenance before enabling integrated narration. Client stale/out-of-order telemetry behavior is not proven while the real integration is absent.

## 3. Founder local recording session

```bash
pnpm --filter @vorqyn/web start --port 3000
# In a second terminal, from the same checkout:
node scripts/release/kernel-demo.mjs
node scripts/release/check-narration.mjs
```

Open `http://localhost:3000` in a clean browser profile. Use the [shot-by-shot plan](RECORDING_PLAN.md) and currently enabled [contingency narration](narration-contingency.txt). The alternate [synthetic-integrated narration](narration-integrated-synthetic.txt) is gated, not a claim that it works on the release base. Word/time checks are estimates; no recording is created by these scripts.

After actually producing and inspecting a recording:

```bash
node scripts/release/check-media.mjs --file work/demo-final.mp4
```

`ffprobe` from FFmpeg must be available. The script checks a real file for audio/video streams and duration ≤120 seconds. The founder still must listen for the opening hackathon identification, inspect source/limitation statements, verify public upload visibility and obtain a real submission receipt.

## 4. Submit with actual public artifacts

Use [the founder submission desk](SUBMISSION.md), [current-scope project copy](SUBMISSION_COPY.md) and `submission-status.json`. The initial cutoff is **9:00 AM CST Sunday November 8**; the final/hacking cutoff is **10:45 AM CST**. Read the documented portal discrepancy and required sign-in action. No account credentials, hosting connection, video, chain proof or submission receipt are supplied by this release task. Parent #17 remains pending until the human public/accepted-submission gates are verified.

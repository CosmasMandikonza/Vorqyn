# Public judge deployment — Issue #17

Initial base **`b8860883f1732f92d37d020038a82845c74b0fff`**. Main **`d5fd1129844082d5606b2446d979d2090f6f1da5`** was subsequently integrated after viewer #45 and Lane 1 #46/#48 landed; post-viewer candidate source `e1cb957d248f867aa014e008aaee07c50caca592` passed the unchanged full preflight. This is a candidate audit including deployment configuration, not a claim that an untested later main or public deployment passed. Branch `feat/lane2-release-public-readiness`. [Founder handoff](https://github.com/CosmasMandikonza/Vorqyn/issues/17#issuecomment-6712963300).

**Public deployment: BLOCKED pending a compatible hosting account/project.** No GitHub deployment record or compatible provider credential was observed. The runtime reports no configured secrets/outbound identities; checked provider variables/auth files are absent. No public URL, deployment ID, video or receipt is asserted. `submission-status.json` retains its null fields. The connected Sites host accepts static output or a Cloudflare Worker fetch module; the existing Next.js Node API is neither. A framework migration is outside this slice.

## Reproduce the actual Node deployment build

A static export/GitHub Pages upload loses `/api/demo/simulation` and is unsuitable. This Dockerfile retains the Next.js Node server, external workspace kernel/contracts imports and public GLB/metadata/font files. Production routes/components/services are unchanged. The only Next configuration change enables `output: standalone` and the workspace tracing root so the actual external kernel/contract imports survive packaging.

The image pins Node **22.21.1**, pnpm **10.34.5** and the frozen lockfile; builds the actual Next workspace; runs as UID 1000; binds `0.0.0.0`; honors `PORT` (default 3000). The build stage retains workspace dependencies for compilation; the runtime stage copies only the traced standalone server, public files and static assets. This avoids shipping the full development tree. Context excludes Git/local caches, `.env*`, keypair/wallet JSON, historical evidence and Solana programs. This guest synthetic path needs no wallet, RPC or AI credential.

From a reviewed **committed checkout**, with Docker BuildKit available:

```bash
node scripts/release/build-container.mjs --out ../vorqyn-container-run-01
```

Choose a new directory. The helper archives committed HEAD into an isolated context, scans supported credential patterns before installing, builds the image and records SHA, revision label, image ID, logs and exit state. Uncommitted changes are excluded and flagged. No registry push/deployment/login occurs. A managed session can supply `CODEX_PROXY_CERT` through a temporary BuildKit secret; no CA is copied into the image and TLS verification stays enabled. Ordinary hosts need no session CA.

Equivalent provider build/start, from repository root:

```bash
docker build -f scripts/release/deploy/Dockerfile \
  --build-arg VORQYN_BUILD_SHA="$(git rev-parse HEAD)" \
  -t vorqyn-judge:reviewed .
docker run --rm --name vorqyn-judge-preview \
  --memory 512m --cpus 1 --pids-limit 128 \
  -p 127.0.0.1:3217:3000 vorqyn-judge:reviewed
```

This exposes **loopback only**, not public HTTPS. Record provider source SHA independently; an operator-supplied image label is not cryptographic deployment attestation. See [execution evidence](evidence/public-readiness/README.md) for the actual build/runtime results, image and limits exercised.

## Verified native Node artifact (no Docker daemon needed)

The clean native production build and isolated traced Node runtime passed. Docker packaging on this executor remained **BLOCKED by its 8GB VFS filesystem**, despite a superseded full-workspace image building earlier; no final lean container runtime or remote container deployment is claimed. Use the tested native artifact path below, or let a compatible provider with sufficient build disk use the Dockerfile.

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/release/preflight.mjs --out ../node-preflight-01
node scripts/release/stage-standalone.mjs \
  --preflight ../node-preflight-01/report.json --out ../node-artifact-01
HOSTNAME=127.0.0.1 PORT=3217 NODE_ENV=production \
  node ../node-artifact-01/bundle/apps/web/server.js
```

The staging helper requires a recorded successful production build, copies only its standalone server/public/static payload, rejects escaping symlinks and environment/wallet files outside dependencies, and records source SHA, build ID, source-report hash and server hash. It preserves the source preflight readiness statuses instead of converting a failed release gate into PASS. The tested bundle is outside the checkout and has zero escaping symlinks; no repository dependency fallback is needed. Public hosting still requires account access and TLS.

## Exact founder hosting action

One compatible route is a Docker-capable [Railway](https://railway.com/dashboard) service. No project, account/billing choice or deployment was created here.

1. Sign in to Railway. Create a project with **Deploy from GitHub repo**, authorize the intended account/repository and select `CosmasMandikonza/Vorqyn`.
2. Select reviewed merged source. Keep repository root as build context. Set the Dockerfile path to **`scripts/release/deploy/Dockerfile`**, or `RAILWAY_DOCKERFILE_PATH` with that value if exposed as a variable.
3. Use Docker deployment, not static hosting. Set `PORT=3000` and forward that port. If build arguments are supported, set `VORQYN_BUILD_SHA` to the actual selected SHA. Retain the dashboard source/build record regardless of label availability.
4. Choose account/plan and resource/spending limits in the provider UI. Local testing does not establish provider price, quotas or capacity. Add no wallet/AI keys or fictitious program IDs.
5. Start deployment and inspect real build/runtime logs. After successful startup, choose **Settings → Networking → Public Networking → Generate Domain**, targeting port 3000. Copy the literal host-generated HTTPS origin; no domain is reserved or predicted here.
6. Retain actual deployment ID, source SHA, image/version, timestamps and sanitized logs. Verify without provider/repository login. An authenticated dashboard preview or tunnel is insufficient.

If UI wording differs, use the provider's documented equivalent and retain errors. A native Vercel deployment is another possible founder choice but was not authenticated/exercised here; no Vercel configuration is represented as verified.

## Signed-out external smoke

After a real URL exists, use the locked Playwright dependency and a fresh output directory:

```bash
RELEASE_PUBLIC_ORIGIN='paste the actual host-generated HTTPS origin here'
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/release/public-smoke.mjs \
  --origin "$RELEASE_PUBLIC_ORIGIN" --out ../vorqyn-public-smoke-01
```

The command rejects credentials/query tokens, placeholder/local domains, IPs, paths and non-HTTPS public origins. It uses fresh empty browser contexts, no login/header injection, no TLS bypass and no mocked API. It checks `/`, `/demo`, `/demo/mission`, `/workspace/create`, actual kernel POST determinism/fault/request bounds, canonical paged observation trace, real Start/step/fault/replay/2D, World Dive start/skip, recorded ghost toggles and disabled-WebGL text observations. Genuine 1440×900 viewport PNGs have IHDR/hash/options/URL/source sidecars. Checkout SHA identifies the harness; establish the remote source SHA from provider proof separately.

For **local harness validation only**, add `--local-only --origin http://127.0.0.1:3217`; its report says public HTTPS was NOT RUN. Without an origin, the command records BLOCKED and exits 2. No localhost link becomes a public deployment URL, and no command automatically fills proof JSON nulls.

## Server limits and remaining gates

Current API limits: **16,384 input bytes**, **100 operations**, **1–12 steps per operation**, **400 total steps**, **500ms per simulated step**. Malformed requests return 400, oversized bodies 413, rejected kernel operations 422 and non-POST methods 405; responses are `no-store`. The smoke exercises negative/boundary requests and records observed values.

These are **per-request trace bounds**, not an incoming per-IP quota. No rate limiter or authenticated company backend is implemented by this route. Provider response-size/time/concurrency limits and sustained-load protection must be verified on the chosen host; public checks remain NOT RUN while hosting is BLOCKED. The journal library's default 512-record cap is a separate library bound, not HTTP persistence.

[#43 evidence](../evidence/qa-final/README.md) remains unchanged: camera edge 392.359375px at 320/390 and inspector intercepting Replay at 1024. The historical strict report remains 16 PASS / 10 FAIL, zero skipped. After ZCode B's #45 merged, the unchanged strict suite passed 26/26 at candidate `e1cb957`; both results and their source SHAs are retained separately. A 1440px hosting smoke alone did not clear them. A separate full-row screenshot audit now fails 8/32 captured states: at 320px, FOLLOW extends to x=353.75px before horizontal scrolling, while RESET moves to x=-34px afterward, in both themes. The existing suite checks the focused button's right edge, so its 26/26 result does not certify all controls simultaneously visible. See the new evidence README; leave owner code unchanged and keep this failure open. Require another full check on the final reviewed merged release SHA before submission; no assertions were softened or owner components edited here.

The mission route also retains old static-preview explanatory copy beside the live synthetic client; its owner must reconcile that wording. No live devnet financial flow, independent verdict, runtime AI, physical/SITL telemetry, finished film or accepted submission is established by this slice. Keep #17 open.

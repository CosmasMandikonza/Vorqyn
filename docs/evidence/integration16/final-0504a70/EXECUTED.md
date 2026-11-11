# Current integrated source — main 0504a70

This follow-up supersedes the 048 browser/workspace checkpoint after #58 merged. Its raw evidence is retained separately; no prior failure or passing source is silently relabelled. Reviewed main is `0504a703e77a5d34a3698267df260f6f6e21804b`; clean tested QA merge is `be8d899fe5f1d4dafe56478c2f34d0e5fe9d44ae`. Both use the same tracked production modules, lockfile and root CI. Public deployment source remains unknown.

Executed with Node 22.21.1, pnpm 10.34.5 and Chromium 156.0.8078.79:

```bash
git fetch origin main
git merge --no-edit origin/main
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/integration/gate.mjs --out /workspace/work/final-main0504-integration
RELEASE_ARTIFACT_DIR=/workspace/work/final-browser-main0504 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @vorqyn/web exec playwright test \
  --config ../../scripts/release/judge-qa.config.mjs
node scripts/release/validate-judge-qa.mjs --dir /workspace/work/final-browser-main0504
node scripts/release/audit-camera-captures.mjs --dir /workspace/work/final-browser-main0504
node scripts/integration/validate-camera-evidence.mjs --dir /workspace/work/final-browser-main0504
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/release/public-smoke.mjs \
  --origin https://vorqynweb-production.up.railway.app \
  --out /workspace/work/final-public-main0504
INTEGRATION_TARGET_ROOT=/workspace/work/final-pr54 \
INTEGRATION_OWNER_SUITE=mission-orchestration \
  pnpm --filter @vorqyn/web exec vitest run \
  --config ../../scripts/integration/owner-vitest.config.mts \
  --reporter=json --outputFile=/workspace/work/final-owner54-new.json
```

All output directories were fresh. The gate first performs a real frozen install and records a nonzero FAIL exit for the retained P2 null-RPC status expectation; driver/authority connections remain BLOCKED. Installation, lint, types and production build passed. Workspace tests: **394 PASS, 1 inherited gated local-validator test skipped = NOT RUN**. Adapter component tests are included in that total; do not double-count them. Full gate: QA tooling 12/12, original boundaries 20/20 and merged adapter 9/9 PASS; chain-client 4/5, recovery/handoff/orchestration absent; raw-journal direct-verifier metric/clock diagnostics remain blocked as a shortcut, distinct from the now available source-backed adapter.

Current browser: **34/34 PASS, zero skipped**. Screenshot audit: **126/126 strict images PASS;32/32 complete camera states PASS**. Natural Tab/Enter replaces programmatic focus in the six-camera-control regression; real mobile taps, actual stored theme, real API replies and both edges of the full row are required. Capture source/run IDs, IHDR dimensions, hashes and screenshot options are retained. Fresh public functional smoke: **9/9 PASS**, four anonymous pages, both real guest APIs, fault/replay/2D/no-WebGL and no unexpected console errors. TLS is verified; the managed transport proxy is not product login/Authorization.

New #54 actual owner testfiles at `2072dda52ac12431716ff2e42e94ce3331f574dd`: **27/27 PASS**, no skipped/pending. The new canonical demo-driver is a real-store fixture demonstration, not guest ingestion or authenticated mission/wallet/chain integration. [Provenance](owner54-provenance.json). Current source is not approved merely because its unit tests pass.

To inspect/revalidate the complete current browser packet, extract `browser-evidence.zip` into a fresh directory and run the three validators above against that directory. The archive preserves **all original PNG and JSON bytes**, including all 126 strict captures and all 32 camera states; selected originals are separately viewable under `selected/`. Traces are omitted from Git because current cases passed. `manifest.json` records archive/file hashes and `browser-archive-index.json` records every archived file's bytes/hash. No screenshot resizing, desktop substitution, forced click or route fixture is used.

The original [048 packet](../final-048ebac/EXECUTED.md) retains the cold-install-before inventory, 48 kernel/18 coordinate/50 asset checks, the explicitly technical-only preflight (aggregate BLOCKED), public natural-keyboard/draft checks, credential-pattern scan and previous owner diagnostics. Their timestamps and SHAs are historical proof, not a replacement for current-source checks. Exact-main CI 42486911782 succeeded; the final published PR-head CI URL/result is on PR #55 to avoid a self-referential evidence-commit SHA.

No authenticated verifier/wallet operation, actual devnet account/transaction proof, video recording/upload or MLH submission was performed. Nonessential P2s do not hold the initial entry. Stop for independent review; no merge.

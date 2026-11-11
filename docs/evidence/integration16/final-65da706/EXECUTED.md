# Current integrated source — pinned main 65da706

This pinned follow-up supersedes the retained 048 and 0504 checkpoints after reviewed #58 and #54 merges. Later merges are not certified by this manual run. Its raw evidence is retained separately; no prior failure or passing source is silently relabelled. Reviewed main is `65da706f9cb45a09385f13b060c6af7410ab4da5`; clean tested QA merge is `d671f871b461ca1e1c2c0154c353ebff76a93f48`. Both use the same tracked production modules, lockfile and root CI. Public deployment source remains unknown.

Executed with Node 22.21.1, pnpm 10.34.5 and Chromium 156.0.8078.79:

```bash
git fetch origin main
git merge --no-edit origin/main
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/integration/gate.mjs --out /workspace/work/final-main65-integration
RELEASE_ARTIFACT_DIR=/workspace/work/final-browser-main65 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm --filter @vorqyn/web exec playwright test \
  --config ../../scripts/release/judge-qa.config.mjs
node scripts/release/validate-judge-qa.mjs --dir /workspace/work/final-browser-main65
node scripts/release/audit-camera-captures.mjs --dir /workspace/work/final-browser-main65
node scripts/integration/validate-camera-evidence.mjs --dir /workspace/work/final-browser-main65
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/release/public-smoke.mjs \
  --origin https://vorqynweb-production.up.railway.app \
  --out /workspace/work/final-public-main65
node scripts/integration/gate.mjs --component handoff \
  --target-root /workspace/work/integration16-pr53 \
  --out /workspace/work/final-handoff-canonical-truth
```

All output directories were fresh. The gate first performs a real frozen install and records a nonzero FAIL exit for the retained P2 null-RPC status expectation; driver/authority connections remain BLOCKED. Installation, lint, types and production build passed. Workspace tests: **421 PASS, 1 inherited gated local-validator test skipped = NOT RUN**. Adapter and canonical-store component tests are included in that total; do not double-count them. Full gate: QA tooling 12/12, original boundaries 20/20 and merged adapter 9/9 PASS; chain-client 4/5, recovery/handoff absent; real orchestration connection beyond the merged trusted store remains BLOCKED; raw-journal direct-verifier metric/clock diagnostics remain blocked as a shortcut, distinct from the now available source-backed adapter.

Current browser: **34/34 PASS, zero skipped**, harness4c7f712160ff7c19f2dd3d4003301ccb5d28ac18 over the same pinned production bytes. Screenshot audit: **126/126 strict images PASS;32/32 complete camera states PASS**. Natural Tab/Enter replaces programmatic focus in the six-camera-control regression; real mobile taps, actual stored theme, real API replies and both edges of the full row are required. Capture source/run IDs, IHDR dimensions, hashes and screenshot options are retained. Fresh public functional smoke: **9/9 PASS**, four anonymous pages, both real guest APIs, fault/replay/2D/no-WebGL and no unexpected console errors. TLS is verified; the managed transport proxy is not product login/Authorization.

Merged #54 actual owner testfiles at `2072dda52ac12431716ff2e42e94ce3331f574dd`: **27/27 PASS**, no skipped/pending. The new canonical demo-driver is a real-store fixture demonstration, not guest ingestion or authenticated mission/wallet/chain integration. [Previous source-specific diagnostic provenance](../final-0504a70/owner54-provenance.json). The merged workspace now includes those27 cases; do not add them again to421. Current source is not approved merely because its unit tests pass.

To inspect/revalidate the complete current browser packet, extract `browser-evidence.zip` into a fresh directory and run the three validators above against that directory. The archive preserves **all original PNG and JSON bytes**, including all 126 strict captures and all 32 camera states; selected originals are separately viewable under `selected/`. Traces are omitted from Git because current cases passed. `manifest.json` records archive/file hashes and `browser-archive-index.json` records every archived file's bytes/hash. No screenshot resizing, desktop substitution, forced click or route fixture is used.

The original [048 packet](../final-048ebac/EXECUTED.md) retains the cold-install-before inventory, 48 kernel/18 coordinate/50 asset checks, the explicitly technical-only preflight (aggregate BLOCKED), public natural-keyboard/draft checks, credential-pattern scan and previous owner diagnostics. Their timestamps and SHAs are historical proof, not a replacement for current-source checks. Exact-main CI 42487137784 succeeded; the final published PR-head CI URL/result is on PR #55 to avoid a self-referential evidence-commit SHA.

No authenticated verifier/wallet operation, actual devnet account/transaction proof, video recording/upload or MLH submission was performed. Nonessential P2s do not hold the initial entry. Stop for independent review; no merge.

#53 NEW5795018bb67841dae379e4150b82f5bfff2ec016 actual-export acceptance **6/7 PASS,1 FAIL**, clean harness04b9f6136bb321661b2da088901fcac0da6f43c8. The actual shared `rehydrate` accepts a canonical paid history plus unknown→rejected observations and preserves paid status, while the actual owner projection claims no funds moved. Original initiated/finalized/recipient checks pass; no old failure is presented as current. This is a fixture-only presentation contradiction, not an observed chain balance/transaction. [Report](candidate-handoff/report.json), [raw assertions](candidate-handoff/handoff.json).

Final extended typecheck/lint after adding that canonical-history assertion are retained as `complete-typecheck.txt` and `complete-lint.txt`. The public credential-pattern scan was refreshed after the new main source; no supported patterns found in tested HTML/linkedJS, within heuristic scope.

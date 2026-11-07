# VQ-03-UX / Issue #28 — local mission planning

[Issue #28](https://github.com/CosmasMandikonza/Vorqyn/issues/28) · Founder / Lane 2 · `feat/lane2-mission-draft-ux` → `main`.

Verified base: `01f8ada474558c215ee34e0b38570993897e95a0`. The branch was created in a separate worktree after fetching current main; main was re-fetched before handoff and was unchanged. Functional code: `f2c4cbaff37c478dc8b3f7b98571cd19dabca0b9`. Final head is recorded in the PR description; the following commit adds evidence and corrects screenshot filename width labels; production behavior is unchanged.

This is a functioning browser-local planning workflow, not completion of parent #4. It creates distinct editable local drafts; it does not create authenticated organizations, securely store company data, register operators, run robots, fund wallets or launch missions.

## Delivered workflow

1. Objective: bounded fictional title, the one supported port template, and a compatible inspection objective.
2. Environment: actual zone IDs/labels, waterline-relative heights and damaged flags from `assets/port-world/world.json`.
3. Capabilities: proposed drone/rover/ROV sensor requirements for the selected environments, including ground route-mapping and underwater evidence compatibility checks.
4. Evidence/budget: whole-percent acceptance thresholds, optical/sonar evidence method and exact SOL-to-lamport conversion using decimal strings and BigInt.
5. Review/save: complete selected settings, links to edit earlier steps and an explicit validated local save. Partial progress also autosaves for reload recovery.

A separate local-draft library supports stable cryptographic UUIDs, independent A/B configurations, reopen/edit, repeated-save idempotence and confirmed deletion. Every view prominently states **Local Mission Draft · Saved in This Browser · Not Funded or Launched**.

## Exact commands and observed results

Linux; Node 22.21.1; pnpm 10.34.5; Next 15.5.29; Chromium 156.0.8078.79. Commands ran from the independent `/workspace/work/vq28` checkout with the pinned Node/pnpm on PATH. Terminal escape sequences/trailing whitespace are removed from saved logs for readability.

| Command                                                                                                                                                                    | Result                                                                                                    | Evidence                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                           | Exit 0; all workspace projects; no lockfile changes                                                       | [install](commands/install.txt)                                       |
| `pnpm lint`                                                                                                                                                                | Exit 0; no warnings/errors                                                                                | [lint](commands/lint.txt)                                             |
| `pnpm typecheck`                                                                                                                                                           | Exit 0; web and existing contracts scaffold                                                               | [typecheck](commands/typecheck.txt)                                   |
| `pnpm test`                                                                                                                                                                | Exit 0; **33 frontend tests** (27 new + 6 existing), plus **1 existing contract-scaffold test**; no skips | [unit](commands/unit.txt)                                             |
| `pnpm build`                                                                                                                                                               | Exit 0; `/workspace/create` statically prerendered; no warnings                                           | [build](commands/build.txt)                                           |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm --filter @vorqyn/web exec playwright test -c tests/mission-builder/playwright.config.ts`                       | **22 passed**, no failures/skips/flaky tests; 1.2 minutes                                                 | [browser](commands/browser.txt), [summary](verification-summary.json) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm --filter @vorqyn/web exec playwright test -c tests/mission-builder/playwright.config.ts -g 'distinct A and B'` | **1 passed**; targeted evidence rerun after adding a post-deletion screenshot; production code unchanged  | [capture rerun](commands/capture-rerun.txt)                           |
| `git diff --check origin/main`                                                                                                                                             | Exit 0 on completed branch                                                                                | Whitespace verified before submission                                 |

The first working checkpoint (`c30a74f`) was rendered in Chromium: title and selected underwater region survived reload at step 2. The initial unit suite was red before implementation because the required modules did not exist. Early browser runs exposed test ambiguity with Next's separate route-announcer alert and a test that checked the saved step before its newer checkbox selection had autosaved. Scoped selectors and waiting for the actual saved selection corrected the harness. An anchored grep initially selected no tests; the corrected targeted command above ran and passed. Earlier failed/empty runs are not presented as successful coverage.

## Demonstrated browser journeys

- Create A with underwater inspection/sonar and **2.000000001 SOL = 2000000001 lamports**.
- Create B with a different ground road region/route mapping and **7.5 SOL**. Both retain separate UUIDs and data after reload.
- Reopen A, edit its title, and verify B's budget remains 7.5. Repeated Save does not create duplicates.
- Cancel deletion, then confirm deleting A. B remains and reopens after another reload.
- Preserve incomplete input and current step through reload after autosave.
- Focus the first invalid title, region/capability group and budget input; reject incompatible sensors/evidence and over-precise budget input. Accept one lamport exactly.
- Preserve corrupt/future-version data until explicit reset confirmation; reject tampered unsupported zones without overwriting their source.
- Block browser storage and quota writes; keep memory-only editing, visible failure status and navigation-away confirmation. Web Locks unavailable: no unsafe write fallback.
- Two tabs: detect a changed revision, preserve a separate copy under a new ID, and refuse to resurrect a subsequently deleted ID.
- Render markup-looking title text safely through save/reload, without creating an image/script or browser alert.
- Eight light/dark/width cases pass overflow and console checks. Nineteen axe WCAG A/AA audits pass across review, objective, environment, capabilities and evidence views.
- Native 200% Chromium zoom: 1440px outer window, 720px layout, DPR 2; keyboard Enter/Tab focus and checkbox Space interaction work. Reduced motion is enabled for the responsive capture matrix; this workflow introduces no animation.

## Real screenshots

All images are actual production Chromium captures. Full-page capture scrolls to the top first, avoiding Chromium's inclusion of off-viewport fixed controls at a prior scroll offset. No screenshot content is fabricated or edited.

| View/theme      | 1440                                        | 1024                                        | 390                                        | 320                                        |
| --------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| Objective/light | [PNG](screenshots/objective-light-1440.png) | [PNG](screenshots/objective-light-1024.png) | [PNG](screenshots/objective-light-390.png) | [PNG](screenshots/objective-light-320.png) |
| Objective/dark  | [PNG](screenshots/objective-dark-1440.png)  | [PNG](screenshots/objective-dark-1024.png)  | [PNG](screenshots/objective-dark-390.png)  | [PNG](screenshots/objective-dark-320.png)  |
| Review/light    | [PNG](screenshots/review-light-1440.png)    | [PNG](screenshots/review-light-1024.png)    | [PNG](screenshots/review-light-390.png)    | [PNG](screenshots/review-light-320.png)    |
| Review/dark     | [PNG](screenshots/review-dark-1440.png)     | [PNG](screenshots/review-dark-1024.png)     | [PNG](screenshots/review-dark-390.png)     | [PNG](screenshots/review-dark-320.png)     |

Additional proof: [distinct A/B](screenshots/distinct-a-b-light-1280.png), [B preserved after deletion](screenshots/after-delete-b-preserved-light-1280.png), [required-field error](screenshots/validation-title-light-390.png), [environment](screenshots/step-2-light-1280.png), [capabilities](screenshots/step-3-light-1280.png), [evidence/budget](screenshots/step-4-light-1280.png), [corrupt JSON](screenshots/corrupt-storage-light-1280.png), [future schema](screenshots/future-schema-light-1280.png), [native zoom](screenshots/native-zoom-200.png).

Visual inspection included the first working environment render, full objective/light desktop and review/dark 320px captures, plus final light/dark responsive comparison sheets and workflow/error states. Observed readable control labels and summaries, wrapped IDs and exact amounts, mobile stacked progression, and no horizontal clipping. The small-screen layout is a vertically flowing planning form with the library above it, not a 3D-control dashboard.

## Changed paths and boundaries

- `apps/web/app/workspace/create/page.tsx`: server route/metadata, product heading and clear browser-local/privacy disclosure.
- `apps/web/components/mission-builder/{mission-builder.tsx,use-drafts.ts,builder.module.css}`: five steps, local library, review/edit/delete, focus/errors, responsive styling scoped to this feature, autosave and storage recovery UI.
- `apps/web/lib/workspace-draft/{metadata.ts,schema.ts,storage.ts,README.md}`: actual zone metadata, private input shape/policies, exact money parsing, bounds, validation, versioned storage and Web Locks/revision coordination; future adapter boundary.
- `apps/web/app/workspace/page.tsx`: only a clearly labeled local-draft CTA plus browser-local status; existing template preview is retained.
- `apps/web/tests/mission-builder/**`: dedicated unit and production browser tests/config. Existing test configuration is reused; no root configuration change.
- `docs/evidence/vq-03-ux/**`: this packet, real captures, exact logs and metadata-source hash.

No edits to `/demo`, 3D viewers, assets, simulator, shared contracts/UI/global styling, Solana, dependency manifests/lockfiles or CI. No dependencies, fonts or assets added. Existing VORQYN Button/Badge, tokens and local OFL fonts are reused; new layout/form code is original. Existing source/license notices remain unchanged.

## Storage, security and eventual integration

See the [private schema/repository boundary](../../../apps/web/lib/workspace-draft/README.md). The world metadata hash is recorded in [world-metadata-sha256.txt](world-metadata-sha256.txt).

Web Locks serialize read/revision-check/write across tabs; revisions are per draft. The envelope is v1, capped at 20 records/128 KiB, with strict field whitelists and full validation for a final save. Partial drafts can have unfinished values; they cannot masquerade as a reviewed brief. Future schema versions do not silently migrate or reset. Reset deletes only the local-draft namespace and refuses to wipe a now-readable collection.

The metadata contains vehicle classes but **no sensor catalogue**. Sensor choices are explicitly proposed product requirements. Unsupported templates and invented zones are not selectable. Nothing is represented as a real registered operator or safety clearance.

Lane 1's future canonical adapter must map and revalidate template/zone versions, objectives, capabilities, evidence policy and exact lamports; obtain real authenticated owner/organization IDs; establish server IDs/idempotency and tenant isolation; and accept authoritative server/chain state. This branch invents none of those interfaces and emits no mission events. Parent #4 is not closed by this work.

## Limits / unrun work

- Browser data is unencrypted, origin-scoped and can be cleared, evicted or modified. This is not secure organizational persistence. Obvious credential/mnemonic title patterns are blocked, but heuristics cannot guarantee that arbitrary text is non-sensitive; fictional planning names are required.
- HTTPS/localhost, crypto UUID and Web Locks support are required for persistent editing. Storage/lock failures are explained and do not silently downgrade to unsafe multi-tab writes.
- The latest 450ms pending input can be lost if a user confirms discard or forcibly terminates the browser. Confirmations and explicit saved/unsaved messages cover ordinary navigation; there is no server durability guarantee.
- Firefox, Safari, real mobile hardware and a manual platform-screen-reader session were not tested. Automated role/focus/keyboard/axe checks are not universal accessibility certification.
- No auth, tenancy, shared organization data, backend adapter, real mission launch, simulation integration, AI, wallets or funding is implemented or tested here.
- Existing GitHub CI runs its unchanged Node, asset/simulator and Rust gates; the PR records its actual final outcome. Browser checks are separate from CI.

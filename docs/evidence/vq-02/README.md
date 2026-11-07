# VQ-02 review evidence

[Issue #3](https://github.com/CosmasMandikonza/Vorqyn/issues/3) · Lane 2 / founder · branch `feat/vq-02-experience` · target `main`.

Base verified from a fresh fetch: `dfd10cd047d9056d02c1e33a6514c02674fec596`. Re-fetched before handoff; unchanged. Functional implementation verified in a fresh detached worktree at `7b50de026c0589eec8c2ded4e052ca8388d24f99`; the following evidence commit adds this packet and removes an extra trailing blank line from the served license notices. Final head is recorded in the PR description and completion handoff.

This delivers the product-experience foundation only: `/`, `/demo`, `/workspace`, theme persistence and accessible navigation. It is not the full VORQYN product, a functioning simulator, authenticated workspace or Solana integration. No operational telemetry, transactions, customer metrics or testimonials are fabricated.

## Verification commands

Environment: Linux, Node `22.21.1`, pnpm `10.34.5`, Next.js `15.5.29`, Chromium `156.0.8078.79` (Debian 13). Toolchain and browser commands were run in `/workspace/work/vq02-clean`, a fresh detached worktree without `node_modules`. Contrast and final whitespace checks ran on the feature branch with the same frontend implementation. Cached package downloads were reused; the dependency tree itself was newly installed. Terminal escape sequences are removed from saved logs for readability.

| Exact command                                                                                  | Observed result                                                                                                                                          | Proof                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                               | Exit 0; all 3 workspace projects; 311 packages installed; lockfile accepted without resolution changes                                                   | [install log](logs/install.txt)                                    |
| `pnpm lint`                                                                                    | Exit 0; no errors or warnings                                                                                                                            | [lint log](logs/lint.txt)                                          |
| `pnpm typecheck`                                                                               | Exit 0; shared-contract scaffold and web TypeScript checks pass                                                                                          | [typecheck log](logs/typecheck.txt)                                |
| `pnpm test`                                                                                    | Exit 0; 6 frontend tests + 1 existing contracts scaffold test; no skips                                                                                  | [unit log](logs/unit.txt)                                          |
| `pnpm build`                                                                                   | Exit 0; all entry routes statically prerendered; no build warnings                                                                                       | [build log](logs/build.txt)                                        |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm --filter @vorqyn/web test:browser` | Exit 0; **39 passed**, 0 failed/skipped/flaky, in 1.4 minutes; 31 axe audits with 0 violations. [Log](logs/browser.txt), [summary](browser-summary.json) | Production server started by Playwright on `http://127.0.0.1:3100` |
| `node apps/web/tests/contrast.mjs`                                                             | Exit 0; 55 measured pairs pass their 4.5:1 text / 3:1 control thresholds                                                                                 | [contrast measurements](contrast.json)                             |
| `git diff --check origin/main`                                                                 | Exit 0 on the completed branch                                                                                                                           | Whitespace checked after notice normalization                      |

The 6 component tests verify hero destinations and concept disclosure, guest preview honesty, workspace empty state and native builder outline, theme storage and arrow-key selection, mobile Sheet Escape/focus restoration, and error retry invocation. The pre-implementation route suite was red because the required components did not exist; the initial JSX test-loader configuration was also corrected before that baseline run.

The browser suite covers 30 route/theme/width combinations, a mobile-dialog accessibility audit, actual CTA navigation, native details, theme persistence over navigation/reload, system preference changes, keyboard focus trapping/restoration, skip link, reduced motion, every internal route/hash link, useful 404, missing fonts, actual native 200% browser zoom and JavaScript-disabled content. Matrix checks require HTTP 200, no horizontal overflow, a visible page heading, zero page exceptions/console errors, and zero axe WCAG A/AA violations.

## Screenshot matrix

Each cell links to an actual full-page production Chromium capture, after fonts load, with reduced motion enabled for a deterministic still. Height is 1000 CSS pixels; the image includes the whole page. 1280px is added because the repository design gate also names it.

| Route / theme     | 1440                                        | 1280                                        | 1024                                        | 390                                        | 320                                        |
| ----------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| Landing / light   | [PNG](screenshots/landing-light-1440.png)   | [PNG](screenshots/landing-light-1280.png)   | [PNG](screenshots/landing-light-1024.png)   | [PNG](screenshots/landing-light-390.png)   | [PNG](screenshots/landing-light-320.png)   |
| Landing / dark    | [PNG](screenshots/landing-dark-1440.png)    | [PNG](screenshots/landing-dark-1280.png)    | [PNG](screenshots/landing-dark-1024.png)    | [PNG](screenshots/landing-dark-390.png)    | [PNG](screenshots/landing-dark-320.png)    |
| Demo / light      | [PNG](screenshots/demo-light-1440.png)      | [PNG](screenshots/demo-light-1280.png)      | [PNG](screenshots/demo-light-1024.png)      | [PNG](screenshots/demo-light-390.png)      | [PNG](screenshots/demo-light-320.png)      |
| Demo / dark       | [PNG](screenshots/demo-dark-1440.png)       | [PNG](screenshots/demo-dark-1280.png)       | [PNG](screenshots/demo-dark-1024.png)       | [PNG](screenshots/demo-dark-390.png)       | [PNG](screenshots/demo-dark-320.png)       |
| Workspace / light | [PNG](screenshots/workspace-light-1440.png) | [PNG](screenshots/workspace-light-1280.png) | [PNG](screenshots/workspace-light-1024.png) | [PNG](screenshots/workspace-light-390.png) | [PNG](screenshots/workspace-light-320.png) |
| Workspace / dark  | [PNG](screenshots/workspace-dark-1440.png)  | [PNG](screenshots/workspace-dark-1280.png)  | [PNG](screenshots/workspace-dark-1024.png)  | [PNG](screenshots/workspace-dark-390.png)  | [PNG](screenshots/workspace-dark-320.png)  |

Native zoom: [landing](screenshots/landing-zoom-200.png), [demo](screenshots/demo-zoom-200.png), [workspace](screenshots/workspace-zoom-200.png). The test sets Chromium's actual default zoom to 2 through its Settings page in an isolated profile, then asserts `outerWidth=1440`, `innerWidth=720`, `devicePixelRatio=2`. It is not CSS `zoom`, a pinch transform, or merely a resized viewport.

Visual review: inspected full-page landing captures in light/320 and dark/1440, demo light/320 and workspace dark/320, plus above-the-fold comparison sheets covering every route, theme and width. Observed stacked mobile CTAs, readable disclosures and distinct themed surfaces; the 320px workspace action wraps onto two lines without clipping. The rover now sits on its dock, while the underwater concept sits below the shared waterline. Contact sheets are analysis aids; the linked PNGs are the original captures.

## Contrast and accessibility findings

- Light copper `#B65B41` with white button text: **4.60:1**. It is not used for normal text on ivory; light accent text uses `#92442E`.
- Dark copper `#DE9C7C` with petrol button text: **6.87:1**.
- The specified initial light muted ink yielded **4.47:1** on muted mineral, below 4.5. Adjusted `--ink-muted` to `#506967`; now **4.74:1** on that surface.
- Dark copper text and danger text initially failed on raised muted surfaces. Separate `--accent-text: #EFB69B` and `--danger-text: #FFA6A2` yield **5.07:1** and **4.81:1** respectively. The original copper action and danger border tokens are retained.
- Dark `--control-border` adjusted to `#7E9E9F` for at least 3:1 against the tested surfaces. Every measured pair is recorded, including text, focus, control borders and fixed art labels.
- Semantic landmarks, logical headings, text alternatives, native details, 44px main control targets, three-pixel focus outlines and an operable skip link are implemented. Status is labeled in text, not color alone. The mobile Sheet uses a modal focus trap with Escape and trigger focus restoration.
- Reduced motion disables all CSS reveal/transition motion and the Halo spring. Important content starts visible even before hydration. Fonts have system fallbacks; the browser suite blocks font requests to verify reflow.
- Automated axe success is not a claim of a complete manual screen-reader audit or universal WCAG certification.

Observed defects corrected: invalid Fontsource import, missing action-arrow glyphs, unintended filled SVG guide paths, rover placement off the dock, illustration label placement, missing favicon 404, contrast pairs, and nested ESLint/Next plugin configuration. The first broad browser run was interrupted after its missing-favicon cause was confirmed; its failures are not presented as successful results. The final production run is the evidence linked above.

## Change inventory

- `apps/web/app/{page,layout,globals}.tsx/css`: editorial landing, exact core palette plus measured semantic adjustments, self-hosted type, shared shell, metadata and theme provider. Native CSS provides the one-time split-text treatment.
- `apps/web/app/demo/page.tsx`: readable guest scenario introduction with a dominant art slot and collapsible context; no auth gate or fake run controls.
- `apps/web/app/workspace/page.tsx`: organization/mission empty state, template entry and native, clearly labeled future builder outline; no fake persistence.
- `apps/web/app/{error,not-found}.tsx`: actionable error/retry and real 404 navigation.
- `apps/web/components/**`, `apps/web/lib/utils.ts`: reusable semantic controls, theme selector, accessible mobile Sheet, header/footer, original port concept and static grain.
- `apps/web/app/icon.svg`, `apps/web/public/**`: original icon/favicon and public license notices.
- `apps/web/package.json`, `postcss.config.mjs`, lint/test configs and `tests/**`: focused dependencies, Tailwind v4, component/browser/contrast checks.
- `eslint.config.mjs`: additive frontend Next/hooks rules and explicit config-root resolution; no unrelated root or CI rewrite.
- `pnpm-lock.yaml`: actual dependency resolution only.
- `docs/evidence/vq-02/**`: this review packet, screenshots, logs, measurements and source/license/integration records.

No changes to contracts, Anchor/Rust, services, port-world assets, shared mission/event/financial logic, CI or other lanes' modules. `packages/ui` was absent and is not created just to hold app-local primitives.

## Limits and dependencies

| Priority                                | Limit / unrun work                                                                                               | Integration requirement                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| P0 for the eventual product, outside #3 | No mission simulation, telemetry, real evidence/verifier, AI recovery, wallet, Solana transactions or settlement | #2 / #8 / #19 / #20 and chain/service owners; never infer state from art |
| P0 for the eventual product, outside #3 | No organization/auth or persisted mission builder                                                                | #4 must provide those real flows                                         |
| P2                                      | Chromium verified; Firefox, Safari, platform screen readers and real mobile hardware not tested                  | Later cross-browser/device QA                                            |
| P2                                      | Error retry is component-tested; no deliberately injected production React/server failure                        | Integration failure-path testing once real services exist                |
| P2                                      | Browser suite is explicit, separate from existing Node CI; existing CI runs lint/typecheck/unit/build            | No CI modification requested; PR checks reported separately              |

No mock operational records are present. The port and scenario are explicitly conceptual. No deployment or merge was performed. Independent review and later integrated mission tests remain necessary.

[Source/license inventory](SOURCES.md) · [Precise Issue #8 integration boundary](INTEGRATION.md).

# PR #53 review-correction captures (2026-11-08)

Production build of branch `feat/lane2-economic-handoff` (rebased on main
`048ebac`), served by `next start` on 127.0.0.1:3000. Real Playwright input
only; themes switched through the REAL `next-themes` storage key
(`vorqyn-theme`) followed by a full reload, with the effective theme asserted
on `<html>` before any capture. Every PNG's IHDR was verified in-run against
`capture-manifest.json`. Tool: `../tools/capture-corrections.mjs`.

## Camera states (item: visible selected + distinct disabled styling)

| file | size | proof it carries |
| --- | --- | --- |
| `camera-320-light-follow-disabled.png` | 256x103 | fresh page, gate closed: RESET pressed renders the filled brand pill; FOLLOW renders dimmed (computed opacity 0.4) — visibly distinct from every enabled control |
| `camera-320-dark-follow-disabled.png` | 256x103 | same in dark theme |
| `camera-320-light-air-selected.png` | 256x103 | AIR pressed: filled pill rgb(182,91,65) vs transparent unselected; FOLLOW enabled at full opacity (gate open) |
| `camera-320-dark-air-selected.png` | 256x103 | dark: filled pill rgb(222,156,124) |
| `camera-320-light-viewport.png` | 320x844 | full-viewport context, light |
| `camera-320-dark-viewport.png` | 320x844 | full-viewport context, dark |

The selected/disabled computed styles are additionally asserted in the
browser suite (mission-world.spec.ts) so the guarantee is regression-tested,
not just screenshotted.

## Judge journey (fault → measured evidence → honest economic status)

| file | size | what it shows |
| --- | --- | --- |
| `measured-fault-1440.png` | 1344x559 | AIR station selected (desktop grid state), inspector ROV-01-OPTICAL q 0.084 (x0.12 factor, red), "Active optical-visibility fault: severe" callout — kernel-measured degradation, explicitly labelled fixture-model measurements |
| `handoff-fixture-walkthrough-1440.png` | 1344x626 | the six economic stages under the FIXTURE WALKTHROUGH badge: measured, confirmed verdict (with earlier rejection history), proposal, confirmed reassignment receipt (sig + slot + chain time), replacement observations UNAVAILABLE (no source — same-ROV note), confirmed payout (sig + slot + chain t + lamports). No stage title claims "(on-chain, confirmed)"; the state badge carries the truth |

## Payment-stage acceptance matrix (as rendered by the corrected boundary)

Encoded as tests in `apps/web/tests/mission-world/economic-handoff.test.tsx`
("payment-stage acceptance matrix", rows A-G):

| row | recorded evidence | rendered state | forbidden claims |
| --- | --- | --- | --- |
| A | task verified, no payout receipt | AWAITING AUTHORITY, detail "payout ELIGIBLE … not paid, no recipient enacted" | "initiated"/"confirmed", confirmation object |
| B | verified, payout receipt submitted | SUBMITTED — AWAITING CONFIRMATION | confirmation object, "confirmed" |
| C | verified, receipt processed | SUBMITTED — AWAITING CONFIRMATION | confirmation object, "confirmed" |
| D | verified, receipt confirmed, payment event not recorded | AWAITING AUTHORITY ("ELIGIBLE"; task not paid) | "initiated", confirmation object |
| E | task paid, receipt confirmed/finalized + payment event | CONFIRMED + amount (+recipientWallet ONLY if the receipt recorded one; canonical fixture records none → none shown) | invented recipient |
| F | payout receipt ended rejected/expired | REJECTED ("no funds moved; the task is not paid") | confirmation object |
| G | hostile processed-update swapped into the canonical run | never CONFIRMED (reducer's confirmedChainRecord rejects the payment event) | — |

Canonical rule (mirrored from `packages/contracts/src/reducer.ts`
`confirmedChainRecord`): only a receipt whose LATEST statusHistory entry is
`confirmed` or `finalized`, with matching kind, authorizes a confirmed
stage. `submitted`/`processed`/`unknown`/`absent` never render as confirmed.

## Build / serve conditions

`pnpm build` on this Windows host completes the main build (Compiled
successfully, 9/9 static pages, BUILD_ID present); the deploy-only standalone
trace-copy step fails with EPERM (symlink privilege) — unrelated to the app
build and untouched by this branch (release lane's packaging). `next start`
serves `.next` directly. Captures taken 2026-11-08 against this checkout's
freshly built `.next` — NOT a stale build (the first suite run today served a
19:23-from-Nov-7 `.next` and was rejected; the build above predates every
capture).

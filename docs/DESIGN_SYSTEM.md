# Design specification — VORQYN (light-led, dual-theme, 3D-first)

> Art direction is intentional product infrastructure, not a decoration pass. Both themes must work. The mission world is the experience; never put a generic dashboard around a nonfunctional animation.

## 1. Creative thesis

**Industrial editorialism × cinematic physical autonomy.** VORQYN should feel like an Awwwards-caliber company website and a trustworthy robotics operations console, not a black-and-purple Web3 template. Design for the customer who must understand an unsafe sensor, a robot handoff and a pending payment without being misled.

Visual signature: strong typography, warm architectural surfaces, distinctive cropping, physical models with believable material/scale, deep 3D world, sparse precision HUD and one dramatic **World Dive → Mission Fracture → Ghost Recovery + Solana Handoff** sequence.

No generic floating neon-glass cards, rainbow gradients, infinite particle fields, 3px borders or 10px essential text.

## 2. Theme tokens (proposed; test in browser)

| Semantic token | Light | Dark | Use |
| --- | --- | --- | --- |
| canvas | #F5F3EC | #10262A | Page background |
| surface | #FFFFFF | #1D3B40 | Cards / inspector |
| surface-muted | #E1E8E3 | #284F53 | Secondary contextual surfaces |
| ink | #193B3B | #F2F0E8 | Main text |
| ink-muted | #536D6C | #B9D3D5 | Supporting text |
| accent/action | #B65B41 | #DE9C7C | Primary CTA, active action |
| success | #236C60 | #7BD9C6 | Verified **with label**, never color only |
| warning | #8C5317 | #F1BC79 | Attention, not automatic failure |
| danger | #AE413D | #FA8A86 | Actual rejected / failed |
| focus | #285C9C | #B7DBFF | Strong keyboard outline |

These are *initial tokens*, not pre-certified WCAG pairs. Check normal text >= 4.5:1, large text >= 3:1, nontext controls/focus >= 3:1 where applicable. Do not place copper normal text on a light ivory surface. Never encode status only by color.

Use CSS variables mapped to shadcn/Cult UI theme tokens, including text/border/ring/overlays. Theme switching light/dark/system must persist, honor system preference, and render without flash/hydration mismatch. **Scene daylight is a world/environment parameter; it must NOT change when UI theme changes.**

## 3. Typography and spatial rhythm

- Display: **Clash Display**, or licensed substitute of comparable character; use for hero/editorial headlines, not numeric data.
- UI: **General Sans**, or licensed accessible substitute; 14–16px body/control text, thoughtful weight/line height.
- Data: **IBM Plex Mono** (respect license) for telemetry, wallet addresses, timecodes, IDs, counters, and aligned numerical data.
- 8px baseline spacing with meaningful 4px increments; 24–40px landing sections; generous safe areas and focus offsets.
- Avoid animation on dynamic labels, text that changes every frame, and truncated warnings without inspection affordance.

## 4. Precise UI library usage

**Cult UI**: primary customizable shadcn-compatible component source. Use Wizard Expandable (validated mission builder), Halo Segmented (mode tabs), Side Panel adaptation (contextual inspector), Cutout Card (marketing/templates), Halo Toast (noncritical feedback only), Feature Sticky Section (storytelling). Inspect current docs before installation, preserve keyboard behavior.

**React Bits**: Split Text / Animated Content only in marketing and once-off onboarding; use reduced motion. No constantly looping backgrounds behind data.

**Skiper UI**: select only a few progressive blur/number transitions in marketing; verify license and attribution on each component before copying. Do not use its demo 3D effect as a robotics simulator.

**Awwwards**: benchmark storytelling, hierarchy, unusual crop/typography and beautiful world presentation. Do not copy designs or license-bound assets. Production console must favor clarity over ornamental scroll.

No component gets installed solely for a visual novelty score; choose based on screen role, accessibility, performance and licensing.

Official library references:
- https://www.cult-ui.com/docs/components
- https://www.reactbits.dev/get-started/index
- https://www.skiper-ui.com/components
- https://www.awwwards.com/

## 5. Screens and information hierarchy

### Landing

Hero with decisive two-option CTA: **Explore Demo** (no authentication) and **Create Workspace**. A striking 3D still/preview first; a gradually interactive world only when ready. Hero copy explains autonomous work and accountability immediately. Scroll story: machines collaborate → underwater failure → economic recovery → evidence+payment. Include clear product scope/limitations and links to team-relevant evidence.

### Explore Demo

One-click guest entry; optional guided 90-second tour. Persistent **SIMULATED / DEVNET** label. Visible fault trigger limited to seeded missions. Avoid forcing wallet onboarding to see the value. Where real live funding requires permission, communicate owner-approved scripted demo fixture vs read-only replay.

### Workspace / Missions

Fast list, recent work, role-based action affordances, empty states, create CTA; light mode default and dark alternative. Show custom mission provenance, connected fleet capability, progress and task budgets, not fake enterprise KPI cards.

### Mission Builder (5 steps)

Objective/template → Environment & zones → Machines/operators → Evidence acceptance & budget → Review/authorize. Save draft each step; validation errors remain in context and keyboard focus is moved to first error; close/reload preserves state; wallet approval rejection does not lose input. A second mission with different budget and task config is actually persisted.

### Mission Control

**Desktop:** 3D world dominant (roughly 65–80% of remaining viewport); slim rail; compact mission strip; contextual right inspector; bottom event timeline. Two composition presets: **Immersive** and **Operations**. World selection and time state identical in both.

**Modes:** Orbit, Follow, Inspect, X-Ray, Replay. Camera targets and distance calibrated against actual model scale and occlusions. Reset view always available. No essential action behind hover.

**World Dive:** smoothly transition air→land→underwater while preserving shared port geometry/relative coordinates; do not teleport between unrelated scenes without clear scene boundary. If engine cannot support seamless single world honestly, use labeled transition with shared mission clock.

**Mission Fracture:** show sensor failure as expanding uncertainty/unfinished zone plus verified evidence policy rejection; no decorative 'failure' animation unconnected to actual state.

**Ghost Replay:** distinguish recorded failed path vs separately simulated repaired branch. Show budget and operator assignment as concurrent event layers. Different simulator, app and chain timestamps stay visible.

### Evidence & Settlement

Evidence panel shows source, thresholds, observed values, reasons, task/assignment version. Finance panel shows wallet approval → submitted → confirmed / unknown / failed, explorer link, current operator, amount and task ID. On-chain verified ≠ physical-truth verified. Never show Paid before confirmed chain state.

## 6. Edge cases / UX matrix

| Condition | Required UX |
| --- | --- |
| Scene assets not ready | Immediate beautiful preview and clear load progress, bounded retry |
| WebGL unavailable/context loss | 2D map/list/timeline fallback, continue mission proof flow |
| Low FPS, high DPR, weak GPU | Adaptive pixel ratio/LOD/shadow off; preserve event semantics |
| Orbit camera intersects piers/terrain | collision bounds, near/far control, reset view |
| Vehicle is tiny/offscreen | honest-scale marker; selection target and named camera |
| Underwater GPS unavailable | local position reference, confidence/uncertainty visualization, no fake GPS |
| Telemetry stale/disconnected | stale timestamp, freeze last known pose; do not keep animating as fact |
| Network reconnect gives reordered samples | sequence/clock ordering; show recovery without retroactive fake chain confirmations |
| Multiple readers/tabs | mission version and read-only replay controls avoid conflicting writes |
| Account without company | onboarding; do not accidentally expose another org's mission |
| No matching fleet/operator offer | articulate missing capability and halt; no invented match |
| Budget/quote exceeded | explain remaining amount; disable unauthorized action |
| Transaction expired, signature rejected, RPC down | distinct states, retry/reconcile, don't reset budget or mark Paid |
| Conflicting time domains | show simulator time vs app event vs chain confirmation |
| Reduced motion, screen reader, keyboard | logical focus, controls outside canvas, text equivalents, no motion-only evidence |
| 320px width/200% zoom | no covered CTA or inaccessible payment confirmation |
| Theme changes mid-mission | preserve camera/mission state, avoid WebGL remount if possible |
| Loading skeleton never resolves | timeout + recovery action; no indefinite spinner |
| User clicks same transaction twice | disable duplicate action / reconcile; single-use contract also prevents payout |
| Marketing is viewed without JS | meaningful static content with working links |

## 7. Performance and craftsmanship gates

- Target fluid 3D on representative desktop; degrade gracefully rather than require 60fps on every device.
- Take screenshots at desktop 1440/1280/1024 and mobile 390/320; review at 200% zoom and with reduced motion.
- Audit accessibility: tab order, visible focus, contrast, form errors, touch targets; verify screen-reader equivalence for timeline/evidence.
- Don't claim pixel-perfect until screenshots are inspected. Surface asset licenses/provenance and alt text.
- Use small, stable components and scoped tokens. Never force theme-specific duplicated screen implementations.

## 8. Acceptance

The demo must look cohesive in light *and* dark, meaningfully render a stateful 3D mission and explain a failure/reassignment/payout without interpretation by a founder. Function and presentation are inseparable.

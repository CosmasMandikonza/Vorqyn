# VQ-02 downstream integration boundary

This issue provides an experience foundation, not a new mission-state interface.

## Issue #8: actual 3D mission world

- Upstream: merge VQ-01 / #2's shared contracts first. `@vorqyn/contracts` on this branch's base remains scaffolding. Import its reviewed IDs, events, telemetry and provenance after they exist; do not derive state from the illustration or invent frontend enums/reducers.
- Replace the `PortConcept` child inside `/demo`'s `section.world-slot` with a small client entry for the actual world. Keep the server-rendered page, navigation, disclosure and no-WebGL text alternative. The container is full-width and min-width-safe; the current art uses at most 640px of height on that route. Add the real viewport-dominant scene sizing with the renderer, not a permanent wall of dashboard cards.
- The concept's local `Point`/`Block` drawing helpers are **art coordinates only**. They are not shared geometry, simulation frames, world units, machine positions or a renderer contract. Do not reuse them as telemetry transformations.
- Obtain the reviewed port geometry, meter scale, origin, axes and asset manifests from Agent A's #19 `assets/port-world/**` output. VQ-02 neither reads nor modifies that path. Asset names and readiness are not assumed here.
- Obtain authoritative event snapshots / telemetry with source, sequence, reference frame, units and the three clocks through the reviewed service/contract integration. Agent B's #20 core is independently owned; VQ-02 does not import or duplicate it.
- Camera mode/selection/time must belong to the future scene client and its authoritative mission data. The root `ThemeProvider` persists above route content; appearance changes do not key/remount the route and must not alter scene daylight. Test camera/time continuity once a scene exists.
- Add the planned Orbit / Follow / Inspect / X-Ray / Replay controls as real renderer behavior, a collapsible inspector, a synchronized event timeline, keyboard/touch controls, camera bounds, adaptive quality and WebGL context-loss fallback in #8's scope.
- Replace the preview disclosure with accurate runtime fidelity only when actual data is connected. VQ-02 intentionally shows no operational SIMULATED/DEVNET badges, fault trigger, machine status, transaction signature or success counters.

## Other downstream issues

- #4 owns real organization/auth, workspace onboarding, persisted mission builder and validation. `/workspace` currently presents a clearly labeled shell and native details outline; it creates/stores nothing. Replace the template entry with a working creation route only after that route exists.
- Chain/evidence/recovery owners supply verifier-bound evidence, current assignment versions, authorized reassignment and reconciled transaction lifecycle. UI cannot set `Paid` or financial truth. This branch changes no shared contract, money rule, authority, Rust program or service.
- #14 / end-to-end integration proves a real failure → recovery → verification → confirmed, single-use payout and replay. No such journey is claimed by VQ-02.

## Reusable frontend pieces

Semantic tokens and shadcn aliases live in `app/globals.css`; `Button`, `Badge`, the Cutout Card adaptation and Halo Segmented live under `components/ui`. They remain app-local until another consumer justifies a shared `packages/ui` extraction. No package boundary or root workspace architecture has been changed.

Theme storage key: `vorqyn-theme` with `light`, `dark` or `system`; managed by `next-themes`. Small client islands are the provider, theme selector/Halo, mobile Sheet and static-noise generation. All page compositions and the SVG are server components. Hero split text uses native CSS; its initial text stays visible.

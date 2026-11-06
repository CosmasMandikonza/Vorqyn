# Judge demonstration and submission runbook

> A demo is truthful only when visible results follow actual application / simulator / chain state. This document is a **proposed** runbook until the end-to-end test passes.

## Prize target

**Top 3 Overall**: $1,000 team microgrant for three strongest eligible projects. Secondary: AI Track if AI makes meaningful verified coordination decisions and actually initiates constrained on-chain actions (or human confirms its proposal under explicit policy). The event values Solana's speed, low fees, composability or onchain ownership, and rejects a token bolted onto an unrelated Web2 app.

MLH standard rubric: Technology, Design, Completion, Learning, equally weighted. The event-specific text emphasizes a working product whose Solana use is essential. **Do not claim our project is already winning or judged.**

## Judge first 15 seconds

Visitor immediately sees headline **'Autonomous work. Accountable outcomes.'** and CTA **Explore Live Demo**. Enter 3D mission without signup/wallet. A small brief explains: **'Three robotics providers inspect a storm-damaged port; one will fail; VORQYN finds an eligible replacement and Solana enforces who gets paid.'**

Show three roles in one spatially coherent scene with human-readable status. Badge **SIMULATED ENVIRONMENT · SOLANA DEVNET** persistent.

## Two-minute recording storyboard

| Time | Visible interaction | Verifiable claim |
| --- | --- | --- |
| 0:00–0:15 | MLH identification + VORQYN homepage → Explore Demo | One memorable business problem; accessible instant product |
| 0:15–0:35 | Cinematic World Dive from drone → rover → underwater ROV | Mission/simulation state, truthful vehicle source labeling |
| 0:35–0:55 | Trigger degraded optical visibility; coverage becomes insufficient | Evidence policy fails, not simply an animated badge |
| 0:55–1:15 | Show cheaper but incapable replacement rejected; qualified sonar candidate chosen | Actual structured AI/policy decision with rationale |
| 1:15–1:40 | Owner or scoped agent submits devnet reassignment; ROV B completes survey; independent verifier accepts; payout claim confirmed | On-chain assignment version changes and money transfers once |
| 1:40–2:00 | Mission Ghosts compares failed vs recovered branch; inspect real tx signature, audit trail and company mission entry | Coherent physical/economic causality + reusable product |

If a step doesn't really work, trim the script or disclose a fallback. Do **not** narrate a capability that isn't implemented.

## Seed data and staging

- One port template, two robot operators for underwater task (optical-only A and sonar-capable B), independent owner/receiver/verifier/agent identities.
- Use synthetic terrain only when labeled. Do not upload sensitive real infrastructure maps.
- Build deterministic scenario seed so same fault occurs reliably; pin LLM structured candidate data but not a fabricated LLM response. Record model/provider and accepted policy.
- Pre-fund devnet fixture safely; rate-limit guest reset to prevent depletion. Keep secrets server-only.
- Separate demo environment from any private company workspace data.
- Preserve an actual confirmed devnet funding, reassignment and payout signature in proof log; chain explorer link must use devnet.
- Record observed tool/model limitations, and which vehicles use genuine simulator/controller vs stateful synthetic simulation.

## Live demo operator checklist

- [ ] Verify live deployment URL opens in private/incognito window.
- [ ] Confirm image/model assets load; fallback appears if WebGL fails.
- [ ] Confirm all required services and devnet RPC respond; display statuses.
- [ ] Verify mission seed is reset, budget funded, selected task unsigned and not already paid.
- [ ] Start guided demo, verify three vehicle roles and telemetry provenance labels.
- [ ] Inject sensor fault; reject evidence based on measured policy.
- [ ] Agent candidate shortlist contains capable vs incapable offer, and decision trace.
- [ ] Authorized reassignment changes onchain account after confirmation.
- [ ] Replacement executes and verifier accepts current assignment/version.
- [ ] Claim payout; verify receiving wallet + task paid flag; duplicate attempt rejected.
- [ ] Reload and replay; compare simulator event time and actual chain confirmation time.
- [ ] Open separate Create Mission and show distinct saved settings.
- [ ] Check small/mobile layout, light/dark, keyboard, reduced motion.
- [ ] Check no console errors, missing screenshots, unsupported hover-only controls.

## Offline and RPC fallbacks

- **RPC unavailable:** show a clearly labeled **Recorded Verified Devnet Session** with prior real transaction signatures and recorded state; no new 'Paid' notification.
- **Simulator unavailable:** use a genuinely captured trace, labeled Playback; if synthetic fallback, label it Synthetic Simulation and do not claim external controller integration.
- **AI unavailable:** deterministic eligibility rule and explicit 'Rule-based fallback' label; no fabricated LLM reasoning.
- **WebGL unavailable:** meaningful 2D event, task, sensor and payment proof; don't make the app unusable.
- **Wallet cancels:** stay unfunded, preserve draft and explain how to retry.

## Mandatory deliverables

1. GitHub repo with actual code and documented run commands after implementation.
2. Public deployed product or a concrete reproducible local setup when event allows.
3. Public demo video, **maximum two minutes if standard MLH rule applies**; include hackathon identification at start.
4. Real deployed devnet program ID, funding/reassignment/payout signatures, and verification policy explanation.
5. Screenshots across desktop and mobile, both themes, distinct mission created.
6. A short Devpost/MLH submission explaining: problem, why Solana, why AI, what actually works, technical learning, known limitations, team contributions.
7. Licenses/attributions for external models, fonts, Cult UI / React Bits / Skiper UI sources as needed.
8. Recording backup and honest limitation notes; do not claim customers, revenue, production robotics deployment or third-party safety certification.

## Deadline policy

Event schedule from official site: Friday Nov 6 12:00 ET start; Sunday Nov 8 **10:00 ET initial submission**, **11:45 ET hacking ends/final submission**. The header/submission portal may show a different close time; use the earlier event schedule as operating cutoff until organizer confirms specifics. Finish upload well in advance, recheck public links, video permissions, and submission status.

## Final product proof before sharing

A stranger should be able to answer:
1. What industrial problem does this solve?
2. Why does a robot need a replacement?
3. Why was the cheaper candidate rejected?
4. What exactly did AI decide?
5. What exact constraint did Solana enforce?
6. Who got paid, and can the old operator or a duplicate claim steal the reward?
7. What was simulation and what was genuine real software/smart-contract execution?

If the user can't answer, tighten experience copy and evidence—not just polish animations.

# Founder submission desk

Status on November 8, 2026: the canonical public origin **https://vorqynweb-production.up.railway.app/** passed 9/9 signed-out functional smoke checks. The remote deployment commit remains unverified. No produced public video, devnet settlement proof or MLH acceptance receipt is asserted. [Public source](https://github.com/CosmasMandikonza/Vorqyn) and [current independent QA](../evidence/integration16/ACCEPTANCE_STATUS.md) remain distinct from authenticated submission.

Founder action now: open the authenticated MLH form and begin the entry while deployment/recording proceeds. Required fields and actual registration/receipt state are human-only until inspected. Use [DEPLOYMENT.md](DEPLOYMENT.md) for the validated Node packaging, provider sign-in action and anonymous smoke; the canonical origin has now been tested independently; a local container alone still cannot prove public hosting.

## Confirmed deadlines and portal discrepancy

| Action, Sunday November 8                                  | America/Chicago (CST) | Official schedule ET (EST) | UTC   |
| ---------------------------------------------------------- | --------------------- | -------------------------- | ----- |
| Initial submission                                         | **9:00 AM**           | **10:00 AM**               | 15:00 |
| Hacking ends / final submission                            | **10:45 AM**          | **11:45 AM**               | 16:45 |
| Portal's displayed closure, not permission to keep hacking | 12:00 PM              | 1:00 PM                    | 18:00 |

Sources checked live November 7: [organizer schedule](https://events.mlh.com/events/15200-solana-hackathon) and its linked [MLH Challenges event page](https://www.mlh.com/events/solana-hackathon). The schedule sets the two earlier deadlines; the portal displays a later 1:00 PM EST closure. Use the earlier schedule. Ask the organizer through the event's official channel if their authenticated portal shows conflicting instructions. Keep the answer and timestamp; do not silently use the later time.

The actual [new-submission route](https://www.mlh.com/events/solana-hackathon/submissions/new) redirects to MLH sign-in. Its authenticated field requirements, team registration/check-in state and receipt were **not inspected**. Exact human action: sign in with the founder's MLH account, complete registration/check-in, open Submit a Project, verify timezone and required fields, and submit before the earlier initial deadline. No credentials should be entered into chat or the repository.

## Public artifact requirements

The [MLH standard rules](https://github.com/MLH/mlh-policies/blob/main/standard-hackathon-rules.md) require public code, continued public code/video availability, a weekend-created demo of at most two minutes, hackathon identification at the beginning, completed registration and transparent AI-tool disclosure for MLH digital events. They also restrict prior work and duplicate hackathon submissions. Confirm event-specific requirements in the authenticated form; do not assume a Devpost portal or treat an upload as an accepted submission.

- [ ] Founder reviews event eligibility, work dates and team registration/check-in. Record any pre-existing dependencies and original event-time work.
- [ ] Choose an exact reviewed **merged main SHA**; rerun the preflight on that SHA. A feature-branch check is not integrated-main proof.
- [ ] Confirm [repository](https://github.com/CosmasMandikonza/Vorqyn) is public in a signed-out browser and keep it public. Inspect `git status` before publishing; retain no `.env`, wallet JSON, private keys, customer data or credentials.
- [ ] If a deployed demo is requested by the form: founder signs into the chosen hosting provider, connects this repository, configures the Next.js workspace root/build/runtime, deploys reviewed main, and verifies the returned HTTPS URL signed out. The canonical Railway origin is verified functionally; obtain the actual hosting build/deploy record to attest its SHA. This QA task did not deploy it. Do not claim an unknown portal field is satisfied.
- [ ] Rehearse and record the enabled shot list. Inspect the produced audio/video, then run `node scripts/release/check-media.mjs --file <actual-file>`. That command does not upload or verify spoken content.
- [ ] Founder signs into their video host, uploads the actual recording, selects **Public** visibility, and checks playback without login. Keep public after the event. Capture the real URL only after inspection; no video presently exists in this packet.
- [ ] Populate the form with the reviewed [submission copy](SUBMISSION_COPY.md), real repository/video/demo URLs and actual contributors/tool disclosures. Confirm the form's required fields after login.
- [ ] Verify licenses: original port pack attribution under `assets/port-world`, existing font/Cult/shadcn/React Bits notices under `docs/evidence/vq-02/licenses` and `/third-party-notices.txt`; Three/R3F/Drei dependency licenses. No external media is introduced in this release work. Describe synthetic reference assets as such.
- [ ] If claiming Solana: obtain Lane 1's actual deployed devnet program ID, confirmed funding/reassignment/payout transaction signatures, explorer links for **devnet**, program account readback, expected recipient/balance change and negative stale/duplicate-claim tests. Match evidence/assignment versions. An RPC URL, wallet popup or source scaffold is not this proof.
- [ ] If any chain proof is absent, use the clearly labeled contingency narration. Do not assert runtime AI decisions, physical/SITL telemetry, evidence verification or financial settlement. This is a material gap against the event's Solana-focused judging goal, not merely a missing badge.
- [ ] Submit the initial entry before **9:00 AM CST**; verify the portal shows an actual submitted/received state. Retain receipt/project URL and timestamp privately as needed. Uploading media alone is not a receipt.
- [ ] Finish permitted final updates before **10:45 AM CST**. Reopen repository/video/demo URLs signed out and verify the actual final portal status. Parent #17 remains pending until these public artifacts and acceptance are verified.

## Proof inventory to fill with observed artifacts

`submission-status.json` now records the verified public origin, while deployment-source/video/receipt/chain proof remains null. Do not replace null with a plausible-looking identifier. Public form/project links may be recorded after human inspection; keep account email, receipt secrets and personal registration data out of public evidence. The preflight never auto-certifies external submission, receipt, video content or chain truth from a URL string.

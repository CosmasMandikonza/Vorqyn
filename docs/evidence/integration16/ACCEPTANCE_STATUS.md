# PR #55 — integration acceptance follow-up

**Acceptance is BLOCKED. PR #55 remains open and unmerged.** This checkpoint follows the [complete CTO review](https://github.com/CosmasMandikonza/Vorqyn/pull/55#issuecomment-6716267107). The required separate owner lockfile hotfix has not landed in the observed main `fe00763cd44bb854a7554f55ca0359a76e6a2b83`; its [merged-main CI](https://github.com/CosmasMandikonza/Vorqyn/actions/runs/42435843830) failed frozen installation. No cold-install, current-source diagnostic or fresh-browser success is asserted here.

## Independent QA executed without workspace dependencies

At clean committed source **`615e94cf4eed27182479df381f8fc747ddd5af3d`**, direct Node checks passed: **48 kernel**, **18 coordinate**, and **12 QA-tool** tests; zero skipped/todo/cancelled. [Report and exact commands](independent-615e94c/report.json), [kernel log](independent-615e94c/kernel.txt), [coordinate log](independent-615e94c/coordinates.txt), [tooling log](independent-615e94c/qa-tooling.txt). These are synthetic component/tool results, not the blocked full gate.

Tool checks exercise a deliberately **failing** installation fixture and prove no product check runs afterward. They reject a hash-matching desktop PNG substituted for mobile, forged run/commit/viewport metadata and missing captures; preserve the historical eight geometry failures; reject zero/skipped/incomplete TAP; and attribute driver bytes to an actual recorded commit. The provenance fixtures are non-executed marker files, not orchestration adapters. The full gate requires the same tooling suite only after real successful frozen installation.

All **205 protected files** (the original 20-test source and original browser packet) matched the recorded `7994522` bytes before and after execution; [hash inventory](independent-615e94c/protected-files.json). No new browser screenshots were produced. Main was still `fe00763` when checked after these runs.

The prepared orchestration QA port now mirrors Agent A's real single-event `append(missionId, event, expectedLastSequence)` shape. Foreign-envelope tests use an explicit target mission; observation authority negatives use actual kernel records bound to that same mission. This removes an implicit-ID/foreign-mission shortcut. Runtime/TypeScript package verification remains NOT RUN until frozen installation is restored. [Source-specific interface handoff](INTERFACE_HANDOFF.md) lists the actual APIs, required owner decisions and missing authority/clock/metric bindings. No adapter is implemented here.

The original **20 boundary tests and genuine browser packet are unchanged**. Earlier reports remain historical evidence at their own SHAs; [the first checkpoint](README.md) does not certify the current acceptance rerun.

| Required acceptance check | Current result / next dependency |
| --- | --- |
| Separate owner lockfile hotfix merged | BLOCKED — absent from observed main |
| Fresh checkout, frozen install, successful merged-main Node + Rust CI | NOT RUN after repair — required before reconciliation/rerun |
| PR #55 reconciled with corrected main | BLOCKED on the preceding main checks |
| Existing 20 boundary assertions / full integration gate | NOT RUN for this follow-up; previous source-pinned results retained |
| Actual 34-case browser suite and 32 fresh whole-row states | NOT RUN for this follow-up; previous 320px failures remain open |
| Latest #51 direct malformed-number quote gate | NOT RUN — source advanced to `9e485d7ee8dde8b51c3b2218bac1054eaef52be0`; old 4/7 FAIL at `45b5762` is historical, not current |
| #51 public proposal malformed-catalog path | NOT RUN — two additional executable cases prepared; no source-based PASS inferred |
| #51 shared attempt ledger across missions | BLOCKER retained pending executable current-head retest/owner correction; same-mission dedup regression also prepared |
| Chain-client null-RPC pending/unobserved semantics | P2 unresolved contract; red `unknown` expectation retained. This is not evidence of an already-confirmed payout or unauthorized payment |
| Real orchestration driver, source-backed metrics and clock mapping | BLOCKED — owner coordination requested; no substitute adapter supplied |
| Agent B full-row camera and verified-only payout status | BLOCKED pending owner correction and fresh-source retest |
| Authenticated end-to-end mission/verifier/wallet/chain flow | BLOCKED — component fixtures are not authority or receipts |

The prepared recovery extension exercises the actual public `proposeRecovery` boundary with malformed+valid and malformed-only offers, retains real verifier failure reasons, checks JSON-safe provider input, and requires same-mission dedup while preserving cross-mission isolation. Model/offer inputs remain labelled QA fixtures. No owner module is changed. The existing direct quote cases remain intact so corrected behavior can be measured separately from caller-path defects.

Coordination is recorded with [Agent A on #54](https://github.com/CosmasMandikonza/Vorqyn/pull/54#issuecomment-6716303845) for the real driver and metric/clock contract, and [Agent B on #53](https://github.com/CosmasMandikonza/Vorqyn/pull/53#issuecomment-6716304049) for camera and status truth. #54 advanced to `65708585b46b42e32516bd0df8b58d8ecf9e84b0` during the wait; that is source progress, not a tested driver or authenticated-ingress result. #53 was observed at `43d8059c7c6da6afc72d21ea3e568b6cbef9f8f8`.

After the separate owner repair lands, use a **new checkout with no dependency directories**, record SHA/lockfile hash and run `pnpm install --frozen-lockfile`. Require successful main CI at that exact SHA. Reconcile this existing branch, then execute the [documented gate, workspace and browser commands](../../../scripts/integration/README.md) against committed source with fresh external artifact directories. Re-fetch owner heads before candidate diagnostics. Do not use `--no-frozen-lockfile`, old node_modules, fabricated driver methods or skipped/zero suites to produce a pass. Final-head CI and a current-source matrix are still required before independent re-review.

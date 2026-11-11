# P0 handoff — POLICY_SEA_OBSTRUCTION_1 zone correction (for Omar, services/verifier/**)

Owner: Omar (Lane 1, verifier). Prepared by Agent A (Lane 2) from the merged
world metadata and the real deterministic kernel — **not applied by Agent A**
(no handoff authorization at time of writing). Failing-first evidence:
`apps/web/tests/mission-geometry/policy-zone-alignment.test.tsx` on branch
`feat/lane2-mission-geometry` — all three defect tests flip GREEN exactly when
this correction lands.

## The exact one-value correction

```diff
--- a/services/verifier/src/policy.ts
+++ b/services/verifier/src/policy.ts
@@ block POLICY_SEA_OBSTRUCTION_1
-  zone: { centerX: 0, centerY: 0, radiusMetres: 80 },
+  zone: { centerX: 170, centerY: -90, radiusMetres: 58.31 },
```

Derivation (from `assets/port-world/world.json`, `zones[id=obstruction_zone]`):
- box x ∈ [120, 220], y ∈ [−120, −60] → centre = **(170, −90)**.
- `radiusMetres = 58.31` = hypot(50, 30) = **58.3095** m rounded up: the
  circumscribed radius that covers the entire declared obstruction box from
  its centre. (The `PolicyZone` type is circular; 58.31 is the smallest
  radius that contains the whole box. Every accepted sample must still be a
  real kernel observation inside the box — the circle only extends into
  open water where no kernel sample exists.)

Note: `POLICY_STRUCTURAL_CERTIFICATION_1` shares the old (0, 0, 80) zone.
Whether structural certification should be anchored to the same site or a
different structure is Omar's design decision — out of this handoff's scope.
The sea-obstruction correction above is independently safe.

## Measured defect (real kernel ROV survey, seed 20261107, 230 steps)

| Quantity | Wrong policy (0, 0, r=80) | Correct world geometry ((170, −90), r≈58.31) |
| --- | --- | --- |
| In-zone genuine survey samples | **0 of 87** | **87 of 87** |
| In-circle harbour-transit samples | **35 of 143** (false accept risk) | **0 of 143** |
| Nearest genuine survey sample to policy centre | 60.828 m (transit) | — |
| Genuine survey sample distance range from policy centre | 141.477–191.939 m | — |
| Farthest in-box sample from world centre | 51.45 m (< 58.31 ✓) | — |
| Verdict on the real in-zone sonar survey | REJECTED (87 × `outside_zone:…distance_m=141.477–191.939:radius_m=80`) | ACCEPTED |
| Verdict on a transit-only prefix (20 samples in the basin) | **FALSELY ACCEPTED** | REJECTED (`outside_zone`) |

Reproduction: `pnpm --filter @vorqyn/web test -- tests/mission-geometry` —
the `[GEOMETRY-EVIDENCE]` lines print the machine-readable measurements.

## Coordination request

Omar: please apply the diff above (or say the word and hand the edit to a
Lane 2 follow-up slice with your explicit sign-off recorded here). After it
lands, the three red tests in `policy-zone-alignment.test.tsx` flip green
with zero further changes — they assert the corrected verdicts through the
unchanged public `evaluateCapture` path.

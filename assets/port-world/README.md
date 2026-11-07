# PORT-001 — Kerameion Basin port-world asset & spatial reference pack

Preparatory deliverable for **VQ-07 / Issue #8** (interactive 3D mission viewer).
Issue: [#19](https://github.com/CosmasMandikonza/Vorqyn/issues/19). Everything in
this directory is generated or documented here; nothing outside
`assets/port-world/**` is required to regenerate, validate or preview it.

> **What this is:** an original, spatially coherent, storm-damaged industrial
> port *template world* — geometry (glTF 2.0), machine-readable mission-zone /
> anchor / camera-target metadata, a deterministic zero-dependency generator, a
> standalone validator, and real rendered previews.
>
> **What this is NOT:** the interactive viewer (Issue #8 remains open), a real
> port (fictional composite — no geographic parity claimed), verified
> equipment (vehicle models are scale references only), or any claim of
> physical-hardware fidelity or safety certification.

## Frame & units (binding for Issue #8)

- **Local ENU, meters.** `x` east, `y` north, `z` up. Origin: harbor-basin
  center at the waterline. Land lies north (+y); piers extend south (-y).
- **Waterline is exactly z = 0.** Quay/yard deck elevation z = +4.0 m.
  Seabed undulates between z = -11.2 and -13.8 m (deeper to the south).
- **glTF files are natively Y-up** (spec-compliant). The generator converts at
  authoring time: `gltf_x = enu_x`, `gltf_y = enu_z`, `gltf_z = -enu_y`, with
  an identity root rotation (validated). Consumers never re-orient manually:
  load the GLB, and use `world.json` for all mission-space coordinates.
- `world.json` is the authoritative spatial metadata; the meshes are the
  visual layer that lives inside it. The validator cross-checks extents.

## World layout (top view, north up)

```
        y=240  +------------------------------------------------+
               | W1 (intact) | W2 (roof damage) | W3 (intact)   |
        y=170  |================ TRUNK ROAD ================    |
               |            yard apron      |  scattered debris |
        y=150  |  container  rows           X  (storm-lost)     |
               |  (stacked, west)          /                    |
        y=60   |--------- quay service road-+                   |
        y=44   ==== quay edge (bollards, rails, benchmark) =======
               |            | Pier A | Pier B | Pier C           |
               |  bas       |  (int) | (crane)| (collapsed)      |
        y=-100 |   in       +--------+--------+----              |
               |     the       harbor basin (open water)        |
        y=-200 +------------- seabed z ~ -12 m ------------------+
              x=-300                                        x=+300
```

- **Pier A** (x=-140): intact, 120 m. **Pier B** (x=0): main pier, 140 m, with
  a portal gantry crane (28 m legs, boom sagged ~3.5 deg by the storm, copper
  tip cap). **Pier C** (x=+120): collapsed beyond y=-30 — tilted deck slabs,
  exposed pilings, a fallen slab on the seabed.
- **Obstruction zone** (SE of Pier C): collapsed concrete, three sunken
  containers, a sunken workboat (primary INSPECT target), two sunk caissons.
- One physical world above and below the waterline — same coordinates, same
  scene, no scene switching.

## Machine-readable metadata — `world.json`

| Section | Contents |
| --- | --- |
| `frame`, `waterline_z_m`, `bounds_enu_m`, `seabed` | frame contract & extents |
| `zones` (11) | `aerial_survey`, `harbor_basin`, `underwater_inspection`, `obstruction_zone`, `land_yard`, 3 road corridors, 3 pier decks (`pier_c_deck` flagged `damaged`) |
| `anchors` (7) | `port_datum`, `drone_home`, `rover_home`, `rov_home`, `crane_boom_tip`, `obstruction_primary`, `pier_c_collapse` |
| `routes` | ordered rover / ROV / drone-survey waypoint lists (validated to terminate in their task zones) |
| `camera_targets` | AIR / LAND / UNDERWATER / FOLLOW (per-role) / INSPECT / RESET with distance ranges, near/far and framing assumptions |
| `environment.sun` | scene daylight is a **world parameter** — UI theme must never alter it (DESIGN_SYSTEM.md) |
| `vehicle_reference_models` | true-scale dims measured from the GLBs (validated ±0.02 m) |
| `lod` | triangle budgets: high 150k, low 35k, references 3k |

### Camera-target metadata (final implementation is Issue #8)

Distances are suggested non-clipping ranges calibrated against real model
extents (world 600x440 m, crane 30 m tall, vehicles ~1 m). RESET is the
canonical cinematic framing: target (0,20,10), distance 330 m, azimuth 215 deg,
elevation 32 deg. INSPECT ranges keep the camera outside obstruction geometry
while remaining readable in murky water (near 0.15 m).

## Assets — `models/`

| File | Triangles | Purpose |
| --- | --- | --- |
| `port-world-high.glb` | 14,882 | full detail: props, debris, railings, road markings |
| `port-world-low.glb` | 2,458 | low-poly / weak-GPU fallback, same world volume |
| `drone-ref.glb` | 416 | quadcopter scale reference (1.24 x 1.24 x 0.25 m) |
| `rover-ref.glb` | 292 | wheeled UGV scale reference (1.06 x 0.72 x 0.81 m) |
| `rov-ref.glb` | 392 | observation ROV scale reference (1.38 x 0.71 x 0.65 m) |

- One merged primitive per material (18 / 13 primitives): few draw calls.
- PBR materials only, **no textures** (license-clean, fast). Container /
  debris color variety uses `COLOR_0` normalized ubyte vertex colors over a
  restrained palette matching DESIGN_SYSTEM.md (ivory concrete, petrol steel,
  copper accents, sea-glass water/hulls, ochre hazard markings).
- Vehicle models are **visual scale references, not verified equipment**;
  origin conventions are declared per model in `world.json`.

## Validate & regenerate (no project dependencies required)

```bash
cd assets/port-world
node tools/validate.js --selfcheck   # 44 checks + byte-determinism proof
node tools/generate.js               # deterministic regeneration of everything
```

`tools/generate.js` (Node stdlib only) deterministically emits the GLBs,
`world.json`, `previews/plan-view.svg` and `manifest.json` (sha256 inventory).
Re-running it twice produces byte-identical GLBs; the validator's
`--selfcheck` proves this by regenerating into a temp dir and comparing
hashes. Line endings are pinned by `assets/port-world/.gitattributes` so
manifest hashes survive fresh checkouts on any OS.

The validator (Node stdlib only — runs without installing anything and cannot
touch the pnpm lockfile) checks, among 44 assertions: frame/units/waterline
consistency; zone geometry and medium rules; anchor/route containment; camera
range sanity and scale ordering; strict GLB structure (chunks, accessor types,
index bounds); ENU extents vs declared bounds; triangle budgets; declared vs
measured vehicle scales; manifest sha256 integrity; absence of absolute paths;
**vertex-precise rover-corridor traversability** (no container geometry inside
the declared road corridors); and the determinism self-check.

*Language note:* Issue #19 suggests "Python stdlib" as an example standalone
runtime. Node stdlib was chosen because the repo toolchain pins Node (CI) and
the team's Windows machines have no working Python (`python` resolves to a
Windows Store stub). Same standalone guarantees; flagged for reviewer ruling.

## Integration notes for Issue #8

- Load `port-world-high.glb` (or `-low.glb`) directly — Y-up, identity root,
  no manual rotation. Mission coordinates come from `world.json` (ENU).
- The water surface and depth-tint quads are alpha-blended geometry; final
  water shading, fog, sky, shadows are runtime concerns (preview renderer in
  `tools/preview.html` shows one honest baseline).
- Anchors/zones are **metadata, not meshes**: render markers at runtime from
  `world.json` so they can be labeled, occlusion-tested and theme-independent.
- UI dark mode must not change `environment.sun`; scene daylight belongs to
  the world, the interface theme belongs to the shell (DESIGN_SYSTEM.md).
- WebGL-fallback story: the low LOD plus `plan-view.svg` demonstrate the
  geometry stays meaningful without a strong GPU; a 2D fallback remains
  Issue #8 scope.

## Limitations & honesty

- Fictional composite port; does not represent any real location, port
  survey, or bathymetry. Underwater visibility in the renders is a preview
  stylization — the visibility *fault* itself is simulator behavior (VQ-08).
- No physics, no dynamics, no GNSS: underwater work is local-ENU with the
  uncertainty assumptions recorded in `world.json` (no fake GPS below z=0).
- Static damage state; debris fields are hand-seeded, not simulated.
- Visual quality is deliberately "clean low-poly industrial diorama":
  premium direction continues at runtime (lighting/materials) in Issue #8.

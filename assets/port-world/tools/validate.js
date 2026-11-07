#!/usr/bin/env node
/**
 * VORQYN PORT-001 world-pack validator — zero-dependency Node (stdlib only).
 *
 * Run WITHOUT installing any project dependency (cannot touch the pnpm
 * lockfile). Validates world.json, all GLB binaries, manifest integrity,
 * zone/anchor/camera sanity, waterline and scale assumptions.
 *
 *   node tools/validate.js              # validate committed artifacts
 *   node tools/validate.js --selfcheck  # additionally regenerate into a temp
 *                                       # dir and byte-compare against committed
 *                                       # GLBs (determinism proof)
 *
 * Exit 0 = all checks passed. Exit 1 = at least one FAIL. Warnings never fail.
 *
 * NOTE ON LANGUAGE: Issue #19 suggests "Python stdlib" as an example standalone
 * runtime. This validator uses Node stdlib instead because the repo toolchain
 * is Node-pinned (CI) and the team's Windows machines have no working Python
 * (verified: `python` resolves to a Windows Store stub). Node >= 18 is already
 * required to build the project. Same standalone guarantees apply.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SELF_CHECK = process.argv.includes("--selfcheck");

let pass = 0, fail = 0, warn = 0;
const failures = [];

function check(id, label, ok, detail, level) {
  if (ok) {
    pass++;
    console.log(`[PASS] ${id} ${label}${detail ? " — " + detail : ""}`);
  } else if (level === "warn") {
    warn++;
    console.log(`[WARN] ${id} ${label}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    failures.push(`${id} ${label}${detail ? " — " + detail : ""}`);
    console.log(`[FAIL] ${id} ${label}${detail ? " — " + detail : ""}`);
  }
}

const near = (a, b, eps) => Math.abs(a - b) <= eps;
const isFiniteVec = (v) => v.every((x) => Number.isFinite(x));

/* glTF -> ENU conversion (inverse of generator's ENU -> glTF):
   enu_x = gltf_x, enu_y = -gltf_z, enu_z = gltf_y */
function gltfBoxToEnu(min, max) {
  const out = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const gx of [min[0], max[0]]) for (const gy of [min[1], max[1]]) for (const gz of [min[2], max[2]]) {
    const e = [gx, -gz, gy];
    for (let k = 0; k < 3; k++) {
      if (e[k] < out.min[k]) out.min[k] = e[k];
      if (e[k] > out.max[k]) out.max[k] = e[k];
    }
  }
  return out;
}

/* ---------------- GLB parsing (strict) ---------------- */
function parseGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  const res = { buf, errors: [], json: null, binByteLength: 0, tris: 0, prims: 0, materials: 0, enuBounds: null };
  const u32 = (o) => buf.readUInt32LE(o);
  if (buf.length < 20) { res.errors.push("file too small for GLB header"); return res; }
  if (u32(0) !== 0x46546C67) res.errors.push("bad magic (not glTF)");
  if (u32(4) !== 2) res.errors.push("unsupported glTF version " + u32(4));
  const total = u32(8);
  if (total !== buf.length) res.errors.push(`header length ${total} != file size ${buf.length}`);

  const jsonLen = u32(12), jsonType = u32(16);
  if (jsonType !== 0x4E4F534A) res.errors.push("chunk 0 is not JSON");
  try {
    res.json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  } catch (e) {
    res.errors.push("JSON chunk parse error: " + e.message);
    return res;
  }
  const binOff = 20 + jsonLen;
  if (binOff + 8 <= buf.length) {
    const binLen = u32(binOff), binType = u32(binOff + 4);
    if (binType !== 0x004E4942) res.errors.push("chunk 1 is not BIN");
    res.binByteLength = binLen;
    res.binFileOffset = binOff + 8; // bufferView offsets are relative to HERE
    if (binOff + 8 + binLen !== buf.length) res.errors.push("BIN chunk length does not end at file end");
  } else {
    res.errors.push("missing BIN chunk");
  }

  const g = res.json;
  if (!g.asset || g.asset.version !== "2.0") res.errors.push("asset.version must be '2.0'");
  res.materials = (g.materials || []).length;
  if (!g.buffers || g.buffers.length !== 1) res.errors.push("expected exactly 1 buffer");
  else if (g.buffers[0].byteLength !== res.binByteLength) {
    res.errors.push(`buffers[0].byteLength ${g.buffers[0].byteLength} != BIN chunk ${res.binByteLength}`);
  }

  const nBV = (g.bufferViews || []).length, nAcc = (g.accessors || []).length;
  const binLen = res.binByteLength;
  const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const compCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  (g.bufferViews || []).forEach((bv, i) => {
    if (bv.buffer !== 0) res.errors.push(`bufferViews[${i}].buffer != 0`);
    if (bv.byteOffset % 4 !== 0) res.errors.push(`bufferViews[${i}].byteOffset not 4-aligned`);
    if (bv.byteOffset + bv.byteLength > binLen) res.errors.push(`bufferViews[${i}] exceeds buffer`);
  });

  const meshEnuMin = [Infinity, Infinity, Infinity], meshEnuMax = [-Infinity, -Infinity, -Infinity];
  res.primsByMaterial = [];
  (g.meshes || []).forEach((mesh) => {
    if (!mesh.primitives || mesh.primitives.length === 0) { res.errors.push("mesh with no primitives"); return; }
    mesh.primitives.forEach((prim) => {
      res.prims++;
      const attrs = prim.attributes || {};
      if (prim.material === undefined || prim.material < 0 || prim.material >= res.materials) {
        res.errors.push("primitive material index out of range");
      }
      const posAcc = g.accessors[attrs.POSITION];
      if (!posAcc) { res.errors.push("missing POSITION accessor"); return; }
      if (posAcc.componentType !== 5126 || posAcc.type !== "VEC3") res.errors.push("POSITION must be float VEC3");
      if (!posAcc.min || !posAcc.max || posAcc.min.length !== 3 || posAcc.max.length !== 3) {
        res.errors.push("POSITION accessor missing min/max (required by this pack's convention)");
      } else {
        const eb = gltfBoxToEnu(posAcc.min, posAcc.max);
        for (let k = 0; k < 3; k++) {
          meshEnuMin[k] = Math.min(meshEnuMin[k], eb.min[k]);
          meshEnuMax[k] = Math.max(meshEnuMax[k], eb.max[k]);
        }
        res.primsByMaterial.push({
          material: (g.materials[prim.material] || {}).name || "?",
          enuBounds: eb,
          posRef: { bufferView: posAcc.bufferView, byteOffset: posAcc.byteOffset || 0, count: posAcc.count },
        });
      }
      if (posAcc.bufferView !== undefined) {
        const bv = g.bufferViews[posAcc.bufferView];
        const bytes = posAcc.count * 12;
        if (bv.byteLength < bytes) res.errors.push("POSITION accessor exceeds its bufferView");
      }
      if (attrs.NORMAL !== undefined) {
        const n = g.accessors[attrs.NORMAL];
        if (!n || n.componentType !== 5126 || n.type !== "VEC3") res.errors.push("NORMAL must be float VEC3");
        if (n.count !== posAcc.count) res.errors.push("NORMAL count != POSITION count");
      }
      if (attrs.COLOR_0 !== undefined) {
        const c = g.accessors[attrs.COLOR_0];
        if (!c || c.componentType !== 5121 || c.type !== "VEC4" || !c.normalized) {
          res.errors.push("COLOR_0 must be normalized ubyte VEC4");
        }
        if (c.count !== posAcc.count) res.errors.push("COLOR_0 count != POSITION count");
      }
      if (prim.indices !== undefined) {
        const ia = g.accessors[prim.indices];
        if (!ia) { res.errors.push("indices accessor missing"); return; }
        if (![5121, 5123, 5125].includes(ia.componentType) || ia.type !== "SCALAR") {
          res.errors.push("indices must be ubyte/ushort/uint SCALAR");
        }
        const maxIdx = Math.ceil(posAcc.count);
        res.tris += ia.count / 3;
        // index bounds check (bufferView offsets are BIN-chunk-relative)
        const bv = g.bufferViews[ia.bufferView];
        const cs = compSize[ia.componentType];
        const need = ia.count * cs;
        if (bv.byteLength < need) { res.errors.push("indices exceed bufferView"); return; }
        const base = (res.binFileOffset || 0) + bv.byteOffset;
        let hi = 0;
        for (let i = 0; i < ia.count; i++) {
          const v = ia.componentType === 5125 ? buf.readUInt32LE(base + i * 4)
            : ia.componentType === 5123 ? buf.readUInt16LE(base + i * 2)
              : buf.readUInt8(base + i);
          if (v > hi) hi = v;
        }
        if (hi >= maxIdx) res.errors.push(`index ${hi} >= vertex count ${maxIdx}`);
      } else {
        res.tris += posAcc.count / 3;
      }
    });
  });

  // root node identity rotation (conversion is authored into coordinates)
  const root = (g.nodes || [])[g.scenes[g.scene].nodes[0]];
  if (!root) res.errors.push("scene root node missing");
  else {
    const q = root.rotation || [0, 0, 0, 1];
    if (!near(q[0], 0, 1e-9) || !near(q[1], 0, 1e-9) || !near(q[2], 0, 1e-9) || !near(q[3], 1, 1e-9)) {
      res.errors.push("root rotation must be identity (geometry is authored Y-up)");
    }
  }

  if (Number.isFinite(meshEnuMin[0])) {
    res.enuBounds = { min: meshEnuMin, max: meshEnuMax };
  }
  void nAcc; void nBV; void compCount;
  return res;
}

/* ---------------- main ---------------- */
function main() {
  console.log(`VORQYN PORT-001 validator — node ${process.version} — ${new Date().toISOString()}`);
  console.log(`pack root: ${path.basename(ROOT)}/ (relative mode, no absolute paths emitted)\n`);

  /* [1] world.json */
  let W;
  try {
    W = JSON.parse(fs.readFileSync(path.join(ROOT, "world.json"), "utf8"));
  } catch (e) {
    check(1, "world.json parse", false, e.message);
    return finish();
  }
  check(1, "world.json parses; schema id", W.schema === "vorqyn.port-world/1", W.schema);
  check(2, "frame is local ENU in meters",
    W.frame && W.frame.type === "ENU_local" && W.frame.units === "meter" &&
    W.frame.axes.x === "east" && W.frame.axes.y === "north" && W.frame.axes.z === "up");
  check(3, "waterline is z=0", W.waterline_z_m === 0, `z=${W.waterline_z_m}`);
  const bmin = W.bounds_enu_m.min, bmax = W.bounds_enu_m.max;
  check(4, "world bounds min<max on all axes",
    bmin.every((v, i) => v < bmax[i]), `[${bmin}] .. [${bmax}]`);
  check(5, "bounds magnitude plausible for a port (100-1000 m per axis) — unit-confusion guard",
    bmax[0] - bmin[0] >= 100 && bmax[0] - bmin[0] <= 1000 &&
    bmax[1] - bmin[1] >= 100 && bmax[1] - bmin[1] <= 1000 &&
    bmax[2] - bmin[2] <= 200,
    `${bmax[0] - bmin[0]} x ${bmax[1] - bmin[1]} x ${bmax[2] - bmin[2]} m`);
  check(6, "gltf conversion rule declares identity root (Y-up authored)",
    W.gltf_conversion && W.gltf_conversion.root_rotation_quaternion_xyzw.every((v, i) => near(v, [0, 0, 0, 1][i], 1e-12)));
  check(7, "scene daylight documented as world parameter (not UI theme)",
    !!(W.environment && W.environment.note && /dark mode must NOT/i.test(W.environment.note)));

  /* [2] zones */
  const zones = new Map((W.zones || []).map((z) => [z.id, z]));
  const requiredZones = ["aerial_survey", "harbor_basin", "underwater_inspection", "obstruction_zone",
    "land_yard", "road_trunk", "pier_a_deck", "pier_b_deck", "pier_c_deck"];
  check(8, "required zones present", requiredZones.every((id) => zones.has(id)),
    requiredZones.filter((id) => !zones.has(id)).join(",") || "all present");
  let zoneGeoOk = true, zoneDetail = [];
  for (const z of W.zones || []) {
    const { min, max } = z.box_enu_m;
    if (!isFiniteVec(min) || !isFiniteVec(max)) { zoneGeoOk = false; zoneDetail.push(z.id + ":nonfinite"); continue; }
    for (let k = 0; k < 3; k++) if (min[k] >= max[k]) { zoneGeoOk = false; zoneDetail.push(z.id + ":min>=max"); }
    for (let k = 0; k < 3; k++) {
      if (min[k] < bmin[k] - 1e-6 || max[k] > bmax[k] + 1e-6) { zoneGeoOk = false; zoneDetail.push(z.id + ":outside bounds"); }
    }
  }
  check(9, "all zone boxes finite, min<max, inside world bounds", zoneGeoOk, zoneDetail.join("; "));
  const zBox = (id) => zones.get(id) && zones.get(id).box_enu_m;
  const air = zBox("aerial_survey"), uw = zBox("underwater_inspection"), oz = zBox("obstruction_zone");
  check(10, "airspace zone entirely above waterline", !!air && air.min[2] > 0, `min z=${air && air.min[2]}`);
  check(11, "underwater zones entirely below waterline and above/at world seabed floor",
    !!uw && !!oz && uw.max[2] <= 0 && oz.max[2] <= 0 &&
    uw.min[2] >= W.seabed.approx_min_z_m - 1.0 && oz.min[2] >= W.seabed.approx_min_z_m - 1.0,
    `uw z[${uw && uw.min[2]}, ${uw && uw.max[2]}]`);
  check(12, "obstruction_zone is inside underwater_inspection",
    !!uw && !!oz && oz.min[0] >= uw.min[0] && oz.max[0] <= uw.max[0] &&
    oz.min[1] >= uw.min[1] && oz.max[1] <= uw.max[1] && oz.min[2] >= uw.min[2] && oz.max[2] <= uw.max[2]);
  const pc = zones.get("pier_c_deck");
  check(13, "pier_c_deck flagged damaged (story consistency)",
    !!(pc && pc.flags && pc.flags.damaged === true));
  let landAboveWater = true;
  for (const z of W.zones || []) if (z.kind === "land") if (z.box_enu_m.min[2] < 0) landAboveWater = false;
  check(14, "land-kind zones never dip below waterline", landAboveWater);

  /* [3] anchors */
  const anchors = new Map((W.anchors || []).map((a) => [a.id, a]));
  let anchorOk = true, anchorDetail = [];
  const anchorIds = [];
  for (const a of W.anchors || []) {
    anchorIds.push(a.id);
    if (!isFiniteVec(a.position_enu_m)) { anchorOk = false; anchorDetail.push(a.id + ":nonfinite"); }
    for (let k = 0; k < 3; k++) {
      if (a.position_enu_m[k] < bmin[k] || a.position_enu_m[k] > bmax[k]) { anchorOk = false; anchorDetail.push(a.id + ":outside world"); }
    }
  }
  check(15, "anchors finite and inside world bounds", anchorOk, anchorDetail.join("; "));
  check(16, "anchor ids unique", new Set(anchorIds).size === anchorIds.length);
  const az = (id) => anchors.get(id) && anchors.get(id).position_enu_m[2];
  check(17, "drone_home is airborne (z>=15)", az("drone_home") >= 15, `z=${az("drone_home")}`);
  check(18, "rover_home stands on land deck elevation (3.5..6.5 m)",
    az("rover_home") >= 3.5 && az("rover_home") <= 6.5, `z=${az("rover_home")}`);
  check(19, "rov_home submerged between waterline and seabed",
    az("rov_home") <= -0.5 && az("rov_home") > W.seabed.approx_min_z_m, `z=${az("rov_home")}`);
  check(20, "INSPECT anchors exist (obstruction_primary, crane_boom_tip)",
    anchors.has("obstruction_primary") && anchors.has("crane_boom_tip"));

  /* [4] routes */
  const inBox = (p, box) => p[0] >= box.min[0] && p[0] <= box.max[0] && p[1] >= box.min[1] && p[1] <= box.max[1] && p[2] >= box.min[2] && p[2] <= box.max[2];
  const rr = (W.routes || {}).rover || [], vr = (W.routes || {}).rov || [], dr = (W.routes || {}).drone_survey || [];
  check(21, "rover route terminates on pier_b_deck", rr.length > 0 && inBox(rr[rr.length - 1], zBox("pier_b_deck")));
  check(22, "rov route terminates inside obstruction_zone", vr.length > 0 && inBox(vr[vr.length - 1], oz));
  check(23, "drone survey waypoints inside aerial_survey", dr.length > 0 && dr.every((p) => inBox(p, air)));
  let routeOk = true;
  for (const r of [rr, vr, dr]) for (const p of r) if (!isFiniteVec(p)) routeOk = false;
  check(24, "all route points finite", routeOk);

  /* [5] camera targets */
  const ct = W.camera_targets || {};
  const needModes = ["AIR", "LAND", "UNDERWATER", "FOLLOW", "INSPECT", "RESET"];
  check(25, "all six camera modes defined", needModes.every((m) => ct[m]), needModes.filter((m) => !ct[m]).join(","));
  let camOk = true, camDetail = [];
  const distMin = {};
  for (const m of ["AIR", "LAND", "UNDERWATER"]) {
    const c = ct[m];
    if (!c) { camOk = false; continue; }
    const [d0, d1] = c.distance_range_m;
    distMin[m] = d0;
    if (!(d0 > 0 && d1 > d0)) { camOk = false; camDetail.push(m + ":bad range"); }
    if (!(c.near_m > 0 && c.near_m < d0 && c.far_m > d1)) { camOk = false; camDetail.push(m + ":near/far vs range"); }
    if (c.target_enu_m && !isFiniteVec(c.target_enu_m)) { camOk = false; camDetail.push(m + ":target"); }
  }
  check(26, "AIR/LAND/UNDERWATER ranges, near/far and targets sane", camOk, camDetail.join("; "));
  const fb = ct.FOLLOW && ct.FOLLOW.by_role;
  check(27, "FOLLOW defines per-role ranges for drone/rover/rov",
    !!fb && ["drone", "rover", "rov"].every((r) => {
      const e = fb[r];
      return e && e.distance_range_m[0] > 0 && e.distance_range_m[1] > e.distance_range_m[0] && e.near_m > 0;
    }));
  const insp = ct.INSPECT && ct.INSPECT.targets;
  check(28, "INSPECT targets reference existing anchors with sane ranges",
    Array.isArray(insp) && insp.length > 0 && insp.every((t) =>
      anchors.has(t.anchor) && t.distance_range_m[0] > 0 && t.distance_range_m[1] > t.distance_range_m[0]));
  check(29, "camera scale sanity: AIR min dist > LAND > FOLLOW(drone) > INSPECT primary",
    distMin.AIR > distMin.LAND && distMin.LAND > fb.drone.distance_range_m[0] &&
    fb.drone.distance_range_m[0] > insp[0].distance_range_m[0],
    `${distMin.AIR} > ${distMin.LAND} > ${fb.drone.distance_range_m[0]} > ${insp[0].distance_range_m[0]}`);
  const rs = ct.RESET;
  check(30, "RESET framing sane (distance>0, elevation 0..90, azimuth finite)",
    rs && rs.distance_m > 0 && rs.elevation_deg > 0 && rs.elevation_deg < 90 && Number.isFinite(rs.azimuth_deg),
    `d=${rs && rs.distance_m} el=${rs && rs.elevation_deg} az=${rs && rs.azimuth_deg}`);

  /* [6..11] GLB files */
  const glbSpec = [
    { file: "port-world-high.glb", kind: "world" },
    { file: "port-world-low.glb", kind: "world" },
    { file: "drone-ref.glb", kind: "ref", role: "drone" },
    { file: "rover-ref.glb", kind: "ref", role: "rover" },
    { file: "rov-ref.glb", kind: "ref", role: "rov" },
  ];
  const parsed = new Map();
  for (const spec of glbSpec) {
    const p = path.join(ROOT, "models", spec.file);
    if (!fs.existsSync(p)) { check(31, `GLB present: ${spec.file}`, false, "missing"); continue; }
    const res = parseGlb(p);
    check(31, `GLB structure valid: ${spec.file}`, res.errors.length === 0,
      res.errors.length ? res.errors.slice(0, 3).join(" | ") : `${res.tris} tris, ${res.prims} prims`);
    parsed.set(spec.file, res);
  }

  const hi = parsed.get("port-world-high.glb"), lo = parsed.get("port-world-low.glb");
  if (hi && hi.enuBounds) {
    const { min, max } = hi.enuBounds;
    let inb = true;
    for (let k = 0; k < 3; k++) if (min[k] < bmin[k] - 1.0 || max[k] > bmax[k] + 1.0) inb = false;
    check(32, "high-LOD geometry ENU extents inside world bounds (+-1 m tol)",
      inb, `[${min.map((v) => v.toFixed(1))}] .. [${max.map((v) => v.toFixed(1))}]`);
    check(33, "world has geometry above waterline and below it (one shared world)",
      max[2] > 0.5 && min[2] < -1.0, `z ${min[2].toFixed(1)} .. ${max[2].toFixed(1)}`);
    check(34, "no geometry beyond world extremes (unit-confusion guard)",
      max[2] < 120 && min[2] > -40 && Math.abs(max[0] - bmax[0]) < 60 && Math.abs(min[1] - bmin[1]) < 60);
  }
  check(35, "triangle budgets: high/low/reference",
    hi && lo && hi.tris <= W.lod.high.max_triangles && lo.tris <= W.lod.low.max_triangles &&
    [...parsed.entries()].filter(([f, r]) => f.endsWith("-ref.glb")).every(([, r]) => r.tris <= W.lod.reference_models.max_triangles),
    `high=${hi && hi.tris}/${W.lod.high.max_triangles} low=${lo && lo.tris}/${W.lod.low.max_triangles}`);
  if (hi && lo && hi.enuBounds && lo.enuBounds) {
    const agree = hi.enuBounds.min.every((v, k) => Math.abs(v - lo.enuBounds.min[k]) <= 2.0) &&
      hi.enuBounds.max.every((v, k) => Math.abs(v - lo.enuBounds.max[k]) <= 2.0);
    check(36, "low-LOD occupies same world volume as high-LOD (+-2 m)", agree);
  }

  /* vehicle reference scale vs declared */
  for (const [role, def] of Object.entries(W.vehicle_reference_models || {})) {
    const res = parsed.get(def.file);
    if (!res || !res.enuBounds) { check(37, `scale check ${role}`, false, "model missing"); continue; }
    const dims = res.enuBounds.max.map((v, k) => v - res.enuBounds.min[k]);
    const nom = [def.nominal_dims_enu_m.x, def.nominal_dims_enu_m.y, def.nominal_dims_enu_m.z];
    const ok = dims.every((v, k) => near(v, nom[k], 0.02));
    check(37, `scale check ${role}: measured vs declared dims (+-0.02 m)`, ok,
      `measured [${dims.map((v) => v.toFixed(2))}] declared [${nom.map((v) => v.toFixed(2))}]`);
  }

  /* [12] manifest integrity */
  let M;
  try {
    M = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  } catch (e) {
    check(38, "manifest.json parses", false, e.message);
    return finish();
  }
  check(38, "manifest schema + generator provenance recorded",
    M.schema === "vorqyn.port-world.manifest/1" && !!(M.generated_by && M.generated_by.tool_sha256 && M.generated_by.deterministic));
  let manOk = true, manDetail = [];
  const listed = new Set();
  for (const f of M.files || []) {
    listed.add(f.path.replace(/\\/g, "/"));
    const p = path.join(ROOT, f.path);
    if (!fs.existsSync(p)) { manOk = false; manDetail.push(f.path + ":missing"); continue; }
    const data = fs.readFileSync(p);
    if (data.length !== f.bytes) { manOk = false; manDetail.push(f.path + ":size"); continue; }
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    if (sha !== f.sha256) { manOk = false; manDetail.push(f.path + ":sha256"); }
    if (f.gltf) {
      const r = parsed.get(path.basename(f.path));
      if (r) {
        if (Math.abs(r.tris - f.gltf.triangles) > 0.5) { manOk = false; manDetail.push(f.path + ":tris"); }
        else if (r.enuBounds && f.gltf.bounds_enu_m) {
          const okB = r.enuBounds.min.every((v, k) => near(v, f.gltf.bounds_enu_m.min[k], 0.01)) &&
            r.enuBounds.max.every((v, k) => near(v, f.gltf.bounds_enu_m.max[k], 0.01));
          if (!okB) { manOk = false; manDetail.push(f.path + ":bounds"); }
        }
      }
    }
  }
  check(39, "manifest entries: files exist, sizes + sha256 + stats match actual", manOk, manDetail.join("; "));
  const expectedFiles = glbSpec.map((s) => "models/" + s.file).concat(["world.json", "previews/plan-view.svg"]);
  check(40, "manifest covers all deliverable artifacts",
    expectedFiles.every((f) => listed.has(f)), expectedFiles.filter((f) => !listed.has(f)).join(",") || "complete");

  /* [13] hygiene: no absolute filesystem paths embedded in DATA artifacts.
     Tool .js/.mjs sources are excluded because their own regex/pattern
     literals legitimately contain these strings as detection patterns. */
  const textExt = [".json", ".md", ".svg", ".html"];
  const absRe = new RegExp("([A-Za-z]:\\\\|/Users/|/home/|/tmp/|\\\\Users\\\\)");
  let absHit = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!textExt.includes(path.extname(e.name))) continue;
      const txt = fs.readFileSync(p, "utf8");
      if (absRe.test(txt)) absHit.push(path.relative(ROOT, p));
    }
  };
  walk(ROOT);
  check(41, "no absolute filesystem paths embedded in data artifacts", absHit.length === 0, absHit.join(", "));
  check(42, "plan-view preview diagram present", fs.existsSync(path.join(ROOT, "previews", "plan-view.svg")) &&
    fs.statSync(path.join(ROOT, "previews", "plan-view.svg")).size > 500);

  /* [13b] route-traversability: no container GEOMETRY (vertex-precise) inside
     road corridors. Merged-primitive bboxes are too coarse; we scan the actual
     POSITION vertices of container_paint primitives. */
  const corridors = ["road_trunk", "road_branch", "road_quay"]
    .map((id) => ({ id, box: zBox(id) }))
    .filter((c) => !!c.box)
    .map((c) => ({ ...c, min: [c.box.min[0] + 1, c.box.min[1] + 1, c.box.min[2]], max: [c.box.max[0] - 1, c.box.max[1] - 1, c.box.max[2]] }));
  let roadBlocked = [];
  for (const spec of glbSpec.filter((s) => s.kind === "world")) {
    const r = parsed.get(spec.file);
    if (!r || !r.primsByMaterial) continue;
    for (const prim of r.primsByMaterial) {
      if (prim.material !== "container_paint" || !prim.posRef) continue;
      // bbox pre-filter per corridor
      const active = corridors.filter((c) =>
        prim.enuBounds.max[0] >= c.min[0] && prim.enuBounds.min[0] <= c.max[0] &&
        prim.enuBounds.max[1] >= c.min[1] && prim.enuBounds.min[1] <= c.max[1] &&
        prim.enuBounds.max[2] >= c.min[2] && prim.enuBounds.min[2] <= c.max[2]);
      if (active.length === 0) continue;
      const bv = r.json.bufferViews[prim.posRef.bufferView];
      const base = (r.binFileOffset || 0) + bv.byteOffset + prim.posRef.byteOffset;
      const n = prim.posRef.count;
      for (let i = 0; i < n; i++) {
        const gx = r.buf.readFloatLE(base + i * 12);
        const gy = r.buf.readFloatLE(base + i * 12 + 4);
        const gz = r.buf.readFloatLE(base + i * 12 + 8);
        const e = [gx, -gz, gy]; // glTF -> ENU
        for (const c of active) {
          if (e[0] >= c.min[0] && e[0] <= c.max[0] && e[1] >= c.min[1] && e[1] <= c.max[1] && e[2] >= c.min[2] && e[2] <= c.max[2]) {
            roadBlocked.push(`${spec.file}:${c.id}@(${e[0].toFixed(0)},${e[1].toFixed(0)},${e[2].toFixed(0)})`);
            i = n; // one hit per primitive per file is enough detail
            break;
          }
        }
        if (roadBlocked.length > 8) break;
      }
      if (roadBlocked.length > 8) break;
    }
    if (roadBlocked.length > 8) break;
  }
  check(44, "declared rover road corridors are free of container geometry (vertex-precise)",
    roadBlocked.length === 0, roadBlocked.join(", ") || "corridors clear");

  /* [14] optional determinism self-check */
  if (SELF_CHECK) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vq-portworld-"));
    const toolsDir = path.join(tmp, "tools");
    fs.mkdirSync(toolsDir);
    fs.copyFileSync(path.join(ROOT, "tools", "generate.js"), path.join(toolsDir, "generate.js"));
    try {
      execFileSync(process.execPath, [path.join(toolsDir, "generate.js")], { cwd: tmp, stdio: "pipe" });
      let detOk = true, detDetail = [];
      for (const spec of glbSpec) {
        const a = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "models", spec.file))).digest("hex");
        const b = crypto.createHash("sha256").update(fs.readFileSync(path.join(tmp, "models", spec.file))).digest("hex");
        if (a !== b) { detOk = false; detDetail.push(spec.file); }
      }
      check(43, "determinism self-check: regenerated GLBs byte-identical to committed", detOk, detDetail.join(", ") || "all 5 identical");
    } catch (e) {
      check(43, "determinism self-check: regeneration ran", false, String(e.message).slice(0, 120));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    console.log("[SKIP] determinism self-check (run with --selfcheck to enable)");
  }

  return finish();

  function finish() {
    console.log(`\nSUMMARY: ${pass} passed, ${fail} failed, ${warn} warnings`);
    if (fail > 0) {
      console.log("\nFailures:");
      for (const f of failures) console.log("  - " + f);
      process.exit(1);
    }
    process.exit(0);
  }
}

main();

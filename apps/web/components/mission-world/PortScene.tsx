"use client";

/**
 * R3F scene for the PORT-001 world preview.
 *
 * The GLBs are glTF-native Y-up with the ENU conversion baked in by the
 * asset generator. This file converts anchor/zone coordinates EXACTLY ONCE
 * via enuToScene and never rotates the world root. Scene daylight comes from
 * world.json and is independent of the UI theme.
 */
import { Html, Line, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { sunDirection, type CameraPose } from "./camera-presets";
import { enuToScene, type SceneVec3 } from "./enu";
import { MACHINES, type MachineSpec } from "./machines";
import { anchorById, zoneById, type PortWorld, type PortWorldZone } from "./world-data";
import { demoPoseToScene, type DemoRobotView } from "./demo-sim/contract";
import type { GhostPaths as GhostPathsType } from "./ghost-paths";

const HIGH_URL = "/port-world/port-world-high.glb";
const LOW_URL = "/port-world/port-world-low.glb";

const DAY_SKY = "#d7e2df";
const UW_SKY = "#0b3237";

/** Structural subset of OrbitControls the rig needs (no any-typing). */
interface ControlsLike {
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  update: () => void;
}

export interface PortSceneProps {
  world: PortWorld;
  selectedId: string | null;
  onSelect: (id: string) => void;
  pose: CameraPose | null;
  reducedMotion: boolean;
  lowGpu: boolean;
  onContextLost: () => void;
  onContextRestored: () => void;
  /** Latest kernel-observed robot views (null = no session, static anchors). */
  liveRobots: DemoRobotView[] | null;
  /** Kernel state of the displayed snapshot ("running"/"paused"/"stopped"). */
  sessionKernelState: string | null;
  /** Scene-space pose the FOLLOW camera tracks (null = not following). */
  followTarget: SceneVec3 | null;
  /** Recorded pre/post-fault ROV paths (Issue #15 Ghost Replay). */
  ghostPaths: GhostPathsType | null;
}

export function PortScene(props: PortSceneProps) {
  const { world, pose, lowGpu, reducedMotion } = props;
  const sun = sunDirection(world);
  const controlsRef = useRef<ControlsLike | null>(null);
  if (!pose) return null;
  const underwater = pose.underwater;
  return (
    <Canvas
      dpr={[1, lowGpu ? 1 : 2]}
      shadows={!lowGpu}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{
        near: pose.near_m,
        far: pose.far_m,
        position: pose.position as unknown as [number, number, number],
        fov: 50,
      }}
      onCreated={({ gl }) => {
        const lost = (event: Event) => {
          event.preventDefault();
          props.onContextLost();
        };
        const restored = () => props.onContextRestored();
        gl.domElement.addEventListener("webglcontextlost", lost, false);
        gl.domElement.addEventListener("webglcontextrestored", restored, false);
      }}
      style={{ width: "100%", height: "100%" }}
      aria-label="Interactive 3D preview of the PORT-001 port world. Use the camera station buttons and machine selector outside the canvas to navigate."
      role="application"
    >
      <SceneEnvironment underwater={underwater} />
      <UnderwaterFill enabled={underwater} />
      <hemisphereLight args={[0xe8e4d4, 0x16333a, 1.0]} />
      <directionalLight
        position={[sun[0] * 300, sun[1] * 300, sun[2] * 300]}
        intensity={2.6}
        castShadow={!lowGpu}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-330}
        shadow-camera-right={330}
        shadow-camera-top={260}
        shadow-camera-bottom={-260}
        shadow-camera-near={50}
        shadow-camera-far={900}
        shadow-bias={-0.0004}
      />
      <Suspense fallback={null}>
        <PortModel low={lowGpu} />
        {MACHINES.map((machine) => (
          <Machine
            key={machine.id}
            world={world}
            machine={machine}
            selected={props.selectedId === machine.id}
            onSelect={props.onSelect}
            reducedMotion={props.reducedMotion}
            liveRobot={props.liveRobots?.find((r) => r.robotId === machine.robotId) ?? null}
            underwater={underwater}
          />
        ))}
        {props.ghostPaths?.pre?.segments.map((segment, si) => (
          <Line
            key={`ghost-pre-${si}`}
            points={segment.points.map(
              (p) => [p[0], p[1] + 0.3, p[2]] as [number, number, number],
            )}
            color="#7bd9c6"
            lineWidth={1.6}
            dashed
            dashSize={1.6}
            gapSize={1}
            transparent
            opacity={0.8}
          />
        ))}
        {props.ghostPaths?.post?.segments.map((segment, si) => (
          <Line
            key={`ghost-post-${si}`}
            points={segment.points.map(
              (p) => [p[0], p[1] + 0.3, p[2]] as [number, number, number],
            )}
            color="#de9c7c"
            lineWidth={2}
            transparent
            opacity={0.85}
          />
        ))}
        <ZoneFrames world={world} underwater={underwater} />
      </Suspense>
      <CameraRig
        pose={pose}
        reducedMotion={reducedMotion}
        controlsRef={controlsRef}
        followTarget={props.followTarget}
      />
      <OrbitControls
        makeDefault
        ref={controlsRef as never}
        enableDamping={!reducedMotion}
        dampingFactor={0.08}
      />
    </Canvas>
  );
}

function SceneEnvironment({ underwater }: { underwater: boolean }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.background = new THREE.Color(underwater ? UW_SKY : DAY_SKY);
    scene.fog = underwater ? new THREE.Fog(UW_SKY, 5, 150) : new THREE.Fog(DAY_SKY, 500, 1100);
  }, [scene, underwater]);
  return null;
}

/** Static fill light over the obstruction zone so it stays readable in murk. */
function UnderwaterFill({ enabled }: { enabled: boolean }) {
  const target = demoPoseToScene({ x: 170, y: -90, z: -9 });
  if (!enabled) return null;
  return (
    <pointLight
      position={[target[0], target[1] + 6, target[2]]}
      intensity={55}
      distance={90}
      decay={1.4}
      color="#c8ece6"
    />
  );
}

function PortModel({ low }: { low: boolean }) {
  const source = useGLTF(low ? LOW_URL : HIGH_URL).scene;
  const processed = useMemo(() => {
    const root = source.clone(true);
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      const isWater = materials.some((m) => (m?.name ?? "").includes("water"));
      obj.castShadow = !isWater;
      obj.receiveShadow = !isWater;
    });
    return root;
  }, [source]);
  return <primitive object={processed} />;
}

function Machine({
  world,
  machine,
  selected,
  onSelect,
  reducedMotion,
  liveRobot,
  underwater,
}: {
  world: PortWorld;
  machine: MachineSpec;
  selected: boolean;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  liveRobot: DemoRobotView | null;
  underwater: boolean;
}) {
  const source = useGLTF(machine.file).scene;
  const model = useMemo(() => source.clone(true), [source]);
  const anchor = anchorById(world, machine.anchorId);
  const staticPosition = useMemo(
    () => (anchor ? enuToScene(anchor.position_enu_m) : ([0, 0, 0] as SceneVec3)),
    [anchor],
  );
  // Live pose replaces the static anchor exactly once via the same
  // conversion; the model never receives a second rotation.
  const livePosition = useMemo(
    () => (liveRobot ? demoPoseToScene(liveRobot.pose) : null),
    [liveRobot],
  );
  const position = livePosition ?? staticPosition;

  // Heading: derive from consecutive observed poses (never invented) — hold
  // the fixture yaw while stationary, disconnected or before first movement.
  const [yawDeg, setYawDeg] = useState(machine.yawDeg);
  const previousLiveRef = useRef<{ pose: { x: number; y: number; z: number } } | null>(null);
  useEffect(() => {
    if (!liveRobot) {
      setYawDeg(machine.yawDeg);
      previousLiveRef.current = null;
      return;
    }
    const previous = previousLiveRef.current;
    previousLiveRef.current = liveRobot;
    if (!previous || !liveRobot.fresh) return;
    const dx = liveRobot.pose.x - previous.pose.x;
    const dy = liveRobot.pose.y - previous.pose.y;
    if (Math.hypot(dx, dy) < 0.05) return;
    // Scene-space heading for a +x-forward model: atan2 of the scene delta.
    const sceneDelta = demoPoseToScene(liveRobot.pose);
    const prevScene = demoPoseToScene(previous.pose);
    const sdx = sceneDelta[0] - prevScene[0];
    const sdz = sceneDelta[2] - prevScene[2];
    setYawDeg((Math.atan2(sdx, sdz) * 180) / Math.PI);
  }, [liveRobot, machine.yawDeg]);

  // Traveled path: bounded strictly by real kernel-observed positions.
  const [trail, setTrail] = useState<SceneVec3[]>([]);
  useEffect(() => {
    if (!livePosition) return;
    setTrail((current) => {
      const last = current[current.length - 1];
      if (last && Math.hypot(last[0] - livePosition[0], last[1] - livePosition[1], last[2] - livePosition[2]) < 0.05) {
        return current;
      }
      const next = [...current, livePosition];
      return next.length > 60 ? next.slice(next.length - 60) : next;
    });
  }, [livePosition]);
  useEffect(() => {
    if (!liveRobot) setTrail([]);
  }, [Boolean(liveRobot)]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only on session boundary

  return (
    <group position={position as unknown as [number, number, number]}>
      <group rotation-y={(yawDeg * Math.PI) / 180}>
        <primitive
          object={model}
          onClick={(event: { stopPropagation: () => void }) => {
            event.stopPropagation();
            onSelect(machine.id);
          }}
        />
      </group>
      {trail.length > 1 && (
        <Line
          points={trail.map((p) => [p[0], p[1] + 0.15, p[2]] as [number, number, number])}
          color={underwater ? "#8fe8dc" : "#2fb5a8"}
          lineWidth={1}
          transparent
          opacity={0.55}
        />
      )}
      <SelectionRing selected={selected} reducedMotion={reducedMotion} underwater={underwater} />
      <Html position={[0, 1.15, 0]} center zIndexRange={[30, 10]} pointerEvents="none">
        <div
          className={`whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-tight backdrop-blur-sm ${
            selected
              ? "border-primary bg-card text-foreground"
              : liveRobot && !liveRobot.fresh
                ? "border-warning bg-card/90 text-warning"
                : "border-border bg-background/75 text-muted-foreground"
          }`}
        >
          {machine.label}
          {liveRobot && !liveRobot.fresh ? " · stale" : ""}
          {selected ? " · selected" : ""}
        </div>
      </Html>
    </group>
  );
}

function SelectionRing({
  selected,
  reducedMotion,
  underwater,
}: {
  selected: boolean;
  reducedMotion: boolean;
  underwater: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (selected && !reducedMotion) {
      ref.current.scale.setScalar(1 + 0.07 * Math.sin(clock.elapsedTime * 3));
    } else {
      ref.current.scale.setScalar(1);
    }
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={2}>
      <ringGeometry args={[0.85, 1.05, 48]} />
      <meshBasicMaterial
        color={selected ? "#de9c7c" : underwater ? "#b9d3d5" : "#536d6c"}
        transparent
        opacity={selected ? 0.95 : underwater ? 0.6 : 0.35}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

const FRAMED_ZONES = ["aerial_survey", "underwater_inspection", "obstruction_zone", "pier_c_deck"];

function ZoneFrames({ world, underwater }: { world: PortWorld; underwater: boolean }) {
  const zones = FRAMED_ZONES.map((id) => zoneById(world, id)).filter(
    (z): z is PortWorldZone => Boolean(z),
  );
  return (
    <>
      {zones.map((zone) => (
        <ZoneFrame key={zone.id} zone={zone} underwater={underwater} />
      ))}
    </>
  );
}

function ZoneFrame({ zone, underwater }: { zone: PortWorldZone; underwater: boolean }) {
  const { min, max } = zone.box_enu_m;
  const height =
    zone.kind === "land" ? min[2] + 0.4 : zone.kind === "water" ? min[2] + 0.5 : Math.max(min[2], 14);
  const cornerEnu: Array<[number, number]> = [
    [min[0], min[1]],
    [max[0], min[1]],
    [max[0], max[1]],
    [min[0], max[1]],
  ];
  const points = cornerEnu.map(([e, n]) => enuToScene([e, n, height]));
  const loop = [...points, points[0]!];
  const color = zone.flags?.damaged
    ? underwater
      ? "#ff9d8a"
      : "#b65b41"
    : zone.kind === "water"
      ? underwater
        ? "#3fc4b4"
        : "#0f4c47"
      : "#3e6b70";
  return (
    <>
      <Line points={loop} color={color} lineWidth={1.2} transparent opacity={underwater ? 0.85 : 0.6} />
      <Html position={points[0] as unknown as [number, number, number]} zIndexRange={[30, 10]} pointerEvents="none">
        <div className="whitespace-nowrap rounded-sm bg-background/75 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-muted-foreground -translate-y-3">
          {zone.id}
          {zone.flags?.task_target ? " · task target" : ""}
          {zone.flags?.damaged ? " · damaged" : ""}
        </div>
      </Html>
    </>
  );
}

function CameraRig({
  pose,
  reducedMotion,
  controlsRef,
  followTarget,
}: {
  pose: CameraPose;
  reducedMotion: boolean;
  controlsRef: React.RefObject<ControlsLike | null>;
  followTarget: SceneVec3 | null;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const desired = useRef({ position: new THREE.Vector3(), target: new THREE.Vector3() });
  const lastFollow = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    desired.current.position.set(pose.position[0], pose.position[1], pose.position[2]);
    desired.current.target.set(pose.target[0], pose.target[1], pose.target[2]);
    camera.near = pose.near_m;
    camera.far = pose.far_m;
    camera.updateProjectionMatrix();
    const controls = controlsRef.current;
    if (controls) {
      controls.minDistance = pose.min_distance_m;
      controls.maxDistance = pose.max_distance_m;
    }
    if (reducedMotion) {
      camera.position.copy(desired.current.position);
      if (controls) {
        controls.target.copy(desired.current.target);
        controls.update();
      }
    }
    // Reset follow tracking baseline so entering FOLLOW does not jump.
    lastFollow.current = followTarget ? new THREE.Vector3(followTarget[0], followTarget[1], followTarget[2]) : null;
  }, [pose, camera, reducedMotion, controlsRef, followTarget]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    // FOLLOW: translate camera AND orbit target by the machine's observed
    // delta so the operator keeps the same viewing angle while it moves.
    // The static pose lerp is skipped while following — the desired pose is
    // otherwise stale and would drag the view back to the entry framing.
    if (followTarget && controls) {
      const now = new THREE.Vector3(followTarget[0], followTarget[1], followTarget[2]);
      if (lastFollow.current === null) lastFollow.current = now.clone();
      const d = now.clone().sub(lastFollow.current);
      camera.position.add(d);
      controls.target.add(d);
      lastFollow.current.copy(now);
      controls.update();
      return;
    }
    if (reducedMotion) return;
    const alpha = 1 - Math.exp(-3.2 * Math.min(delta, 0.1));
    camera.position.lerp(desired.current.position, alpha);
    if (controls) {
      controls.target.lerp(desired.current.target, alpha);
      controls.update();
    }
  });
  return null;
}

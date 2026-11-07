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
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { sunDirection, type CameraPose, type ViewMode } from "./camera-presets";
import { enuToScene } from "./enu";
import { MACHINES, type MachineSpec } from "./machines";
import { anchorById, zoneById, type PortWorld, type PortWorldZone } from "./world-data";

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
  mode: ViewMode;
  inspectIndex: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  pose: CameraPose | null;
  reducedMotion: boolean;
  lowGpu: boolean;
  onContextLost: () => void;
  onContextRestored: () => void;
}

export function PortScene(props: PortSceneProps) {
  const { world, pose, lowGpu, reducedMotion } = props;
  const sun = sunDirection(world);
  const controlsRef = useRef<ControlsLike | null>(null);
  if (!pose) return null;
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
      <SceneEnvironment underwater={pose.underwater} />
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
          />
        ))}
        <ZoneFrames world={world} />
      </Suspense>
      <CameraRig pose={pose} reducedMotion={reducedMotion} controlsRef={controlsRef} />
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
    scene.fog = underwater ? new THREE.Fog(UW_SKY, 4, 110) : new THREE.Fog(DAY_SKY, 500, 1100);
  }, [scene, underwater]);
  return null;
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
}: {
  world: PortWorld;
  machine: MachineSpec;
  selected: boolean;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
}) {
  const source = useGLTF(machine.file).scene;
  const model = useMemo(() => source.clone(true), [source]);
  const anchor = anchorById(world, machine.anchorId);
  if (!anchor) return null;
  const position = enuToScene(anchor.position_enu_m);
  return (
    <group position={position as unknown as [number, number, number]}>
      <group rotation-y={(machine.yawDeg * Math.PI) / 180}>
        <primitive
          object={model}
          onClick={(event: { stopPropagation: () => void }) => {
            event.stopPropagation();
            onSelect(machine.id);
          }}
        />
      </group>
      <SelectionRing selected={selected} reducedMotion={reducedMotion} />
      <Html position={[0, 1.15, 0]} center zIndexRange={[30, 10]} pointerEvents="none">
        <div
          className={`whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-tight backdrop-blur-sm ${
            selected
              ? "border-primary bg-card text-foreground"
              : "border-border bg-background/75 text-muted-foreground"
          }`}
        >
          {machine.label}
          {selected ? " · selected" : ""}
        </div>
      </Html>
    </group>
  );
}

function SelectionRing({ selected, reducedMotion }: { selected: boolean; reducedMotion: boolean }) {
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
        color={selected ? "#de9c7c" : "#536d6c"}
        transparent
        opacity={selected ? 0.95 : 0.35}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

const FRAMED_ZONES = ["aerial_survey", "underwater_inspection", "obstruction_zone", "pier_c_deck"];

function ZoneFrames({ world }: { world: PortWorld }) {
  const zones = FRAMED_ZONES.map((id) => zoneById(world, id)).filter(
    (z): z is PortWorldZone => Boolean(z),
  );
  return (
    <>
      {zones.map((zone) => (
        <ZoneFrame key={zone.id} zone={zone} />
      ))}
    </>
  );
}

function ZoneFrame({ zone }: { zone: PortWorldZone }) {
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
  const color = zone.flags?.damaged ? "#b65b41" : zone.kind === "water" ? "#0f4c47" : "#3e6b70";
  return (
    <>
      <Line points={loop} color={color} lineWidth={1.2} transparent opacity={0.6} />
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
}: {
  pose: CameraPose;
  reducedMotion: boolean;
  controlsRef: React.RefObject<ControlsLike | null>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const desired = useRef({ position: new THREE.Vector3(), target: new THREE.Vector3() });

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
  }, [pose, camera, reducedMotion, controlsRef]);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    const controls = controlsRef.current;
    const alpha = 1 - Math.exp(-3.2 * Math.min(delta, 0.1));
    camera.position.lerp(desired.current.position, alpha);
    if (controls) {
      controls.target.lerp(desired.current.target, alpha);
      controls.update();
    }
  });
  return null;
}

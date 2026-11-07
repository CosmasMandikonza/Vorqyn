"use client";

/**
 * Inspector for the world preview. Shows ONLY real metadata: world.json
 * frame facts, the current camera derivation, selected machine anchor data,
 * and — when a synthetic survey session is active — the kernel's actual
 * measurements for the selected robot (quality, coverage, staleness, fault
 * factor), labelled SYNTHETIC_SIM. No evidence verdicts or money states.
 */
import { inspectTargets, type CameraPose, type ViewMode } from "./camera-presets";
import { MACHINES } from "./machines";
import { SOURCE_LABEL } from "./labels";
import { anchorById, type PortWorld } from "./world-data";
import type { DemoRobotView } from "./demo-sim/contract";

export interface InspectorPanelProps {
  world: PortWorld;
  pose: CameraPose | null;
  mode: ViewMode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  inspectIndex: number;
  onCycleInspect?: () => void;
  limitations: string;
  compact?: boolean;
  /** Kernel-observed view of the selected machine (null before a session). */
  sensorRobot?: DemoRobotView | null;
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 border-b border-border py-1.5 last:border-b-0">
      <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{term}</dt>
      <dd className="text-right font-mono text-[11px] text-foreground">{children}</dd>
    </div>
  );
}

function SensorRow({ sensor }: { sensor: DemoRobotView["sensors"][number] }) {
  const measured = sensor.measured;
  return (
    <div className="border-b border-border py-1.5 last:border-b-0">
      <div className="flex flex-wrap justify-between gap-x-3">
        <span className="font-mono text-[10px] uppercase text-muted-foreground">{sensor.sensorId}</span>
        <span className="font-mono text-[11px]">
          {measured ? (
            <>
              q {measured.quality01.toFixed(3)}
              {measured.opticalVisibilityFactorApplied !== null && (
                <span className="text-danger"> ×{measured.opticalVisibilityFactorApplied}</span>
              )}
            </>
          ) : (
            <span className="text-warning">no measurement (paused/disconnected)</span>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex justify-between gap-x-3">
        <span className="font-mono text-[10px] text-muted-foreground">coverage</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {sensor.coverage.modelCellsVisited}/{sensor.coverage.modelCellsTotal} cells ·{" "}
          {(sensor.coverage.coverage01 * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export function InspectorPanel({
  world,
  pose,
  mode,
  selectedId,
  onSelect,
  inspectIndex,
  onCycleInspect,
  limitations,
  sensorRobot = null,
  compact = false,
}: InspectorPanelProps) {
  const machine = MACHINES.find((m) => m.id === selectedId) ?? null;
  const anchor = machine ? anchorById(world, machine.anchorId) : null;
  const refModel = machine ? world.vehicle_reference_models[machine.id] : null;
  const targets = inspectTargets(world);
  const sun = world.environment.sun;

  return (
    <div
      className={`rounded-md border border-border bg-card/95 backdrop-blur-sm ${compact ? "p-4" : "p-4"}`}
      data-testid="inspector-panel"
    >
      <p className="eyebrow text-muted-foreground">World inspector</p>
      <h2 className="mt-1 font-display text-lg leading-tight">
        {world.world_id} <span className="text-muted-foreground">· Kerameion Basin</span>
      </h2>

      <dl className="mt-3">
        <Fact term="Frame">{world.frame.type} · {world.frame.units}</Fact>
        <Fact term="Waterline">z = {world.waterline_z_m} m (scene y = 0)</Fact>
        <Fact term="Sun">{sun.azimuth_deg}° az / {sun.elevation_deg}° el · fixed</Fact>
        <Fact term="View">{mode}</Fact>
        {pose && <Fact term="Pose source">{pose.derivation}</Fact>}
        {machine && (
          <>
            <Fact term="Anchor">{machine.anchorId}</Fact>
            {sensorRobot ? (
              <>
                <Fact term="Role">
                  {sensorRobot.role} · {sensorRobot.fresh ? "fresh sample" : `stale (${sensorRobot.staleness})`}
                </Fact>
                <Fact term="Pose ENU m">
                  ({sensorRobot.pose.x}, {sensorRobot.pose.y}, {sensorRobot.pose.z})
                </Fact>
                <Fact term="Link">{sensorRobot.linkState}</Fact>
                <Fact term="Sim speed">{sensorRobot.speedMps} m/s</Fact>
              </>
            ) : (
              <Fact term="Role">{machine.role} · static</Fact>
            )}
            {anchor && !sensorRobot && (
              <Fact term="ENU m">
                ({anchor.position_enu_m[0]}, {anchor.position_enu_m[1]}, {anchor.position_enu_m[2]})
              </Fact>
            )}
            {refModel && (
              <Fact term="Model dims m">
                {refModel.nominal_dims_enu_m.x} × {refModel.nominal_dims_enu_m.y} ×{" "}
                {refModel.nominal_dims_enu_m.z}
              </Fact>
            )}
            <Fact term="Source">{sensorRobot ? "SYNTHETIC_SIM · kernel observation" : SOURCE_LABEL}</Fact>
          </>
        )}
        {!machine && <Fact term="Selection">none — select a machine</Fact>}
      </dl>

      {sensorRobot && (
        <div className="mt-4">
          <p className="eyebrow text-muted-foreground">
            Kernel measurements · sim t {sensorRobot.staleSinceSimMs !== null ? `≥ ${sensorRobot.staleSinceSimMs}` : "n/a"} ms
          </p>
          <div className="mt-2">
            {sensorRobot.sensors.map((sensor) => (
              <SensorRow key={sensor.sensorId} sensor={sensor} />
            ))}
          </div>
          {sensorRobot.activeOpticalFault && (
            <p className="mt-2 border-l-2 border-danger pl-3 font-mono text-[11px] text-danger">
              Active optical-visibility fault: {sensorRobot.activeOpticalFault.severity} ·{" "}
              {sensorRobot.activeOpticalFault.faultId} · expires sim t {sensorRobot.activeOpticalFault.expiresAtSimMs} ms
            </p>
          )}
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Fixture-model measurements only (unitless 0..1). These are NOT evidence
            verdicts — evaluation belongs to a future external policy evaluator.
          </p>
        </div>
      )}

      <div className="mt-4" role="group" aria-label="Select machine">
        <p className="eyebrow text-muted-foreground">Machines</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {MACHINES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={selectedId === m.id}
              className={`rounded-sm border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                selectedId === m.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-transparent text-foreground hover:bg-muted"
              }`}
              onClick={() => onSelect(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === "INSPECT" && targets.length > 0 && onCycleInspect && (
        <div className="mt-4">
          <p className="eyebrow text-muted-foreground">Inspect targets</p>
          <ol className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
            {targets.map((t, index) => (
              <li key={t.anchorId} className={index === inspectIndex % targets.length ? "text-foreground" : ""}>
                {index === inspectIndex % targets.length ? "▸ " : "· "}
                {t.anchorId} — d {t.distance_m} m
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="button button-quiet mt-2 !min-h-9 !py-1.5 text-xs"
            onClick={onCycleInspect}
          >
            Cycle target
          </button>
        </div>
      )}

      <p className="mt-4 border-l-2 border-warning pl-3 text-xs leading-relaxed text-muted-foreground">
        {limitations}
      </p>
    </div>
  );
}

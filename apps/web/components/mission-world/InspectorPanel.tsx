"use client";

/**
 * Inspector for the world preview. Shows ONLY actual world.json metadata:
 * frame facts, the current camera derivation, selected machine anchor data
 * and the honest limitations statement. No telemetry, scores or statuses.
 */
import { inspectTargets, type CameraPose, type ViewMode } from "./camera-presets";
import { MACHINES } from "./machines";
import { SOURCE_LABEL } from "./labels";
import { anchorById, type PortWorld } from "./world-data";

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
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 border-b border-border py-1.5 last:border-b-0">
      <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{term}</dt>
      <dd className="text-right font-mono text-[11px] text-foreground">{children}</dd>
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
            <Fact term="Role">{machine.role} · static</Fact>
            {anchor && (
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
            <Fact term="Source">{SOURCE_LABEL}</Fact>
          </>
        )}
        {!machine && <Fact term="Selection">none — select a machine</Fact>}
      </dl>

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

"use client";

/**
 * Accessible 2D fallback for the world preview: real zone list, machine
 * selection, camera-station text and — during a synthetic survey — the
 * kernel's observed robot state as text. No black screen, no lost
 * orientation, no invented activity.
 */
import { VIEW_MODES, type ViewMode } from "./camera-presets";
import { MACHINES } from "./machines";
import { SOURCE_LABEL } from "./labels";
import { anchorById, type PortWorld } from "./world-data";
import type { DemoRobotView } from "./demo-sim/contract";

export function Fallback2D({
  world,
  selectedId,
  onSelect,
  mode,
  reason,
  liveRobots = null,
  kernelState = null,
  simulatorTimeMs = null,
  sequence = null,
}: {
  world: PortWorld;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mode: ViewMode;
  reason: string;
  liveRobots?: DemoRobotView[] | null;
  kernelState?: string | null;
  simulatorTimeMs?: number | null;
  sequence?: number | null;
}) {
  const machine = MACHINES.find((m) => m.id === selectedId) ?? null;
  const anchor = machine ? anchorById(world, machine.anchorId) : null;

  return (
    <div data-testid="fallback-2d">
      <div className="notice" role="status">
        <strong>2D fallback.</strong> {reason} Everything below is read from the
        same world.json and kernel observations the 3D view uses — orientation,
        machine state and source labels stay accurate.
      </div>

      {liveRobots && liveRobots.length > 0 && (
        <section aria-label="Observed robot state" className="notice mt-4 bg-card" data-testid="fallback-robots">
          <p className="eyebrow text-muted-foreground">
            Observed robots · SYNTHETIC_SIM · sim t {simulatorTimeMs} ms · seq {sequence} · kernel {kernelState}
          </p>
          <ul className="mt-2 space-y-1.5">
            {liveRobots.map((robot) => {
              const optical = robot.sensors.find((s) => s.kind === "optical");
              const sonar = robot.sensors.find((s) => s.kind === "sonar");
              return (
                <li key={robot.robotId} className="border-b border-border pb-1.5 font-mono text-[11px]">
                  <span className="text-foreground">{robot.robotId}</span>{" "}
                  <span className="text-muted-foreground">
                    pose ENU ({robot.pose.x}, {robot.pose.y}, {robot.pose.z}) m ·{" "}
                    {robot.fresh ? "fresh" : `stale (${robot.staleness})`} · {robot.linkState}
                    {robot.activeOpticalFault ? ` · FAULT ${robot.activeOpticalFault.severity}` : ""}
                    {optical?.measured ? ` · optical q ${optical.measured.quality01.toFixed(3)}` : " · optical —"}
                    {sonar?.measured ? ` · sonar q ${sonar.measured.quality01.toFixed(3)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <figure className="m-0">
          {/* Static SVG asset; next/image SVG handling would need next.config changes outside this workstream's allowed paths. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/port-world/plan-view.svg"
            alt="Generated top-down plan of PORT-001 Kerameion Basin: quay and piers, container yard, roads, warehouse row, water basin with dashed zone outlines and anchor markers, north up, 100 m scale bar."
            className="w-full rounded-md border border-border bg-[#f5f3ec]"
            width={1024}
            height={736}
          />
          <figcaption className="mt-2 font-mono text-[11px] text-muted-foreground">
            Generated plan view (previews/plan-view.svg from the asset pack) — zones
            dashed, anchors marked, storm damage on Pier C (east).
          </figcaption>
        </figure>

        <div>
          <div role="group" aria-label="Select machine" className="flex flex-wrap gap-2">
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

          <dl className="mt-4">
            {machine && anchor ? (
              <>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="font-mono text-[10px] text-muted-foreground uppercase">Selected</dt>
                  <dd className="font-mono text-[11px]">{machine.label}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="font-mono text-[10px] text-muted-foreground uppercase">Anchor</dt>
                  <dd className="font-mono text-[11px]">{machine.anchorId}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="font-mono text-[10px] text-muted-foreground uppercase">ENU m</dt>
                  <dd className="font-mono text-[11px]">
                    ({anchor.position_enu_m[0]}, {anchor.position_enu_m[1]}, {anchor.position_enu_m[2]})
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b border-border py-1.5">
                  <dt className="font-mono text-[10px] text-muted-foreground uppercase">Source</dt>
                  <dd className="font-mono text-[11px]">{SOURCE_LABEL}</dd>
                </div>
              </>
            ) : (
              <div className="py-1.5 font-mono text-[11px] text-muted-foreground">
                No machine selected.
              </div>
            )}
          </dl>

          <h3 className="mt-6 font-display text-base">Inspection regions</h3>
          <ul className="mt-2 space-y-1.5">
            {world.zones.map((zone) => (
              <li key={zone.id} className="border-b border-border pb-1.5 font-mono text-[11px]">
                <span className="text-foreground">{zone.label}</span>{" "}
                <span className="text-muted-foreground">
                  · {zone.kind}
                  {zone.flags?.damaged ? " · damaged" : ""}
                  {zone.flags?.task_target ? " · task target" : ""}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="mt-6 font-display text-base">Camera stations</h3>
          <ul className="mt-2 space-y-1.5">
            {VIEW_MODES.map((m) => {
              const ct = world.camera_targets[m];
              return (
                <li key={m} className={`font-mono text-[11px] ${m === mode ? "text-foreground" : "text-muted-foreground"}`}>
                  {m === mode ? "▸ " : "· "}
                  {m}
                  {ct?.distance_range_m ? ` — d ${ct.distance_range_m[0]}–${ct.distance_range_m[1]} m` : ct?.distance_m ? ` — d ${ct.distance_m} m` : ""}
                  {ct?.near_m !== undefined ? ` · near ${ct.near_m} m` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

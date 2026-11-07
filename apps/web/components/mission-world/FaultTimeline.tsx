"use client";

/**
 * Mission Fracture timeline (Issue #15, section B): measured optical vs
 * sonar quality sparklines built from ACTUAL kernel snapshots, with fault
 * markers. Clicking/tapping a segment jumps the observation head. This is
 * measurement display — it must never be worded as an evidence verdict.
 */
import type { FaultSeries } from "./fault-series";

export function FaultTimeline({
  series,
  viewIndex,
  onSelectIndex,
}: {
  series: FaultSeries;
  viewIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const n = series.simTimes.length;
  if (n < 2) return null;
  const tMin = series.simTimes[0]!;
  const tMax = series.simTimes[n - 1]!;
  const x = (index: number) => (index / (n - 1)) * 100;
  const y = (q: number) => 30 - q * 28 - 1;

  const polyline = (values: Array<number | null>) => {
    const segments: string[] = [];
    let current: string[] = [];
    for (const [i, q] of values.entries()) {
      if (q === null) {
        if (current.length > 1) segments.push(current.join(" "));
        current = [];
        continue;
      }
      current.push(`${x(i).toFixed(2)},${y(q).toFixed(2)}`);
    }
    if (current.length > 1) segments.push(current.join(" "));
    return segments;
  };

  return (
    <div className="mt-3" data-testid="fault-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow text-muted-foreground">
          Measured quality · SYNTHETIC_SIM fixture model · sim t {tMin}–{tMax} ms
        </p>
        <p className="font-mono text-[10px] leading-tight text-muted-foreground">
          <span className="text-[#b65b41]">━ optical</span>{" "}
          <span className="text-[#2f9e8f]">━ sonar</span>{" "}
          <span className="text-danger">┃ fault injected</span>
        </p>
      </div>
      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="mt-1 h-14 w-full rounded-sm border border-border-subtle bg-background/60"
        role="img"
        aria-label={`Measured optical and sonar quality over simulator time ${tMin} to ${tMax} milliseconds. The optical visibility fault was injected by the kernel; sonar remains independent. Use the timeline slider to inspect individual observations.`}
      >
        {/* fault markers */}
        {series.markers.map((marker) => (
          <line
            key={marker.faultId}
            x1={x(marker.index)}
            x2={x(marker.index)}
            y1={0}
            y2={30}
            stroke="#ae413d"
            strokeWidth={0.8}
            strokeDasharray="2 1.4"
          />
        ))}
        {/* sonar (independent) */}
        {polyline(series.sonar).map((seg, i) => (
          <polyline key={`sonar-${i}`} points={seg} fill="none" stroke="#2f9e8f" strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
        ))}
        {/* optical (fault-affected) */}
        {polyline(series.optical).map((seg, i) => (
          <polyline key={`optical-${i}`} points={seg} fill="none" stroke="#b65b41" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        ))}
        {/* observation head */}
        {viewIndex >= 0 && viewIndex < n && (
          <line x1={x(viewIndex)} x2={x(viewIndex)} y1={0} y2={30} stroke="currentColor" strokeWidth={0.7} className="text-foreground" vectorEffect="non-scaling-stroke" />
        )}
        {/* click targets: one rect per observation */}
        {series.simTimes.map((t, i) => (
          <rect
            key={t}
            x={x(i) - 100 / (2 * (n - 1))}
            y={0}
            width={100 / (n - 1)}
            height={30}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onClick={() => onSelectIndex(i)}
          >
            <title>{`Observation #${i + 1} — sim t ${t} ms`}</title>
          </rect>
        ))}
      </svg>
      <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Kernel measurements only — this panel never represents an evidence
        verdict. Sonar is modelled independently and is unaffected by the
        optical-visibility fault.
      </p>
    </div>
  );
}

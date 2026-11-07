import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PortViewerClient } from "@/components/mission-world/PortViewerClient";



export const metadata: Metadata = { title: "3D world preview" };

export default function MissionWorldPage() {
  return (
    <main id="main" tabIndex={-1} className="wrap">
      <section className="entry-heading" aria-labelledby="mission-title">
        <nav aria-label="Breadcrumb" className="breadcrumb">
          <Link href="/">Overview</Link>
          <span aria-hidden="true">/</span>
          <Link href="/demo">Guest demo preview</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">3D world preview</span>
        </nav>
        <Badge>World preview · Static vehicle anchors · No live mission telemetry</Badge>
        <div className="entry-title-row">
          <h1 id="mission-title">
            The port, in <br />
            one shared world.
          </h1>
          <p className="entry-description">
            The actual PORT-001 environment from the merged asset pack: a
            storm-damaged harbor with aerial survey regions, ground access
            routes and a submerged obstruction field — rendered at true scale
            with calibrated camera stations.
          </p>
        </div>
      </section>

      <section aria-label="Interactive 3D world preview">
        <PortViewerClient />
      </section>

      <details className="preview-details">
        <summary>What this preview is — and is not</summary>
        <p className="boundary-note">
          This is a static world preview built from the original PORT-001
          geometry and metadata (world.json). Machines sit at their declared
          anchor poses; they do not move. There is no mission engine, telemetry
          stream, evidence, AI recovery, wallet or blockchain activity on this
          page — those arrive with later integration issues. The scene&apos;s
          daylight is a fixed world parameter and does not follow the light or
          dark interface theme.
        </p>
        <a
          className="text-link"
          href="https://github.com/CosmasMandikonza/Vorqyn/issues/8"
        >
          Track the full mission world implementation{" "}
          <span aria-hidden="true" className="arrow-icon" />
        </a>
      </details>
    </main>
  );
}

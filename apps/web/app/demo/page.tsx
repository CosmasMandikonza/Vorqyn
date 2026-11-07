import type { Metadata } from 'next';
import Link from 'next/link';
import { PortConcept } from '@/components/port-concept';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Guest demo preview' };

export default function DemoPage() {
  return <main id="main" className="wrap">
    <section className="entry-heading" aria-labelledby="demo-title">
      <nav aria-label="Breadcrumb" className="breadcrumb"><Link href="/">Overview</Link><span aria-hidden="true">/</span><span aria-current="page">Guest demo preview</span></nav>
      <Badge>Prototype preview · Read-only</Badge>
      <div className="entry-title-row"><h1 id="demo-title">One mission.{" "}<br />Three environments.</h1><p className="entry-description">A storm has disrupted a port. The intended experience follows independent machines as they inspect access, encounter failed evidence and recover the work together.</p></div>
    </section>
    <section className="world-slot" aria-label="Mission world concept">
      <div className="preview-strip"><strong>PORT / POST-STORM INSPECTION</strong><span>No live telemetry, simulation or transactions in this preview.</span></div>
      <PortConcept compact />
    </section>
    <details className="preview-details" open>
      <summary>What you will be able to explore</summary>
      <ol className="scenario-steps">
        <li><span className="mono">01 / OBSERVE</span><h3>See the whole operation.</h3><p>Inspect aerial survey, ground access and submerged obstruction tasks in one shared world. Read each machine’s actual telemetry provenance.</p></li>
        <li><span className="mono">02 / UNDERSTAND</span><h3>Trace the failure.</h3><p>Inspect why underwater optical evidence is insufficient, then compare a sonar-capable replacement with an ineligible optical-only offer.</p></li>
        <li><span className="mono">03 / VERIFY</span><h3>Follow the handoff.</h3><p>Review the authorized assignment change, independent verifier decision and confirmed Solana devnet settlement when those systems are integrated.</p></li>
      </ol>
      <p className="boundary-note">This is a scenario introduction, not a playable mission or a recorded run. The illustration does not require WebGL. No fault trigger, wallet approval or settlement action is available yet.</p>
      <a className="text-link" href="https://github.com/CosmasMandikonza/Vorqyn/issues/8">Track the 3D mission-world implementation <span aria-hidden="true" className="arrow-icon" /></a>
    </details>
    <section className="route-bottom" aria-labelledby="demo-next"><div><h2 id="demo-next">Your operation, next.</h2><p>See how a company mission will take shape.</p></div><Button asChild variant="secondary"><Link href="/workspace">Create Workspace <span aria-hidden="true" className="arrow-icon" /></Link></Button></section>
  </main>;
}

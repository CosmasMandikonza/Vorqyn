import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CutoutCard } from "@/components/ui/cutout-card";

export const metadata: Metadata = { title: "Mission workspace" };
const structure = [
  [
    "Objective & template",
    "Define the inspection objective and select a supported environment.",
  ],
  [
    "Environment & zones",
    "Choose a scenario variant and the areas to inspect.",
  ],
  [
    "Machines & operators",
    "Specify air, land and underwater capabilities and eligible operators.",
  ],
  [
    "Evidence & budget",
    "Set acceptance criteria, reward limits and who can authorize changes.",
  ],
  [
    "Review & authorize",
    "Review the persisted draft before wallet approval and funding.",
  ],
];

export default function WorkspacePage() {
  return (
    <main id="main" tabIndex={-1} className="wrap">
      <div className="workspace-layout">
        <aside className="workspace-rail" aria-label="Workspace sections">
          <p className="eyebrow">Company entry</p>
          <ul>
            <li>
              <a href="#missions" aria-current="page">
                Missions
              </a>
            </li>
            <li>
              <a href="#templates">Template preview</a>
            </li>
          </ul>
          <p className="rail-note">
            A place for the work.
            <br />
            Built around the world.
          </p>
        </aside>
        <div className="workspace-content">
          <section className="entry-heading" aria-labelledby="workspace-title">
            <Badge>Mission planning · Browser local</Badge>
            <div className="entry-title-row">
              <h1 id="workspace-title">
                Make room for
                <br />
                the mission.
              </h1>
              <p className="entry-description">
                Plan a port inspection mission in five guided steps, save
                drafts in this browser, and explore the live synthetic demo.
              </p>
            </div>
          </section>
          <section id="missions" aria-labelledby="missions-title">
            <div className="workspace-context">
              <h2 id="missions-title" className="eyebrow">
                Missions
              </h2>
              <span>No company account connected · Local drafts available</span>
            </div>
            <div className="empty-state">
              <svg
                className="empty-symbol"
                aria-hidden="true"
                width="112"
                height="92"
                viewBox="0 0 112 92"
                fill="none"
              >
                <path d="m8 48 48-27 48 27-48 27Z" stroke="currentColor" />
                <path
                  d="m8 60 48 27 48-27M56 21V1M48 9h16M56 41v20M46 51h20"
                  stroke="currentColor"
                />
                <path
                  d="m32 35 24 14 24-14"
                  stroke="currentColor"
                  strokeDasharray="3 4"
                />
              </svg>
              <h2>Plan your first mission.</h2>
              <p>
                The five-step mission builder is available now. Choose an inspection
                objective, zones, machine capabilities, evidence criteria and
                budget. Save and reopen your plan in this browser.
              </p>
              <Button asChild>
                <Link href="/workspace/create">Open mission builder</Link>
              </Button>
              <p>Browser-local planning only · No company account, funding or mission launch.</p>
              <Button asChild variant="secondary">
                <a href="#templates">
                  View mission template{" "}
                  <span aria-hidden="true" className="arrow-icon arrow-down" />
                </a>
              </Button>
            </div>
          </section>
          <section id="templates" aria-labelledby="templates-title">
            <div className="template-heading">
              <h2 id="templates-title">A starting point for the work.</h2>
              <Badge>Template preview</Badge>
            </div>
            <CutoutCard
              label="Five-step builder available"
              className="template-card"
            >
              <p className="eyebrow">Air / Land / Underwater</p>
              <h3>Post-storm port inspection</h3>
              <p>
                Start from the PORT-001 world and create your own local inspection
                brief with configurable zones, capabilities, evidence criteria
                and a proposed budget. The builder is working; actual company
                missions and wallet funding are not connected.
              </p>
              <details className="builder-outline">
                <summary>Preview mission structure</summary>
                <ol>
                  {structure.map(([title, text]) => (
                    <li key={title}>
                      <strong>{title}</strong>
                      <span>{text}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </CutoutCard>
            <p className="notice">
              The template is a preview; the linked builder saves real local drafts
              in this browser. No organization, funded mission or wallet is connected.
            </p>
            <Link className="text-link" href="/workspace/create">
              Open the working mission builder{" "}
              <span aria-hidden="true" className="arrow-icon" />
            </Link>
          </section>
        </div>
      </div>
      <section className="route-bottom" aria-labelledby="workspace-next">
        <div>
          <h2 id="workspace-next">Start with the port story.</h2>
          <p>Explore the intended mission experience, without an account.</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/demo">
            Explore Demo <span aria-hidden="true" className="arrow-icon" />
          </Link>
        </Button>
      </section>
    </main>
  );
}

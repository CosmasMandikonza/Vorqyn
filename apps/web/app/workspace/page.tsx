import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CutoutCard } from "@/components/ui/cutout-card";

export const metadata: Metadata = { title: "Workspace preview" };
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
            <Badge>Workspace shell · Preview</Badge>
            <div className="entry-title-row">
              <h1 id="workspace-title">
                Make room for
                <br />
                the mission.
              </h1>
              <p className="entry-description">
                A future home for your organization’s inspection work, from
                mission brief to accepted evidence.
              </p>
            </div>
          </section>
          <section id="missions" aria-labelledby="missions-title">
            <div className="workspace-context">
              <h2 id="missions-title" className="eyebrow">
                Missions
              </h2>
              <span>No organization connected · No stored missions</span>
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
              <h2>Your first mission starts here.</h2>
              <p>
                No organization or mission has been created. Account setup and
                mission creation will arrive with the mission builder. For now,
                inspect the planned structure.
              </p>
              <Button asChild>
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
              label="Builder not yet available"
              className="template-card"
            >
              <p className="eyebrow">Air / Land / Underwater</p>
              <h3>Post-storm port inspection</h3>
              <p>
                A proposed template for coordinating aerial survey, dock access
                and underwater obstruction mapping. The future builder will let
                a company configure its own mission, rather than replay a fixed
                demo.
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
              Preview only. Nothing entered or stored here; no account,
              organization, mission, budget or wallet is connected.
            </p>
            <a
              className="text-link"
              href="https://github.com/CosmasMandikonza/Vorqyn/issues/4"
            >
              Follow mission-builder progress{" "}
              <span aria-hidden="true" className="arrow-icon" />
            </a>
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

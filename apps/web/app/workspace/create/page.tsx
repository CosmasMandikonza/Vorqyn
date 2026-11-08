import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MissionBuilder } from "@/components/mission-builder/mission-builder";
import styles from "@/components/mission-builder/builder.module.css";

export const metadata: Metadata = { title: "Local mission drafts" };
export default function CreateMissionPage() {
  return (
    <main id="main" tabIndex={-1} className={`wrap ${styles.page}`}>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Local mission drafts</span>
      </nav>
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">Mission planning / Browser local</p>
          <h1>
            Give the work
            <br />a clear brief.
          </h1>
        </div>
        <p>
          Define where machines are needed, what evidence should count and a
          proposed budget. Keep separate, editable plans for the work ahead.
        </p>
      </header>
      <div className={styles.boundary}>
        <strong>
          Local Mission Draft · Saved in This Browser · Not Funded or Launched
        </strong>
        <p>
          No account, organization or wallet is connected. Drafts are
          unencrypted and are not shared across browsers. Use fictional planning
          names; do not enter customer information, credentials or private keys.
        </p>
      </div>
      <div className={styles.boundary}>
        <p>
          Ready to see the robots move? Open the working PORT-001 synthetic
          mission. It runs the reference harbor scenario, not this local
          draft, and does not create an organization or authorize funding.
        </p>
        <Button asChild variant="secondary">
          <Link href="/demo/mission">Explore live harbor simulation</Link>
        </Button>
      </div>
      <MissionBuilder />
      <noscript>
        <p className="notice">
          JavaScript is needed to edit and save browser-local drafts. No account
          or mission has been created.
        </p>
      </noscript>
    </main>
  );
}

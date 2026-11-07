import Link from "next/link";
import { PortConcept } from "@/components/port-concept";
import { SplitText } from "@/components/split-text";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const story = [
  {
    number: "01",
    title: "Coordinate across the waterline.",
    text: "Give aerial, ground and underwater operators a shared objective. Different capabilities. One inspectable mission.",
    note: "COLLABORATION / AIR + LAND + SEA",
  },
  {
    number: "02",
    title: "A failed sensor isn’t a finished job.",
    text: "After a storm, poor visibility can make an optical survey unusable. Keep the failed evidence visible. Don’t call the work complete.",
    note: "EVIDENCE / REJECT WITH A REASON",
  },
  {
    number: "03",
    title: "Recover the work. Preserve the rules.",
    text: "An AI coordinator proposes a sonar-capable replacement. Deterministic capability and budget checks gate the proposal; an authorized signer approves the handoff.",
    note: "RECOVERY / CAPABILITY BEFORE COST",
  },
  {
    number: "04",
    title: "Settle the accepted outcome.",
    text: "Independent verification binds evidence to the current assignment. Solana is intended to enforce who can claim, how much and only once.",
    note: "SETTLEMENT / AUTHORITY ON SOLANA",
  },
];

export default function HomePage() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="hero wrap" aria-labelledby="hero-title">
        <div className="section-index">
          <p className="eyebrow">Coordination for physical autonomy</p>
          <span className="mono">BUILT AROUND THE OUTCOME ↘</span>
        </div>
        <div className="hero-grid">
          <h1 id="hero-title">
            <SplitText text="Autonomous work." /> <br />
            <span className="hero-second">
              <SplitText text="Accountable outcomes." />
            </span>
          </h1>
          <div className="hero-deck">
            <p>
              Many machines.
              <br />
              One shared responsibility.
            </p>
            <p>
              Coordinate independent fleets, inspect their evidence and recover
              unfinished work — with settlement designed around what was
              actually accepted.
            </p>
          </div>
        </div>
        <div className="hero-bottom">
          <div className="cta-row">
            <Button asChild>
              <Link href="/demo">
                Explore Demo <span aria-hidden="true" className="arrow-icon" />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/workspace">
                Create Workspace{" "}
                <span aria-hidden="true" className="arrow-icon" />
              </Link>
            </Button>
          </div>
          <p className="preview-note">
            <span className="tiny-cross" aria-hidden="true">
              +
            </span>{" "}
            Product preview. No account or wallet needed.
          </p>
        </div>
      </section>
      <div className="wrap">
        <PortConcept />
      </div>
      <section className="premise wrap" aria-labelledby="premise-title">
        <p className="eyebrow">The operating premise</p>
        <h2 id="premise-title">
          The mission doesn’t end
          <br />
          where one machine stops.
        </h2>
        <div className="premise-copy">
          <p>
            A port after a storm is one environment, but no single machine sees
            the whole picture.
          </p>
          <p>
            VORQYN is being built for inspection teams that need independent
            operators to work together — and a clear record of what happened
            when the plan changed.
          </p>
        </div>
      </section>
      <section
        id="approach"
        className="approach wrap"
        aria-labelledby="approach-title"
      >
        <div className="section-index">
          <p className="eyebrow">From coordination to accountability</p>
          <Badge>Intended product journey</Badge>
        </div>
        <h2 id="approach-title" className="section-title">
          Failure is part of the mission.
          <br />
          <span className="muted">Recovery should be, too.</span>
        </h2>
        <ol className="story-list">
          {story.map((step) => (
            <li key={step.number}>
              <span className="story-number mono">{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
              <span className="story-note mono">{step.note}</span>
            </li>
          ))}
        </ol>
      </section>
      <section
        className="settlement-section"
        aria-labelledby="settlement-title"
      >
        <div className="wrap settlement-grid">
          <div>
            <p className="eyebrow">Why Solana belongs here</p>
            <h2 id="settlement-title">
              Shared work.
              <br />
              Enforceable rights.
            </h2>
          </div>
          <div className="settlement-copy">
            <p className="large-copy">
              When operators are independent, payment authority needs more than
              an application’s promise.
            </p>
            <p>
              The planned program holds mission escrow, versions task
              assignments and limits claims to the authorized operator after
              verifier approval. A stale assignment must not collect. A retry
              must not pay twice.
            </p>
            <p className="technical-note">
              Solana enforces financial rules and authorization. It does not
              establish physical truth; evidence still needs independent
              verification.
            </p>
            <Badge>Integration planned · No transactions in this preview</Badge>
          </div>
        </div>
      </section>
      <section className="status-section wrap" aria-labelledby="status-title">
        <div>
          <p className="eyebrow">An honest starting point</p>
          <h2 id="status-title">
            The foundation.
            <br />
            With the next step in sight.
          </h2>
        </div>
        <div>
          <p>
            This release establishes the visual language, navigation and entry
            routes. The port is an original concept illustration. The 3D mission
            world, telemetry, AI recovery, organization accounts and Solana
            flows are future integrations.
          </p>
          <div className="cta-row">
            <Button asChild>
              <Link href="/demo">
                Explore Demo <span aria-hidden="true" className="arrow-icon" />
              </Link>
            </Button>
            <a
              className="text-link"
              href="https://github.com/CosmasMandikonza/Vorqyn/issues/3"
            >
              Follow the implementation{" "}
              <span aria-hidden="true" className="arrow-icon" />
            </a>
          </div>
        </div>
      </section>
      <section
        id="credits"
        className="credits wrap"
        aria-labelledby="credits-title"
      >
        <h2 id="credits-title" className="eyebrow">
          Sources & credits
        </h2>
        <p>
          Original port illustration and VORQYN composition. Space Grotesk, DM
          Sans and IBM Plex Mono: SIL Open Font License, locally bundled via
          Fontsource. Controls adapted from Cult UI and shadcn/ui (MIT); texture
          and text treatment informed by React Bits (MIT + Commons Clause).
          Skiper UI and Awwwards inspected for reference; no assets or
          components copied from them.
        </p>
        <a className="text-link" href="/third-party-notices.txt">
          Font & component license notices
        </a>
        <a
          className="text-link"
          href="https://github.com/CosmasMandikonza/Vorqyn/tree/feat/vq-02-experience/docs/evidence/vq-02"
        >
          Source inventory & verification evidence{" "}
          <span aria-hidden="true" className="arrow-icon" />
        </a>
      </section>
    </main>
  );
}

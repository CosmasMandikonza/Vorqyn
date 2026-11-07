import { CONTRACTS_STATUS } from "@vorqyn/contracts";

const notImplemented = [
  "Explore Demo and company mission workspace",
  "3D port world, vehicles and telemetry",
  "Evidence verification, failure and AI recovery",
  "Solana devnet escrow, reassignment and payout (VQ-04 onward)",
] as const;

/**
 * VQ-00 placeholder page. Deliberately unstyled beyond basic accessibility:
 * the branded light-led dual-theme shell is VQ-02 (#3), owned by Lane 2.
 * This page must stay honest — it states plainly that no product
 * functionality exists yet.
 */
export default function HomePage() {
  return (
    <>
      <header>
        <p className="wordmark">VORQYN</p>
        <p className="tagline">Autonomous work. Accountable outcomes.</p>
      </header>
      <main>
        <h1>Foundation scaffold — the prototype is not implemented</h1>
        <p>
          Status:{" "}
          <strong data-testid="page-status">
            Prototype — foundation only (VQ-00)
          </strong>
          . This page proves the monorepo, build pipeline and shared-contract
          package wiring. It is not a product.
        </p>
        <section aria-labelledby="contracts-heading">
          <h2 id="contracts-heading">Shared contracts package</h2>
          <p>
            <code>@vorqyn/contracts</code> reports status{" "}
            <code data-testid="contracts-status">{CONTRACTS_STATUS}</code>.
            The real mission/task/event contracts and deterministic reducer
            are frozen in VQ-01.
          </p>
        </section>
        <section aria-labelledby="missing-heading">
          <h2 id="missing-heading">Not implemented yet</h2>
          <ul>
            {notImplemented.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <p>
          The specification and the dependency-ordered issue backlog live in
          the repository README and <code>docs/</code>.
        </p>
      </main>
      <footer>
        <p>
          Solana × MLH Hackathon 2026 · devnet only · simulated systems are
          labeled as such.
        </p>
      </footer>
    </>
  );
}

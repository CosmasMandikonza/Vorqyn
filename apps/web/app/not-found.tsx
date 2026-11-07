import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="wrap">
      <section className="error-panel">
        <p className="eyebrow">404 / Route unavailable</p>
        <h1>This route is outside the map.</h1>
        <p>
          The preview includes the overview, guest demo and workspace entry.
        </p>
        <div className="cta-row">
          <Button asChild>
            <Link href="/">Return to overview</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/demo">Explore Demo</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

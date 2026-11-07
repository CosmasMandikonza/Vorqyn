"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" tabIndex={-1} className="wrap">
      <section className="error-panel" role="alert">
        <p className="eyebrow">Page could not load</p>
        <h1>Let’s try that view again.</h1>
        <p>An unexpected page error interrupted this preview.</p>
        <div className="cta-row">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="secondary">
            <Link href="/">Return to overview</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

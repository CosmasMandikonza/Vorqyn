import Link from "next/link";
import { MobileNavigation } from "./mobile-navigation";
import { ThemeSelector } from "./theme-selector";
import { Button } from "./ui/button";

export function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="VORQYN home">
      <svg aria-hidden="true" width="30" height="30" viewBox="0 0 32 32">
        <path d="M2 5h7l7 14L23 5h7L16 31Z" fill="currentColor" />
        <path
          d="m12 4 4 8 4-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
      VORQYN
      <span className="wordmark-dot" aria-hidden="true">
        +
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header wrap">
      <Wordmark />
      <nav className="desktop-nav" aria-label="Main navigation">
        <Link href="/#approach">The approach</Link>
        <Link href="/demo">Demo preview</Link>
      </nav>
      <div className="header-actions">
        <ThemeSelector />
        <Button asChild variant="secondary">
          <Link href="/workspace">
            Create Workspace <span aria-hidden="true" className="arrow-icon" />
          </Link>
        </Button>
      </div>
      <MobileNavigation />
    </header>
  );
}

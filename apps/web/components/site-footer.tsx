import Link from "next/link";
import { ThemeSelector } from "./theme-selector";
import { Wordmark } from "./site-header";

export function SiteFooter() {
  return <footer className="site-footer wrap">
    <div><Wordmark /><p>Physical autonomy.<br />Shared accountability.</p></div>
    <nav aria-label="Footer navigation"><Link href="/demo">Explore Demo</Link><Link href="/workspace">Create Workspace</Link><Link href="/#credits">Sources & credits</Link><a href="https://github.com/CosmasMandikonza/Vorqyn">Project repository <span aria-hidden="true" className="arrow-icon" /></a></nav>
    <div className="footer-meta"><ThemeSelector /><p>VQ-02 · Product-experience foundation<br />Solana × MLH Hackathon · 2026</p></div>
    <p className="footer-baseline">An early-stage prototype. No live fleet operations or on-chain settlement in this preview.</p>
  </footer>;
}

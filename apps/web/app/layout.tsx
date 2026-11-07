import type { Metadata } from "next";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/dm-sans";
import "@fontsource/ibm-plex-mono/latin-400.css";
import { ThemeProvider } from "@/components/theme-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VORQYN — Autonomous work. Accountable outcomes.", template: "%s — VORQYN" },
  description:
    "A product preview of shared missions for air, ground and underwater machines. Coordinate work, inspect evidence and understand accountable settlement.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><ThemeProvider><a className="skip-link" href="#main">Skip to content</a><SiteHeader />{children}<SiteFooter /></ThemeProvider></body>
    </html>
  );
}

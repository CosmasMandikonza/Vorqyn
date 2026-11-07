"use client";

// shadcn Sheet pattern using Radix Dialog's focus trap, Escape and restoration.
import * as Sheet from "@radix-ui/react-dialog";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeSelector } from "./theme-selector";
import { Button } from "./ui/button";

export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  return <Sheet.Root open={open} onOpenChange={setOpen}>
    <Sheet.Trigger asChild><Button variant="secondary" className="menu-trigger" aria-label="Open navigation"><span aria-hidden="true">☰</span> Menu</Button></Sheet.Trigger>
    <Sheet.Portal>
      <Sheet.Overlay className="sheet-overlay" />
      <Sheet.Content className="sheet-content">
        <div className="sheet-top"><Sheet.Title>Navigate VORQYN</Sheet.Title><Sheet.Close asChild><Button variant="quiet" aria-label="Close navigation">Close ×</Button></Sheet.Close></div>
        <Sheet.Description>Explore the product foundation and choose your next step.</Sheet.Description>
        <nav aria-label="Mobile navigation">
          {[ ["/", "Overview"], ["/#approach", "The approach"], ["/demo", "Explore Demo"], ["/workspace", "Create Workspace"] ].map(([href, label]) => <Sheet.Close asChild key={href}><Link href={href ?? "/"}>{label}<span aria-hidden="true" className="arrow-icon" /></Link></Sheet.Close>)}
        </nav>
        <div className="sheet-theme"><p className="eyebrow">Appearance</p><ThemeSelector /></div>
        <p className="sheet-note">Product preview · No live operations</p>
      </Sheet.Content>
    </Sheet.Portal>
  </Sheet.Root>;
}

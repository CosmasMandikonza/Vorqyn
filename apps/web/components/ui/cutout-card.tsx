// Static server-rendered adaptation of Cult UI Cutout Card (MIT).
// Retains the inset corner geometry; no hover-only actions or entrance hiding.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CutoutCard({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return <div className={cn("cutout-card", className)} data-slot="cutout-card">
    {children}
    <div className="cutout-label">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 200 200"><path d="M0 200C155.996 199.961 200.029 156.308 200 0V200H0Z" fill="currentColor" /></svg>
      <span>{label}</span>
    </div>
  </div>;
}

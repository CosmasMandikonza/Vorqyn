"use client";

/**
 * Client boundary for the viewer: next/dynamic with ssr:false is only
 * allowed inside Client Components, so the Server Component page renders
 * this wrapper. The loading shell is honest about what is being prepared.
 */
import dynamic from "next/dynamic";

const PortViewer = dynamic(
  () => import("./PortViewer").then((m) => m.PortViewer),
  {
    ssr: false,
    loading: () => (
      <div className="empty-state" aria-live="polite">
        <h2>Preparing the world preview…</h2>
        <p>Loading the PORT-001 viewer runtime and geometry.</p>
      </div>
    ),
  },
);

export function PortViewerClient() {
  return <PortViewer />;
}

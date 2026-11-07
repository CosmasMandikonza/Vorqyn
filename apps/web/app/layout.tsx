import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "VORQYN — Prototype",
  description:
    "VORQYN mission platform foundation scaffold (VQ-00). Product functionality is not implemented yet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

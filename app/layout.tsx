import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "BandageBoard — Wound-Care Billing",
  description: "Internal biller-facing wound-care billing triage",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

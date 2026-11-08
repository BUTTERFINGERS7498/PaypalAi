import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./landing.css";

export const metadata: Metadata = {
  title: "Sentry: receipts for AI agent payments",
  description: "Signed mandates, decision-time evidence and honest dispute responses for agentic payments (PayPal sandbox demo).",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

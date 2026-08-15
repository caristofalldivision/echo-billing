import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echo — Automated MikroTik hotspot & PPPoE billing",
  description:
    "Paste one script into a MikroTik and get a self-service hotspot: vouchers, M-Pesa, PPPoE renewals, and a live console — no manual follow-up.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

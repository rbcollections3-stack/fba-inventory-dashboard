import type { Metadata } from "next";
import { Figtree, Montserrat } from "next/font/google";
import "@astryxdesign/theme-stone/theme.css";
import "./globals.css";
import "./stone.css";

// The Astryx "Stone" theme's typefaces, served from this site (no requests to Google at runtime).
const body = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const heading = Montserrat({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-montserrat", display: "swap" });

export const metadata: Metadata = {
  title: "RB Collections FBA Dashboard",
  description: "Inventory and shipment planning for Amazon FBA",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-astryx-theme="stone" data-theme="light" className={`${body.variable} ${heading.variable}`}>
      <body>{children}</body>
    </html>
  );
}

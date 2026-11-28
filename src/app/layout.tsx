import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RB Collections FBA Dashboard",
  description: "Inventory and shipment planning for Amazon FBA",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

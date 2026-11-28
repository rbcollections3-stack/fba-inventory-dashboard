import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen shows live inventory data for a logged-in user, so pages
  // render on each request. Cache Components stays off to keep this simple.
  cacheComponents: false,
  serverExternalPackages: ["exceljs", "bcryptjs", "qrcode"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Browsers must only ever use HTTPS for this site.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Spreadsheet uploads go through a server action.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;

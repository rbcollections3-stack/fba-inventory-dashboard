import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen shows live inventory data for a logged-in user, so pages
  // render on each request. Cache Components stays off to keep this simple.
  cacheComponents: false,
  serverExternalPackages: ["exceljs", "bcryptjs"],
  experimental: {
    serverActions: {
      // Spreadsheet uploads go through a server action.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;

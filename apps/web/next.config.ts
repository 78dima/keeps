import type { NextConfig } from "next";
import androidRelease from "./src/lib/android-release.json";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@monokeep/ui"],
  async headers() {
    return [
      {
        source: `/downloads/${androidRelease.fileName}`,
        headers: [
          { key: "Content-Type", value: "application/vnd.android.package-archive" },
          { key: "Content-Disposition", value: `attachment; filename="${androidRelease.fileName}"` },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  // disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    importScripts: ["/custom-sw.js"],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
        handler: 'NetworkOnly',
        options: {
          cacheName: 'supabase-api-bypass',
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@monokeep/ui"],
};

export default withPWA(nextConfig);

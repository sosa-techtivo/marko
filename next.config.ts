import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allows the MarkoLogo component's cache-busting "?v=2" query string on
    // the branding asset (next/image's optimizer requires local query
    // strings to be explicitly allowlisted as of Next.js 16).
    localPatterns: [
      {
        pathname: "/branding/**",
        search: "?v=2",
      },
    ],
  },
};

export default nextConfig;

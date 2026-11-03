import type { NextConfig } from "next";

// NEXT_OUTPUT=export builds a static site for Cloudflare Workers Static Assets
// (see ../cloudflare). Default stays `standalone` for the Docker image.
const isStaticExport = process.env.NEXT_OUTPUT === 'export';

const nextConfig: NextConfig = isStaticExport
  ? {
      output: 'export',
      images: { unoptimized: true },
    }
  : {
      output: 'standalone',
      allowedDevOrigins: ["http://localhost:3000", "http://localhost:8000", "http://localhost:5173"],
      async rewrites() {
        return [
          {
            source: '/api/:path*',
            destination: 'http://127.0.0.1:8000/api/:path*',
          },
        ];
      },
    };

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://localhost:3000", "http://localhost:8000", "http://localhost:5173"],
};

export default nextConfig;

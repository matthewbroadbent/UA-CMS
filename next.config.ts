import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip type checking during build — saves ~900MB RAM (important on 2GB VPS)
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Prevent webpack from bundling native/binary packages — they must be loaded at runtime
  serverExternalPackages: [
    'fluent-ffmpeg',
    'ffmpeg-static',
    'ffprobe-static',
    'pg',
    '@prisma/adapter-pg',
  ],
};

export default nextConfig;

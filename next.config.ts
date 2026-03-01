import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

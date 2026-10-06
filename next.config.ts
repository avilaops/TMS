import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone para rodar em container no Hetzner (node server.js).
  output: "standalone",
};

export default nextConfig;

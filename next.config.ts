import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone para rodar em container no Hetzner (node server.js).
  output: "standalone",
  // Biblioteca de Node (criptografia e HTTPS do push): fica fora do pacote do
  // servidor e é carregada de node_modules, que o standalone copia junto.
  serverExternalPackages: ["web-push"],
};

export default nextConfig;

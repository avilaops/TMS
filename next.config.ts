import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone para rodar em container no Hetzner (node server.js).
  output: "standalone",
  // Bibliotecas de Node (criptografia e HTTPS do push; leitura do certificado
  // A1 e assinatura do CT-e): ficam fora do pacote do servidor e são carregadas
  // de node_modules, que o standalone copia junto.
  serverExternalPackages: ["web-push", "node-forge", "xml-crypto"],
};

export default nextConfig;

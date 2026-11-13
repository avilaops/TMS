import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone para rodar em container no Hetzner (node server.js).
  output: "standalone",
  // A CI valida inclusive .next/types em job posterior e bloqueia a imagem.
  // Builds normais continuam executando a verificacao interna do Next.
  typescript: {
    ignoreBuildErrors: process.env.GITHUB_ACTIONS === "true" && process.env.TMS_CI_SEPARATE_TYPECHECK === "1",
  },
  // Bibliotecas de Node (criptografia e HTTPS do push; leitura do certificado
  // A1 e assinatura do CT-e): ficam fora do pacote do servidor e são carregadas
  // de node_modules, que o standalone copia junto.
  serverExternalPackages: ["web-push", "node-forge", "xml-crypto"],
};

export default nextConfig;

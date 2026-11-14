import type { NextConfig } from "next";
import createMDX from '@next/mdx';

const nextConfig: NextConfig = {
  // Gera .next/standalone para rodar em container no Hetzner (node server.js).
  output: "standalone",
  outputFileTracingIncludes: { '/conteudo/[...slug]': ['./src/content/public/*.mdx'], '/og/[key]': ['./public/favicon-96x96.png'] },
  // A CI valida inclusive .next/types em job posterior e bloqueia a imagem.
  // Builds normais continuam executando a verificacao interna do Next.
  typescript: {
    ignoreBuildErrors: process.env.GITHUB_ACTIONS === "true" && process.env.TMS_CI_SEPARATE_TYPECHECK === "1",
  },
  // Bibliotecas de Node (criptografia e HTTPS do push; leitura do certificado
  // A1 e assinatura do CT-e): ficam fora do pacote do servidor e são carregadas
  // de node_modules, que o standalone copia junto.
  serverExternalPackages: ["web-push", "node-forge", "xml-crypto"],
  async headers() {
    return [
      {
        source: '/:area(dashboard|driver|portal|empresa|plataforma|login|rastreio|api)/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, nosnippet' }],
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'tms-9edy\\.onrender\\.com' }],
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default createMDX()(nextConfig);

import type { NextConfig } from "next";

/**
 * Redirecionamentos do site antigo (Redehost, PHP) para o site novo.
 *
 * As 16 URLs abaixo estavam no sitemap.xml publicado em
 * www.mellotransportesriopreto.com.br e ja estao indexadas. Quando o DNS do
 * dominio apontar para o nosso servidor, cada uma precisa cair na secao
 * equivalente da pagina nova, senao vira 404 e o ranking se perde.
 *
 * O www e redirecionado para o apex pelo Caddy, entao aqui so tratamos o path.
 */
const legacyRedirects = [
  { source: "/empresa", destination: "/#inicio" },
  
  { source: "/nossa-frota", destination: "/frota" },
  { source: "/cidades-atendidas", destination: "/cidades" },
  { source: "/faca-um-orcamento", destination: "/cotacao" },
  { source: "/contato", destination: "/coleta" },
  { source: "/entregas-express", destination: "/servicos" },
  // Paginas de servico do CMS antigo: /13/servico/motofrete e afins.
  { source: "/:id/servico/:slug", destination: "/servicos" },
  // Painel administrativo do CMS antigo, que deixa de existir na migracao.
  { source: "/painel", destination: "/login" },
  { source: "/painel/:path*", destination: "/login" },
];

const nextConfig: NextConfig = {
  // Gera .next/standalone para rodar em container no Hetzner (node server.js).
  output: "standalone",
  async redirects() {
    // 301 e nao 308: as URLs vem de um CMS de 2015 e de ferramentas de SEO
    // antigas, que lidam melhor com o codigo classico.
    return legacyRedirects.map((rule) => ({ ...rule, statusCode: 301 }));
  },
};

export default nextConfig;

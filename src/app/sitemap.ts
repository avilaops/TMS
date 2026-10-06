import type { MetadataRoute } from "next";
import { publicServices, publicFleet, publicHubs } from "@/data/publicCatalog";
import { sortedPosts } from "@/content/blog";

/**
 * Sitemap gerado pela aplicacao, para que materia nova entre sozinha.
 *
 * O canonico e o apex: o Caddy redireciona www para ca com 301.
 */
const SITE_URL = "https://mellotransportesriopreto.com.br";

export default function sitemap(): MetadataRoute.Sitemap {
  const fixedPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/cotacao`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/rastreio`, changeFrequency: "monthly", priority: 0.6 },
  ];

  const postPages: MetadataRoute.Sitemap = sortedPosts.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(`${post.publishedAt}T12:00:00Z`),
    changeFrequency: "yearly",
    priority: 0.7,
  }));

  const sections = ["servicos", "frota", "cidades", "mercadorias", "duvidas", "marca", "coleta"].map((path) => ({ url: `${SITE_URL}/${path}`, changeFrequency: "monthly" as const, priority: 0.7 }));
  const details = [ ...publicServices.map(({ slug }) => `servicos/${slug}`), ...publicFleet.map(({ slug }) => `frota/${slug}`), ...publicHubs.map(({ slug }) => `cidades/${slug}`) ].map((path) => ({ url: `${SITE_URL}/${path}`, changeFrequency: "monthly" as const, priority: 0.6 }));
  return [...fixedPages, ...sections, ...details, ...postPages];
}

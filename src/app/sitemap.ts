import type { MetadataRoute } from 'next';
import { publicSitemap, PUBLIC_ORIGIN } from '@/lib/public-site';
import { publishedSiteSitemap } from '@/lib/carrier-site-store';

export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sites = await publishedSiteSitemap();
  return [...publicSitemap(), ...sites.map(site => ({ url: `${PUBLIC_ORIGIN}${site.path}`, lastModified: site.lastModified }))];
}

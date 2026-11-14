import type { MetadataRoute } from 'next';
import { PUBLIC_ORIGIN } from '@/lib/public-site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*', allow: '/',
      disallow: ['/dashboard', '/driver', '/portal', '/empresa', '/plataforma', '/api/', '/login', '/rastreio'],
    },
    sitemap: `${PUBLIC_ORIGIN}/sitemap.xml`,
  };
}

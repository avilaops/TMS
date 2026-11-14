import type { Metadata } from 'next';
import { getPublicPage, publicUrl } from './public-site';

export function publicMetadata(path: string): Metadata {
  const page = getPublicPage(path);
  if (!page) throw new RangeError('Documento público desconhecido');
  const image = publicUrl(`/og/${page.imageKey}`);
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: publicUrl(page.path) },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
    openGraph: {
      type: page.kind === 'article' ? 'article' : 'website',
      siteName: 'TMS • Ávila Ops', locale: 'pt_BR', url: publicUrl(page.path),
      title: page.title, description: page.description,
      images: [{ url: image, width: 1200, height: 630, alt: page.title }],
    },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: [image] },
  };
}

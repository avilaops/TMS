import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PublicShell, PublicPageFrame } from '@/components/publico/PublicShell';
import { StructuredData } from '@/components/publico/StructuredData';
import { PostCards } from '@/components/publico/PostCards';
import { PUBLIC_POSTS, getPublicPost } from '@/content/public-posts';
import { publicMetadata } from '@/lib/public-seo';
import { PUBLIC_ORIGIN } from '@/lib/public-site';
import Mdfe from '@/content/public/o-que-e-mdfe.mdx';
import Cte from '@/content/public/o-que-e-cte.mdx';
import CteOs from '@/content/public/o-que-e-cte-os.mdx';
import Nfe from '@/content/public/o-que-e-nfe.mdx';

const content = { 'o-que-e-mdfe': Mdfe, 'o-que-e-cte': Cte, 'o-que-e-cte-os': CteOs, 'o-que-e-nfe': Nfe };
export function generateStaticParams() { return PUBLIC_POSTS.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!getPublicPost(slug)) notFound();
  return publicMetadata(`/blog/${slug}`);
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPublicPost(slug);
  if (!post) notFound();
  const Content = content[slug as keyof typeof content];
  const url = `${PUBLIC_ORIGIN}/blog/${slug}`;
  return <PublicShell><PublicPageFrame eyebrow="Universo Fiscal" title={post.title} description={post.summary}>
    <StructuredData data={{ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description: post.summary, mainEntityOfPage: url, image: `${PUBLIC_ORIGIN}/og/${post.label === 'CT-e OS' ? 'cte-os' : slug.replace('o-que-e-', '')}`, datePublished: post.publishedAt, dateModified: post.publishedAt, author: { '@type': 'Organization', name: 'Equipe Ávila Ops', url: 'https://avilaops.com/' }, publisher: { '@type': 'Organization', name: 'Ávila Ops', logo: { '@type': 'ImageObject', url: `${PUBLIC_ORIGIN}/web-app-manifest-512x512.png` } }, inLanguage: 'pt-BR' }} />
    <StructuredData data={{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Início', item: PUBLIC_ORIGIN }, { '@type': 'ListItem', position: 2, name: 'Universo Fiscal', item: `${PUBLIC_ORIGIN}/blog` }, { '@type': 'ListItem', position: 3, name: post.title, item: url }] }} />
    <p className="public-editorial-note">Equipe Ávila Ops • 14 de novembro de 2026 • {post.readingMinutes} min de leitura</p>
    <article className="public-prose"><Content /><aside>Conteúdo educativo. Confirme as regras vigentes e a aplicação à sua operação nas fontes oficiais e com sua assessoria fiscal.</aside></article>
    <section className="public-related"><h2>Continue no Universo Fiscal</h2><PostCards /></section>
  </PublicPageFrame></PublicShell>;
}

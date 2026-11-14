import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { carrierPath, sitePaths } from '@/lib/carrier-site';
import { getPublishedSite } from '@/lib/carrier-site-store';
import { PUBLIC_ORIGIN } from '@/lib/public-site';
import { StructuredData } from '@/components/publico/StructuredData';
import './carrier-public.css';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ empresa: string; pagina?: string[] }> };
async function resolve(props: Props) {
  const { empresa, pagina = [] } = await props.params;
  const site = await getPublishedSite(empresa);
  const path = pagina.length ? `/${pagina.join('/')}` : '';
  if (!site || !sitePaths(site.content).includes(path)) notFound();
  return { ...site, path, base: carrierPath(empresa) };
}
function pageTitle(path: string) { return ({ '/sobre': 'Sobre', '/servicos': 'Serviços', '/contato': 'Contato', '/blog': 'Blog' } as Record<string, string>)[path]; }

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { content, slug, path, base } = await resolve(props);
  const post = content.posts.find(post => path === `/blog/${post.slug}`);
  const title = [post?.title || pageTitle(path) || content.headline, content.name].filter(Boolean).join(' • ');
  const description = post?.summary || content.description || content.about.slice(0, 160);
  const url = `${PUBLIC_ORIGIN}${base}${path}`;
  return { title: { absolute: title }, description, alternates: { canonical: url }, robots: { index: true, follow: true }, icons: { icon: `${base}/icone` }, openGraph: { title, description, url, siteName: content.name, locale: 'pt_BR', type: post ? 'article' : 'website', images: [{ url: `${PUBLIC_ORIGIN}${carrierPath(slug)}/og`, width: 1200, height: 630 }] }, twitter: { card: 'summary_large_image', title, description, images: [`${PUBLIC_ORIGIN}${base}/og`] } };
}

export default async function Page(props: Props) {
  const { content: site, publishedAt, path, base } = await resolve(props);
  const post = site.posts.find(item => path === `/blog/${item.slug}`);
  const contacts = <div className="carrier-contacts">{site.whatsapp && <a className="carrier-button" href={`https://wa.me/${site.whatsapp}`} rel="noopener noreferrer">Conversar no WhatsApp ↗</a>}{site.email && <a href={`mailto:${site.email}`}>{site.email}</a>}{site.phone && <a href={`tel:${site.phone.replace(/[^+\d]/g, '')}`}>{site.phone}</a>}{site.address && <p>{site.address}</p>}</div>;
  const services = <div className="carrier-services">{site.services.map(service => <article key={service}><span aria-hidden="true">↗</span><h3>{service}</h3></article>)}</div>;
  const blog = <div className="carrier-blog">{site.posts.map(item => <Link key={item.slug} href={`${base}/blog/${item.slug}`}><small>Novidades</small><h3>{item.title}</h3><p>{item.summary}</p><span>Ler artigo →</span></Link>)}</div>;
  return <div className="carrier-public" style={{ '--carrier-accent': site.accent } as CSSProperties}>
    <StructuredData data={{ '@context': 'https://schema.org', '@type': 'Organization', name: site.name, url: `${PUBLIC_ORIGIN}${base}`, ...(site.email ? { email: site.email } : {}), ...(site.phone ? { telephone: site.phone } : {}) }} />
    {post && <StructuredData data={{ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description: post.summary, author: { '@type': 'Organization', name: site.name }, dateModified: publishedAt.toISOString(), mainEntityOfPage: `${PUBLIC_ORIGIN}${base}${path}`, image: `${PUBLIC_ORIGIN}${base}/og` }} />}
    <a className="carrier-skip" href="#conteudo">Ir para o conteúdo</a>
    <header className="carrier-header carrier-container"><Link className="carrier-brand" href={base}>{site.logo ? <Image src={site.logo} unoptimized width={48} height={48} alt="" /> : <span className="carrier-monogram" aria-hidden="true">{site.name.slice(0, 1)}</span>}<strong>{site.name}</strong></Link><nav aria-label="Navegação da transportadora"><Link href={`${base}/sobre`}>Sobre</Link><Link href={`${base}/servicos`}>Serviços</Link>{site.posts.length > 0 && <Link href={`${base}/blog`}>Blog</Link>}<Link href={`${base}/contato`}>Contato</Link><Link href="/login">Já sou cliente ↗</Link></nav></header>
    <main id="conteudo">
      {!path ? <>
        <section className="carrier-hero carrier-container"><div><span className="carrier-eyebrow">{site.name}</span><h1>{site.headline}</h1><p>{site.description}</p><div className="carrier-hero-actions"><Link className="carrier-button" href={`${base}/contato`}>Solicitar uma cotação ↗</Link><Link href="/rastreio">Acompanhar entrega →</Link></div></div><div className="carrier-hero-art" aria-hidden="true"><span>ORIGEM</span><div className="carrier-road"><i /><b /><i /></div><span>DESTINO</span><strong>Conectando caminhos.</strong></div></section>
        <section className="carrier-section carrier-container"><span className="carrier-eyebrow">O que fazemos</span><h2>Serviços de transporte</h2>{services}</section>
        <section className="carrier-about"><div className="carrier-container"><span className="carrier-eyebrow">Nossa empresa</span><h2>Conheça {site.name}</h2><p className="carrier-text">{site.about}</p></div></section>
        {!!site.regions.length && <section className="carrier-section carrier-container"><h2>Regiões atendidas</h2><div className="carrier-regions">{site.regions.map(region => <span key={region}>{region}</span>)}</div></section>}
        {!!site.posts.length && <section className="carrier-section carrier-container"><h2>Novidades da transportadora</h2>{blog}</section>}
        <section className="carrier-section carrier-container"><h2>Vamos conversar sobre sua carga?</h2>{contacts}</section>
      </> : <section className="carrier-section carrier-container carrier-inner"><Link href={base}>← Início</Link><h1>{post?.title || pageTitle(path)}</h1>
        {path === '/sobre' && <><p className="carrier-text">{site.about}</p>{!!site.regions.length && <><h2>Onde atuamos</h2><p>{site.regions.join(' • ')}</p></>}</>}
        {path === '/servicos' && <>{services}<Link className="carrier-button" href={`${base}/contato`}>Consultar atendimento ↗</Link></>}
        {path === '/contato' && <><p>Entre em contato com {site.name} para consultar disponibilidade, atendimento e condições.</p>{contacts}</>}
        {path === '/blog' && blog}
        {post && <article><p className="carrier-post-summary">{post.summary}</p><div className="carrier-text">{post.body}</div></article>}
      </section>}
    </main>
    <footer className="carrier-footer"><div className="carrier-container"><div><strong>{site.name}</strong><p>Conteúdo e atendimento sob responsabilidade da transportadora.</p></div><div><Link href={`${base}/contato`}>Contato</Link><Link href="/login">Área do cliente</Link><Link href="/rastreio">Rastrear entrega</Link><Link href="/">Site de cortesia • TMS Ávila Ops</Link></div></div></footer>
  </div>;
}

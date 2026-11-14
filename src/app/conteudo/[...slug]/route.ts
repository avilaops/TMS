import fs from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC_MDX_FILES } from '@/lib/public-mdx';
import { PUBLIC_ORIGIN } from '@/lib/public-site';
import { getPublishedSite } from '@/lib/carrier-site-store';
import { sitePaths } from '@/lib/carrier-site';
export const dynamic = 'force-dynamic';

function markdown(text: string) { return text.replace(/[<>{}]/g, char => ({ '<': '&lt;', '>': '&gt;', '{': '&#123;', '}': '&#125;' })[char]!); }

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const key = slug.join('/');
  let body: string; let canonical: string;
  if (Object.hasOwn(PUBLIC_MDX_FILES, key)) {
    body = await fs.readFile(path.join(process.cwd(), 'src/content/public', PUBLIC_MDX_FILES[key]), 'utf8');
    canonical = `${PUBLIC_ORIGIN}${key === 'inicio.mdx' ? '/' : '/' + key.replace(/\.mdx$/, '')}`;
  } else if (slug[0] === 'transportadoras' && slug.length >= 3) {
    const site = await getPublishedSite(slug[1]);
    const relative = '/' + slug.slice(2).join('/').replace(/\.mdx$/, '');
    const current = relative === '/inicio' ? '' : relative;
    if (!site || !key.endsWith('.mdx') || !sitePaths(site.content).includes(current)) return new Response('Não encontrado', { status: 404 });
    const data = site.content;
    const post = data.posts.find(item => current === `/blog/${item.slug}`);
    const texts = current === '' ? [data.headline, data.description, data.about, ...data.services, ...data.regions] : current === '/sobre' ? [data.name, data.about] : current === '/servicos' ? ['Serviços', ...data.services] : current === '/contato' ? ['Contato', data.email, data.phone, data.address] : post ? [post.title, post.summary, post.body] : ['Blog', ...data.posts.map(item => `${item.title}\n\n${item.summary}`)];
    body = texts.map(markdown).join('\n\n');
    canonical = `${PUBLIC_ORIGIN}/transportadoras/${site.slug}${current}`;
  } else return new Response('Não encontrado', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'X-Robots-Tag': 'noindex, follow', 'Link': `<${canonical}>; rel="canonical"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

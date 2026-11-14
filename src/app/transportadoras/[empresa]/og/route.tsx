/* eslint-disable @next/next/no-img-element -- ImageResponse uses Satori's img element. */
import { ImageResponse } from 'next/og';
import { getPublishedSite } from '@/lib/carrier-site-store';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const site = await getPublishedSite((await params).empresa);
  if (!site) return new Response('Não encontrado', { status: 404 });
  return new ImageResponse(<div style={{ display: 'flex', width: '100%', height: '100%', background: '#152b42', borderTop: `18px solid ${site.content.accent}`, color: '#fff', padding: 65, flexDirection: 'column', justifyContent: 'space-between' }}><div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>{site.content.logo && <img src={site.content.logo} alt="" width={80} height={80} style={{ objectFit: 'contain', background: '#fff', borderRadius: 12 }} />}<span style={{ fontSize: 34 }}>{site.content.name}</span></div><div style={{ display: 'flex', fontSize: 59, lineHeight: 1.12 }}>{site.content.headline}</div><div style={{ display: 'flex', fontSize: 25, color: '#c9d6e4' }}>{site.content.description.slice(0, 160)}</div></div>, { width: 1200, height: 630, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

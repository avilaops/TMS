/* eslint-disable @next/next/no-img-element -- ImageResponse uses Satori's img element. */
import { ImageResponse } from 'next/og';
import { getPublishedSite } from '@/lib/carrier-site-store';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const site = await getPublishedSite((await params).empresa);
  if (!site) return new Response('Não encontrado', { status: 404 });
  return new ImageResponse(<div style={{ display: 'flex', background: '#fff', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', border: `8px solid ${site.content.accent}`, borderRadius: 22 }}>{site.content.logo ? <img src={site.content.logo} width={92} height={92} alt="" style={{ objectFit: 'contain' }} /> : <span style={{ color: '#152b42', fontSize: 70 }}>{site.content.name[0]}</span>}</div>, { width: 128, height: 128, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

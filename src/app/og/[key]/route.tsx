/* eslint-disable @next/next/no-img-element -- ImageResponse uses Satori's img element. */
import { ImageResponse } from 'next/og';
import { PUBLIC_PAGES } from '@/lib/public-site';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const page = PUBLIC_PAGES.find(item => item.imageKey === key);
  if (!page) return new Response('Não encontrado', { status: 404 });
  const logo = `data:image/png;base64,${(await readFile(path.join(process.cwd(), 'public/favicon-96x96.png'))).toString('base64')}`;
  return new ImageResponse(<div style={{ display: 'flex', width: '100%', height: '100%', background: '#10243e', color: '#fff', padding: 70, flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'sans-serif' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}><img src={logo} width={64} height={64} alt="" /><div style={{ display: 'flex', fontSize: 27 }}>TMS • ÁVILA OPS</div></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 25 }}><div style={{ display: 'flex', color: '#8fbaff', fontSize: 23 }}>{page.kind === 'article' ? 'UNIVERSO FISCAL' : 'GESTÃO DE TRANSPORTES'}</div><div style={{ display: 'flex', fontSize: 62, lineHeight: 1.12, maxWidth: 1010 }}>{page.title.split(' • ')[0]}</div></div>
    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #35516f', paddingTop: 25, fontSize: 23 }}><span>Do pedido à entrega.</span><span>tms.avilaops.com</span></div>
  </div>, { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=86400' } });
}

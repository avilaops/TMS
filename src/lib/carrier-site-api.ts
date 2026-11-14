import { NextResponse } from 'next/server';
import { SiteConflict, InactiveSiteTenant } from './carrier-site-store';

export async function siteBody(request: Request) {
  // Bound the stream even when Content-Length is absent or false.
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 600000) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}
export function siteError(error: unknown) {
  if (error instanceof SiteConflict) return NextResponse.json({ error: 'O site mudou em outra sessão. Recarregue antes de salvar.', conflict: true }, { status: 409 });
  if (error instanceof InactiveSiteTenant) return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403 });
  throw error;
}

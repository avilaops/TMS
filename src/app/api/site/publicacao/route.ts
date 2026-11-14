import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/lib/staff';
import { publicationSnapshot } from '@/lib/carrier-site';
import { ownSite, publishSite } from '@/lib/carrier-site-store';
import { siteBody, siteError } from '@/lib/carrier-site-api';
const body = z.object({ revision: z.number().int().min(1) }).strict();

export async function POST(request: Request) {
  const { error } = await requireStaff({ pode: 'sitePublicar' });
  if (error) return error;
  const parsed = body.safeParse(await siteBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'Revisão inválida.' }, { status: 400 });
  try {
    const current = await ownSite();
    try { publicationSnapshot(current.draft); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Conteúdo incompleto.' }, { status: 400 }); }
    return NextResponse.json(await publishSite(parsed.data.revision, true));
  } catch (error) { return siteError(error); }
}
export async function DELETE(request: Request) {
  const { error } = await requireStaff({ pode: 'sitePublicar' });
  if (error) return error;
  const parsed = body.safeParse(await siteBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'Revisão inválida.' }, { status: 400 });
  try { return NextResponse.json(await publishSite(parsed.data.revision, false)); }
  catch (error) { return siteError(error); }
}

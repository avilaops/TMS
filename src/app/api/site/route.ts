import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/lib/staff';
import { siteDraftSchema } from '@/lib/carrier-site';
import { ownSite, saveSite } from '@/lib/carrier-site-store';
import { siteBody, siteError } from '@/lib/carrier-site-api';

export async function GET() {
  const { error } = await requireStaff({ pode: 'siteVer' });
  if (error) return error;
  try { return NextResponse.json(await ownSite(), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return siteError(error); }
}
const body = z.object({ revision: z.number().int().min(0), draft: siteDraftSchema }).strict();
export async function PUT(request: Request) {
  const { error } = await requireStaff({ pode: 'site' });
  if (error) return error;
  const parsed = body.safeParse(await siteBody(request));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
  try { return NextResponse.json(await saveSite(parsed.data.draft, parsed.data.revision)); }
  catch (error) { return siteError(error); }
}

import { Prisma } from '@prisma/client';
import prisma, { empresaAtual, sistema, transacao } from './prisma';
import { emptySiteDraft, publicationSnapshot, siteDraftSchema, sitePaths, type SiteDraft } from './carrier-site';
import { normalizarSlug } from './empresas';

export class SiteConflict extends Error {}
export class InactiveSiteTenant extends Error {}
export async function ownSite() {
  const tenant = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { name: true, slug: true, active: true } });
  if (!tenant?.active) throw new InactiveSiteTenant('Empresa inativa.');
  const site = await prisma.carrierSite.findFirst();
  return { draft: site ? siteDraftSchema.parse(site.draft) : emptySiteDraft(tenant.name), revision: site?.revision ?? 0, publishedAt: site?.publishedAt ?? null, slug: tenant.slug };
}

export async function saveSite(draft: SiteDraft, revision: number) {
  const own = await ownSite();
  try {
    const saved = await transacao(async tx => {
      if (revision === 0) return tx.carrierSite.create({ data: { draft: draft as Prisma.InputJsonValue } });
      const updated = await tx.carrierSite.updateMany({ where: { revision }, data: { draft: draft as Prisma.InputJsonValue, revision: { increment: 1 } } });
      if (updated.count !== 1) throw new SiteConflict();
      return tx.carrierSite.findFirstOrThrow();
    });
    return { draft: siteDraftSchema.parse(saved.draft), revision: saved.revision, publishedAt: saved.publishedAt, slug: own.slug };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new SiteConflict();
    throw error;
  }
}

export async function publishSite(revision: number, publish: boolean) {
  const own = await ownSite();
  const saved = await transacao(async tx => {
    const current = await tx.carrierSite.findFirst({ where: { revision } });
    if (!current) throw new SiteConflict();
    const snapshot = publish ? publicationSnapshot(current.draft) : null;
    const updated = await tx.carrierSite.updateMany({ where: { revision }, data: { published: snapshot === null ? Prisma.DbNull : snapshot as Prisma.InputJsonValue, publishedAt: snapshot ? new Date() : null, revision: { increment: 1 } } });
    if (updated.count !== 1) throw new SiteConflict();
    return tx.carrierSite.findFirstOrThrow();
  });
  return { draft: siteDraftSchema.parse(saved.draft), revision: saved.revision, publishedAt: saved.publishedAt, slug: own.slug };
}

/** Reviewed system access: anonymous lookup returns ONLY the explicitly published snapshot of an active tenant. */
export async function getPublishedSite(slug: string): Promise<{ content: SiteDraft; publishedAt: Date; slug: string } | null> {
  if (normalizarSlug(slug) !== slug) return null;
  const tenant = await sistema.tenant.findFirst({ where: { slug, active: true }, select: { slug: true, site: { select: { published: true, publishedAt: true } } } });
  if (!tenant?.site?.publishedAt || !tenant.site.published) return null;
  const parsed = siteDraftSchema.safeParse(tenant.site.published);
  if (!parsed.success) return null;
  return { content: { ...parsed.data, posts: parsed.data.posts.filter(post => post.published) }, publishedAt: tenant.site.publishedAt, slug: tenant.slug };
}

export async function publishedSiteSitemap() {
  const sites = await sistema.carrierSite.findMany({ where: { publishedAt: { not: null }, tenant: { active: true } }, select: { published: true, publishedAt: true, tenant: { select: { slug: true } } } });
  return sites.flatMap(site => {
    const content = siteDraftSchema.safeParse(site.published);
    if (!content.success || !site.publishedAt) return [];
    return sitePaths(content.data).map(path => ({ path: `/transportadoras/${site.tenant.slug}${path}`, lastModified: site.publishedAt! }));
  });
}

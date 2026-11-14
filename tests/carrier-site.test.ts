import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerSession } from 'next-auth';
import { siteDraftSchema, publicationSnapshot, sitePaths, emptySiteDraft } from '../src/lib/carrier-site';
import { EMPRESA_PADRAO, EMPRESA_OUTRA } from './empresas-de-teste';
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

const complete = () => ({ ...emptySiteDraft('Transportadora Exemplo'), headline: 'Transporte para a sua empresa', about: 'Atendemos empresas com transporte de mercadorias e acompanhamento das entregas.', email: 'contato@example.com', services: ['Carga fracionada'], posts: [{ slug: 'apresentacao', title: 'Conheça nossa operação', summary: 'Um pouco sobre nosso trabalho.', body: 'Atuamos no transporte de cargas.', published: true }, { slug: 'segredo', title: 'Rascunho interno', summary: '', body: 'NÃO PUBLICAR', published: false }] });

describe('conteúdo do CMS de cortesia', () => {
  it('permite rascunho incompleto e recusa publicar sem informações mínimas', () => {
    expect(siteDraftSchema.safeParse(emptySiteDraft('')).success).toBe(true);
    expect(() => publicationSnapshot(emptySiteDraft(''))).toThrow();
  });
  it('a publicação nunca contém artigos em rascunho', () => {
    const snapshot = publicationSnapshot(complete());
    expect(snapshot.posts.map(post => post.slug)).toEqual(['apresentacao']);
    expect(JSON.stringify(snapshot)).not.toContain('NÃO PUBLICAR');
    expect(sitePaths(snapshot)).toEqual(['', '/sobre', '/servicos', '/contato', '/blog', '/blog/apresentacao']);
  });
  it('recusa tenant do corpo, scripts em URLs, slugs repetidos e SVG', () => {
    expect(siteDraftSchema.safeParse({ ...complete(), tenantId: EMPRESA_OUTRA.id }).success).toBe(false);
    expect(siteDraftSchema.safeParse({ ...complete(), whatsapp: 'javascript:alert(1)' }).success).toBe(false);
    expect(siteDraftSchema.safeParse({ ...complete(), logo: 'data:image/svg+xml;base64,AAAA' }).success).toBe(false);
    const draft = complete(); draft.posts.push(draft.posts[0]);
    expect(siteDraftSchema.safeParse(draft).success).toBe(false);
  });
});

describe('CMS com banco real e sessão', () => {
  let db: typeof import('../src/lib/prisma');
  let route: typeof import('../src/app/api/site/route');
  let publish: typeof import('../src/app/api/site/publicacao/route');
  let readPublic: typeof import('../src/lib/carrier-site-store');
  const users: Record<string, string> = {};
  const session = vi.mocked(getServerSession);
  const enter = (role: string | null, tenant = EMPRESA_PADRAO.id) => session.mockResolvedValue(role ? { user: { id: users[`${tenant}:${role}`], tenantId: tenant, role } } : null);
  const request = (method: string, value: unknown) => new Request('http://localhost/api/site', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  beforeAll(async () => {
    db = await import('../src/lib/prisma');
    route = await import('../src/app/api/site/route');
    publish = await import('../src/app/api/site/publicacao/route');
    readPublic = await import('../src/lib/carrier-site-store');
    for (const tenant of [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id]) for (const role of ['ADMIN', 'COMMERCIAL', 'DRIVER'] as const) {
      const user = await db.paraEmpresa(tenant).db.user.create({ data: { name: role, email: `cms-${tenant}-${role}@example.test`, password: 'test-only', role } });
      users[`${tenant}:${role}`] = user.id;
    }
  });
  beforeEach(async () => { await db.sistema.carrierSite.deleteMany(); enter('ADMIN'); });
  afterAll(async () => {
    await db.sistema.carrierSite.deleteMany();
    await db.sistema.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });
  it('exige autenticação, impede motorista e reserva publicação ao administrador', async () => {
    enter(null); expect((await route.GET()).status).toBe(401);
    enter('DRIVER'); expect((await route.GET()).status).toBe(403);
    enter('COMMERCIAL');
    expect((await route.PUT(request('PUT', { revision: 0, draft: complete() }))).status).toBe(200);
    expect((await publish.POST(request('POST', { revision: 1 }))).status).toBe(403);
  });
  it('isola empresas, detecta edição desatualizada e publica somente o snapshot', async () => {
    expect((await route.PUT(request('PUT', { revision: 0, draft: complete() }))).status).toBe(200);
    expect((await route.PUT(request('PUT', { revision: 0, draft: complete() }))).status).toBe(409);
    expect(await readPublic.getPublishedSite(EMPRESA_PADRAO.slug)).toBe(null);
    expect((await publish.POST(request('POST', { revision: 1 }))).status).toBe(200);
    expect(JSON.stringify(await readPublic.getPublishedSite(EMPRESA_PADRAO.slug))).not.toContain('NÃO PUBLICAR');
    expect(await db.paraEmpresa(EMPRESA_OUTRA.id).db.carrierSite.findUnique({ where: { tenantId: EMPRESA_PADRAO.id } })).toBe(null);
    enter('ADMIN', EMPRESA_OUTRA.id);
    expect((await (await route.GET()).json()).revision).toBe(0);
    expect((await publish.DELETE(request('DELETE', { revision: 2 }))).status).toBe(409);
    enter('ADMIN');
    expect((await publish.DELETE(request('DELETE', { revision: 2 }))).status).toBe(200);
    expect(await readPublic.getPublishedSite(EMPRESA_PADRAO.slug)).toBe(null);
    expect((await (await route.GET()).json()).draft.posts).toHaveLength(2);
  });
  it('mantém a publicação anterior ao editar e oculta empresa inativa', async () => {
    await route.PUT(request('PUT', { revision: 0, draft: complete() }));
    await publish.POST(request('POST', { revision: 1 }));
    await route.PUT(request('PUT', { revision: 2, draft: { ...complete(), headline: 'Ainda é rascunho' } }));
    expect((await readPublic.getPublishedSite(EMPRESA_PADRAO.slug))?.content.headline).toBe('Transporte para a sua empresa');
    await db.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { active: false } });
    try { expect(await readPublic.getPublishedSite(EMPRESA_PADRAO.slug)).toBe(null); }
    finally { await db.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { active: true } }); }
  });
  it('responde com a revisão salva pela própria aba, mesmo se outra edição ocorrer antes da resposta', async () => {
    const original = readPublic.saveSite;
    const spy = vi.spyOn(readPublic, 'saveSite').mockImplementationOnce(async (draft, revision) => {
      const saved = await original(draft, revision);
      await original({ ...complete(), headline: 'Conteúdo da outra aba' }, saved.revision);
      return saved;
    });
    try {
      const response = await route.PUT(request('PUT', { revision: 0, draft: complete() }));
      const value = await response.json();
      expect(value.revision).toBe(1);
      expect(value.draft.headline).toBe('Transporte para a sua empresa');
      expect((await publish.POST(request('POST', { revision: value.revision }))).status).toBe(409);
    } finally { spy.mockRestore(); }
  });
  it('publica empresas com hífens consecutivos, como permite o cadastro existente', async () => {
    await db.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { slug: 'cliente--sul' } });
    try {
      await route.PUT(request('PUT', { revision: 0, draft: complete() }));
      expect((await publish.POST(request('POST', { revision: 1 }))).status).toBe(200);
      expect((await readPublic.getPublishedSite('cliente--sul'))?.content.name).toBe('Transportadora Exemplo');
    } finally { await db.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { slug: EMPRESA_PADRAO.slug } }); }
  });
});

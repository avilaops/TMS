import { describe, expect, it } from 'vitest';
import { getPublicPage, PUBLIC_PAGES } from '@/lib/public-site';
import { publicMetadata } from '@/lib/public-seo';

describe('descoberta pública do TMS', () => {
  it('apresenta o produto na canonical de produção, sem usar o endereço do Render', () => {
    const page = getPublicPage('/');
    expect(page?.path).toBe('/');
    expect(publicMetadata('/').alternates?.canonical).toBe('https://tms.avilaops.com/');
    expect(publicMetadata('/').robots).toMatchObject({ index: true, follow: true });
  });

  it.each([
    '/dashboard', '/dashboard/clientes', '/driver/viagem/123', '/portal/faturas',
    '/empresa', '/plataforma/empresas', '/login', '/rastreio', '/api/health',
    '/blog/inexistente', '/sobre?email=pessoa@example.test', '/%2e%2e/dashboard',
    '//sobre', '/sobre/../dashboard', 'https://exemplo.test/sobre', '/sobre#privado',
  ])('não transforma %s em página pública por fallback', (path) => {
    expect(getPublicPage(path)).toBeUndefined();
  });

  it('descobre os quatro guias fiscais e vincula a página Sobre à sua própria canonical', () => {
    for (const path of ['/blog/o-que-e-mdfe', '/blog/o-que-e-cte', '/blog/o-que-e-cte-os', '/blog/o-que-e-nfe']) {
      expect(getPublicPage(path)?.kind).toBe('article');
    }
    expect(publicMetadata('/sobre').alternates?.canonical).toBe('https://tms.avilaops.com/sobre');
    expect(publicMetadata('/sobre').openGraph?.url).toBe('https://tms.avilaops.com/sobre');
  });

  it('não fabrica metadados indexáveis para uma URL desconhecida', () => {
    expect(() => publicMetadata('/dashboard/financeiro')).toThrow();
    expect(PUBLIC_PAGES.some(page => page.path.startsWith('/dashboard'))).toBe(false);
  });
});

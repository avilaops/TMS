import { PUBLIC_ORIGIN } from '@/lib/public-site';

export function StructuredData({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

export function ProductStructuredData() {
  return <StructuredData data={{
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'Organization', '@id': `${PUBLIC_ORIGIN}/#organization`, name: 'Ávila Ops', url: 'https://avilaops.com/', logo: `${PUBLIC_ORIGIN}/web-app-manifest-512x512.png` },
      { '@type': 'WebSite', '@id': `${PUBLIC_ORIGIN}/#website`, name: 'TMS • Ávila Ops', url: PUBLIC_ORIGIN, inLanguage: 'pt-BR', publisher: { '@id': `${PUBLIC_ORIGIN}/#organization` } },
      { '@type': 'WebApplication', name: 'TMS • Ávila Ops', url: PUBLIC_ORIGIN, applicationCategory: 'BusinessApplication', operatingSystem: 'Web', description: 'Gestão de transportes com coletas, cargas, frota e financeiro.', provider: { '@id': `${PUBLIC_ORIGIN}/#organization` } },
    ],
  }} />;
}

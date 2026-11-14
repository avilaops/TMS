export const PUBLIC_ORIGIN = 'https://tms.avilaops.com';
export const CONTACT_URL = 'https://avilaops.com/contato/';

export type PublicPage = {
  path: string;
  title: string;
  description: string;
  updatedAt: string;
  kind: 'page' | 'article';
  imageKey: string;
};

const updatedAt = '2026-11-14';

export const PUBLIC_PAGES: readonly PublicPage[] = [
  { path: '/', title: 'TMS • Gestão de transportes da Ávila Ops', description: 'Coletas, cargas, frota e financeiro conectados. Conheça o TMS da Ávila Ops e organize sua operação de transporte em um só lugar.', imageKey: 'inicio', kind: 'page', updatedAt },
  { path: '/sobre', title: 'Sobre o TMS • Ávila Ops', description: 'Conheça o TMS da Ávila Ops: gestão para transportadoras, com áreas próprias para a operação, os motoristas e os clientes.', imageKey: 'sobre', kind: 'page', updatedAt },
  { path: '/blog', title: 'Universo Fiscal • Blog do TMS', description: 'Entenda MDF-e, CT-e, CT-e OS e NF-e com explicações práticas, diferenças entre documentos e links para fontes oficiais.', imageKey: 'blog', kind: 'page', updatedAt },
  { path: '/blog/o-que-e-mdfe', title: 'O que é MDF-e? • Universo Fiscal', description: 'Entenda o Manifesto Eletrônico de Documentos Fiscais, sua relação com a viagem e as diferenças para CT-e e NF-e.', imageKey: 'mdfe', kind: 'article', updatedAt },
  { path: '/blog/o-que-e-cte', title: 'O que é CT-e? • Universo Fiscal', description: 'Saiba o que é o Conhecimento de Transporte Eletrônico, modelo 57, e como ele se relaciona com os documentos da carga.', imageKey: 'cte', kind: 'article', updatedAt },
  { path: '/blog/o-que-e-cte-os', title: 'O que é CT-e OS? • Universo Fiscal', description: 'Conheça o CT-e para Outros Serviços, modelo 67, e entenda por que ele tem um contexto diferente do CT-e de cargas.', imageKey: 'cte-os', kind: 'article', updatedAt },
  { path: '/blog/o-que-e-nfe', title: 'O que é NF-e? • Universo Fiscal', description: 'Entenda a Nota Fiscal Eletrônica, o papel do XML e do DANFE e a relação desse documento com o transporte de mercadorias.', imageKey: 'nfe', kind: 'article', updatedAt },
  { path: '/privacidade', title: 'Privacidade • TMS Ávila Ops', description: 'Como as páginas públicas do TMS tratam informações, preferências de cookies e pedidos relacionados a dados pessoais.', imageKey: 'privacidade', kind: 'page', updatedAt },
  { path: '/cookies', title: 'Cookies e preferências • TMS Ávila Ops', description: 'Entenda os cookies necessários ao TMS e escolha se deseja permitir estatísticas nas páginas públicas do produto.', imageKey: 'cookies', kind: 'page', updatedAt },
];

const pages = new Map(PUBLIC_PAGES.map(page => [page.path, page]));

/** Only exact, known document paths qualify for public discovery and analytics. */
export function getPublicPage(path: string): PublicPage | undefined {
  return pages.get(path);
}

export function publicUrl(path: string): string {
  return `${PUBLIC_ORIGIN}${path}`;
}

export function publicSitemap() {
  return PUBLIC_PAGES.map(page => ({ url: publicUrl(page.path), lastModified: page.updatedAt }));
}

export function llmsText(): string {
  return [
    '# TMS • Ávila Ops',
    '',
    '> Gestão de transportes para conectar coletas, cargas, frota, atendimento e financeiro.',
    '',
    'Este arquivo referencia somente informações públicas do produto. Dados de transportadoras, clientes, viagens e rastreamentos não fazem parte desta documentação.',
    '',
    '## Produto e conteúdo',
    ...PUBLIC_PAGES.map(page => `- [${page.title}](${publicUrl(page.path)}): ${page.description}`),
    '',
    '## Fontes fiscais',
    '- [CONFAZ](https://www.confaz.fazenda.gov.br/): legislação e ajustes SINIEF.',
    '- [Portal Nacional da NF-e](https://www.nfe.fazenda.gov.br/portal/): documentação da Nota Fiscal Eletrônica.',
    '',
    'As publicações explicam conceitos gerais. Regras aplicáveis a cada operação devem ser confirmadas nas fontes oficiais e com a assessoria fiscal responsável.',
    '',
  ].join('\n');
}

export type PublicPost = {
  slug: string;
  title: string;
  summary: string;
  label: string;
  model: string;
  publishedAt: string;
  readingMinutes: number;
};

export const PUBLIC_POSTS: readonly PublicPost[] = [
  { slug: 'o-que-e-mdfe', title: 'O que é MDF-e?', summary: 'O documento que conecta a viagem aos documentos fiscais transportados.', label: 'MDF-e', model: 'Modelo 58', publishedAt: '2026-11-14', readingMinutes: 4 },
  { slug: 'o-que-e-cte', title: 'O que é CT-e?', summary: 'Entenda o documento da prestação de transporte e sua relação com a carga.', label: 'CT-e', model: 'Modelo 57', publishedAt: '2026-11-14', readingMinutes: 4 },
  { slug: 'o-que-e-cte-os', title: 'O que é CT-e OS?', summary: 'Outros serviços de transporte têm um documento e um contexto próprios.', label: 'CT-e OS', model: 'Modelo 67', publishedAt: '2026-11-14', readingMinutes: 4 },
  { slug: 'o-que-e-nfe', title: 'O que é NF-e?', summary: 'Da operação comercial ao transporte: conheça o papel do XML e do DANFE.', label: 'NF-e', model: 'Modelo 55', publishedAt: '2026-11-14', readingMinutes: 4 },
];

export function getPublicPost(slug: string): PublicPost | undefined {
  return PUBLIC_POSTS.find(post => post.slug === slug);
}

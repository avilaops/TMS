import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const post = z.object({ slug, title: text(140).min(3), summary: text(300), body: text(20000), published: z.boolean() }).strict();
export const siteDraftSchema = z.object({
  name: text(80), headline: text(140), description: text(300), about: text(8000),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logo: z.string().max(200000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).nullable(),
  services: z.array(text(160).min(2)).max(12), regions: z.array(text(100).min(2)).max(20),
  email: z.union([z.literal(''), z.email().max(160)]),
  phone: text(24).regex(/^[+\d\s().-]*$/), whatsapp: text(15).regex(/^\d{0,15}$/),
  address: text(300), posts: z.array(post).max(12),
}).strict().refine(value => new Set(value.posts.map(item => item.slug)).size === value.posts.length, 'Cada artigo precisa de um endereço diferente.');

export type SiteDraft = z.infer<typeof siteDraftSchema>;
export function emptySiteDraft(name: string): SiteDraft {
  return { name, headline: '', description: '', about: '', accent: '#1761d1', logo: null, services: [], regions: [], email: '', phone: '', whatsapp: '', address: '', posts: [] };
}

/** Data, never executable HTML/MDX. Unpublished posts are removed at the publication boundary. */
export function publicationSnapshot(value: unknown): SiteDraft {
  const draft = siteDraftSchema.parse(value);
  if (draft.name.length < 2 || draft.headline.length < 8 || draft.about.length < 40 || !draft.services.length || !(draft.email || draft.phone.length >= 8 || draft.whatsapp.length >= 10)) {
    throw new Error('Preencha nome, chamada (8 caracteres), apresentação (40 caracteres), ao menos um serviço e um contato válido.');
  }
  const posts = draft.posts.filter(item => item.published);
  if (posts.some(item => item.body.length < 30 || item.summary.length < 10)) throw new Error('Artigos marcados para publicação precisam de resumo (10 caracteres) e texto (30 caracteres).');
  return { ...draft, posts };
}

export function sitePaths(site: SiteDraft): string[] {
  return ['', '/sobre', '/servicos', '/contato', ...(site.posts.length ? ['/blog', ...site.posts.map(post => `/blog/${post.slug}`)] : [])];
}

export function carrierPath(slug: string, path = '') { return `/transportadoras/${slug}${path}`; }

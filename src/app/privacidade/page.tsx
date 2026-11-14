import { PublicShell, PublicPageFrame } from '@/components/publico/PublicShell';
import { publicMetadata } from '@/lib/public-seo';
import Content from '@/content/public/privacidade.mdx';
export const metadata = publicMetadata('/privacidade');
export default function Page() { return <PublicShell><PublicPageFrame eyebrow="Privacidade" title="Suas informações merecem cuidado."><div className="public-prose"><Content /></div></PublicPageFrame></PublicShell>; }

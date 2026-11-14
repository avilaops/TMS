import { PublicShell, PublicPageFrame } from '@/components/publico/PublicShell';
import { publicMetadata } from '@/lib/public-seo';
import Content from '@/content/public/cookies.mdx';
export const metadata = publicMetadata('/cookies');
export default function Page() { return <PublicShell><PublicPageFrame eyebrow="Cookies" title="Você escolhe as estatísticas."><div className="public-prose"><Content /></div></PublicPageFrame></PublicShell>; }

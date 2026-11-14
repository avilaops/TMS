import { PublicShell, PublicPageFrame } from '@/components/publico/PublicShell';
import { publicMetadata } from '@/lib/public-seo';
import Sobre from '@/content/public/sobre.mdx';
export const metadata = publicMetadata('/sobre');
export default function Page() {
  return <PublicShell><PublicPageFrame eyebrow="Sobre o TMS" title="Uma operação conectada, do início ao fim." description="Tecnologia da Ávila Ops para quem faz o transporte acontecer."><div className="public-prose"><Sobre /></div></PublicPageFrame></PublicShell>;
}

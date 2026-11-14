import { PublicShell, PublicPageFrame } from '@/components/publico/PublicShell';
import { PostCards } from '@/components/publico/PostCards';
import { publicMetadata } from '@/lib/public-seo';
export const metadata = publicMetadata('/blog');
export default function Page() {
  return <PublicShell><PublicPageFrame eyebrow="Universo Fiscal" title="Documentos diferentes. Entenda o papel de cada um." description="Conceitos para quem lida com mercadorias, serviços e viagens. Comece pelo documento que faz parte da sua rotina."><PostCards /><p className="public-editorial-note">Conteúdo educativo • atualizado em 14 de novembro de 2026. Consulte as fontes oficiais e a assessoria fiscal da sua empresa para avaliar cada operação.</p></PublicPageFrame></PublicShell>;
}

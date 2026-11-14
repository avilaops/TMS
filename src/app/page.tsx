import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AREA_DO_PERFIL } from "@/lib/permissoes";
import { LandingPage } from '@/components/publico/LandingPage';
import { publicMetadata } from '@/lib/public-seo';

export const metadata = publicMetadata('/');

// Mesmo mapa do proxy.ts: cada perfil tem uma unica area.
const HOME_BY_ROLE: Record<string, string> = AREA_DO_PERFIL;

// Visitantes conhecem o produto; quem entrou preserva sua area de trabalho.
export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return <LandingPage />;
  // Entrou pelo login único mas ainda não está em nenhuma empresa.
  if (!session.user.tenantId) redirect("/empresa");
  redirect(HOME_BY_ROLE[session.user.role] ?? "/empresa");
}

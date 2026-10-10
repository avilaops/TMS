import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AREA_DO_PERFIL } from "@/lib/permissoes";

// Mesmo mapa do proxy.ts: cada perfil tem uma unica area.
const HOME_BY_ROLE: Record<string, string> = AREA_DO_PERFIL;

// O TMS nao tem pagina publica: a raiz leva quem ja entrou para a propria area
// e todo o resto para o login. O site institucional vive em outro repositorio.
export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  // Entrou pelo login único mas ainda não está em nenhuma empresa.
  if (!session.user.tenantId) redirect("/empresa");
  redirect(HOME_BY_ROLE[session.user.role] ?? "/empresa");
}

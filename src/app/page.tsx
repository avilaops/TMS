import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Mesmo mapa do proxy.ts: cada perfil tem uma unica area.
const HOME_BY_ROLE: Record<string, string> = {
  ADMIN: "/dashboard",
  OPERATION: "/dashboard",
  DRIVER: "/driver",
  CLIENT: "/portal",
};

// O TMS nao tem pagina publica: a raiz leva quem ja entrou para a propria area
// e todo o resto para o login. O site institucional vive em outro repositorio.
export default async function Home() {
  const session = await getServerSession(authOptions);
  redirect(HOME_BY_ROLE[session?.user?.role ?? ""] ?? "/login");
}

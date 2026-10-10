import Link from "next/link";
import { LogIn, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeniedReason } from "@/app/dashboard/financeiro/carregar";

/**
 * O que a tela restrita mostra no lugar do conteúdo quando a rota responde 401
 * (a sessão caiu: resolve entrando de novo) ou 403 (o perfil não tem acesso:
 * entrar de novo não resolve). `oQue` completa a frase do 401: "Entre de novo
 * para ver a auditoria.". A do 403 não cita perfil: quem pode o quê está na
 * matriz de src/lib/permissoes.ts e muda sem passar por aqui.
 */
export function AcessoRestrito({ motivo, oQue }: { motivo: DeniedReason; oQue: string }) {
  if (motivo === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para ver {oQue}.{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">
              Ir para o login
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-600" />
          Acesso negado
        </CardTitle>
        <CardDescription>Seu perfil não tem acesso a esta área.</CardDescription>
      </CardHeader>
    </Card>
  );
}

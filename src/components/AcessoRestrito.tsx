import Link from "next/link";
import { LogIn, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeniedReason } from "@/app/dashboard/financeiro/carregar";

/**
 * O que a tela só do administrador mostra no lugar do conteúdo quando a rota
 * responde 401 (a sessão caiu: resolve entrando de novo) ou 403 (o perfil não
 * tem acesso: entrar de novo não resolve). `oQue` completa as duas frases:
 * "Entre de novo para ver a auditoria." / "A auditoria é restrita...".
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
        <CardDescription>Só o perfil Administrador vê {oQue}.</CardDescription>
      </CardHeader>
    </Card>
  );
}

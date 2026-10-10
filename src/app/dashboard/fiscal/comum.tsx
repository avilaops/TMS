import Link from "next/link";
import { LogIn, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DeniedReason } from "../financeiro/carregar";

// O que as telas de documentos fiscais (notas e CT-e) têm em comum.

/** Sessão expirada (401) ou perfil sem acesso (403), como nas telas vizinhas. */
export function Negado({ motivo }: { motivo: DeniedReason }) {
  if (motivo === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para ver os documentos fiscais.{" "}
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
        <CardDescription>Os documentos fiscais são restritos à equipe interna.</CardDescription>
      </CardHeader>
    </Card>
  );
}

/** A chave em blocos de quatro dígitos, como vem impressa no documento. */
export const chaveEmBlocos = (chave: string) => chave.replace(/(\d{4})(?=\d)/g, "$1 ");

/** Número da nota com a série: "1234 / 1". */
export const numeroDaNota = (nota: { number: number; series: number }) => `${nota.number} / ${nota.series}`;

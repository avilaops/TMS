"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, LogIn, Printer, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDocument } from "@/lib/format";
import { dataPorExtenso } from "@/lib/cobranca";
import { PAYMENT_METHOD_LABEL, diaNoBrasil } from "@/lib/financeiro";
import { deniedReason, type DeniedReason } from "../../carregar";

/** Recibo de um valor já recebido. Imprime ou salva em PDF; não tem numeração própria. */

type Recibo = {
  id: string;
  /** O que entrou: com juros, multa e desconto, quando a baixa teve. */
  amount: number;
  /** Só vem quando o recebido difere do valor do título. */
  encargos?: { original: number; juros: number; multa: number; desconto: number } | null;
  description: string;
  paidAt: string;
  paymentMethod: keyof typeof PAYMENT_METHOD_LABEL | null;
  dueDate: string | null;
  invoice: { id: string; number: number } | null;
  pagador: { nome: string | null; cnpj: string | null };
  empresa: { name: string; cnpj: string | null };
};

type Carga = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; recibo: Recibo };

const FALHA = "Não foi possível carregar o recibo.";

export default function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [carga, setCarga] = useState<Carga | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/financeiro/${id}/recibo`)
      .then(async (res): Promise<Carga> => {
        const denied = deniedReason(res.status);
        if (denied) return { denied };
        const corpo = await res.json().catch(() => null);
        // 404 e 409 trazem o motivo no corpo: é ele que a tela mostra.
        if (!res.ok) return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA };
        return { denied: null, erro: null, recibo: corpo as Recibo };
      })
      .catch((): Carga => ({ denied: null, erro: FALHA }))
      .then((resultado) => {
        if (ativo) setCarga(resultado);
      });
    return () => {
      ativo = false;
    };
  }, [id]);

  if (!carga) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (carga.denied !== null) {
    if (carga.denied === "login") {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="w-5 h-5 text-blue-600" />
              Sessão expirada
            </CardTitle>
            <CardDescription>
              Entre de novo para ver o recibo.{" "}
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
          <CardDescription>O recibo é restrito ao perfil Administrador.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (carga.erro !== null) {
    return (
      <div role="alert" className="bg-white rounded-2xl border border-gray-200 p-8">
        <h1 className="font-outfit font-bold text-lg">{carga.erro}</h1>
        <Link href="/dashboard/financeiro" className="text-sm text-blue-600 hover:underline">
          Voltar para o financeiro
        </Link>
      </div>
    );
  }

  const { recibo } = carga;
  const referente = recibo.invoice && !recibo.description.includes(`nº ${recibo.invoice.number}`)
    ? `${recibo.description} (fatura nº ${recibo.invoice.number})`
    : recibo.description;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/dashboard/financeiro" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" />
          Financeiro
        </Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
          <Printer className="w-4 h-4" />
          Imprimir ou salvar em PDF
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-8 text-gray-900">
        <div className="flex flex-wrap justify-between gap-6">
          <h1 className="text-2xl font-outfit font-bold">Recibo</h1>
          <p data-campo="valor" className="text-2xl font-bold">
            {formatCurrency(recibo.amount)}
          </p>
        </div>

        <dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2">
          <div data-campo="empresa">
            <dt className="text-xs text-gray-500">Recebedor</dt>
            <dd className="font-medium">{recibo.empresa.name}</dd>
            {recibo.empresa.cnpj && <dd className="text-gray-600">{formatDocument(recibo.empresa.cnpj)}</dd>}
          </div>
          <div data-campo="pagador">
            <dt className="text-xs text-gray-500">Recebido de</dt>
            <dd className="font-medium">{recibo.pagador.nome ?? "Não informado"}</dd>
            {recibo.pagador.cnpj && <dd className="text-gray-600">{formatDocument(recibo.pagador.cnpj)}</dd>}
          </div>
          <div data-campo="referente" className="sm:col-span-2">
            <dt className="text-xs text-gray-500">Referente a</dt>
            <dd>{referente}</dd>
          </div>
          <div data-campo="recebimento">
            <dt className="text-xs text-gray-500">Data do recebimento</dt>
            <dd>{dataPorExtenso(diaNoBrasil(recibo.paidAt))}</dd>
          </div>
          {recibo.paymentMethod && (
            <div data-campo="forma">
              <dt className="text-xs text-gray-500">Forma de pagamento</dt>
              <dd>{PAYMENT_METHOD_LABEL[recibo.paymentMethod] ?? recibo.paymentMethod}</dd>
            </div>
          )}
          {recibo.encargos && (
            <div data-campo="composicao" className="sm:col-span-2">
              <dt className="text-xs text-gray-500">Composição do valor</dt>
              <dd>
                {[
                  `Valor do título ${formatCurrency(recibo.encargos.original)}`,
                  recibo.encargos.multa > 0 && `multa ${formatCurrency(recibo.encargos.multa)}`,
                  recibo.encargos.juros > 0 && `juros ${formatCurrency(recibo.encargos.juros)}`,
                  recibo.encargos.desconto > 0 && `desconto ${formatCurrency(recibo.encargos.desconto)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </div>
          )}
        </dl>

        <p className="mt-8 text-sm text-gray-600">
          {recibo.empresa.name} declara ter recebido de {recibo.pagador.nome ?? "pagador não informado"} a quantia de{" "}
          {formatCurrency(recibo.amount)}, referente a {referente}.
        </p>
      </div>
    </div>
  );
}

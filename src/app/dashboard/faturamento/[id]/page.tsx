"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { formatCalendarDate, formatCurrency, formatDate, formatDocument, formatWeight } from "@/lib/format";
import { PixCopiaECola } from "@/components/pix/copia-e-cola";
import { Boleto, PixDinamico } from "@/components/pix/cobranca-do-gateway";
import { ROTULO_DO_TIPO, rotuloDaSituacao, type CobrancaDaTela, type TipoDeCobranca } from "@/lib/cobranca-gateway";

/** A fatura como vai para o cliente: cabeçalho, cargas cobradas e total. Imprime ou salva em PDF. */

type Fatura = {
  number: number;
  status: "OPEN" | "PAID" | "CANCELLED";
  total: number;
  dueDate: string;
  issuedAt: string;
  paidAt: string | null;
  notes: string | null;
  client: { companyName: string; tradeName: string | null; cnpj: string };
  /** O lançamento a receber da fatura; é dele o recibo. */
  transaction: { id: string } | null;
  /** Pix Copia e Cola da fatura em aberto; nulo sem chave cadastrada em Empresa. */
  pix: string | null;
  /** Cobranças do Mercado Pago desta fatura, da mais nova para a mais antiga. */
  cobrancas?: CobrancaDaTela[];
  /** A empresa tem a conta do Mercado Pago ligada (Empresa > Cobrança). */
  gateway?: boolean;
  collections: {
    id: string;
    trackingCode: string | null;
    createdAt: string;
    origin: string;
    destination: string;
    receiver: string;
    volumes: number;
    weight: number;
    freightValue: number | null;
  }[];
};

const SITUACAO = { OPEN: "Em aberto", PAID: "Paga", CANCELLED: "Cancelada" } as const;

export default function FaturaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [fatura, setFatura] = useState<Fatura | null>(null);
  const [erro, setErro] = useState("");
  // Cobrança do Mercado Pago: o que está sendo feito e o recado da última ação.
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = (fatura: string) =>
    fetch(`/api/faturas/${fatura}`)
      .then(async (res) => {
        if (res.status === 404) return setErro("Fatura não encontrada.");
        if (res.status === 401 || res.status === 403) return setErro("Seu perfil não tem acesso a esta área.");
        if (!res.ok) throw new Error();
        setFatura((await res.json()) as Fatura);
      })
      .catch(() => setErro("Não foi possível carregar a fatura."));

  useEffect(() => {
    void carregar(id);
  }, [id]);

  /** Gera a cobrança (`tipo`) ou atualiza a situação de uma (`cobrancaId`), e lê a fatura de novo. */
  const cobrar = async (acao: { tipo: TipoDeCobranca } | { cobrancaId: string }) => {
    setOcupado(true);
    setRecado(null);
    try {
      const gerar = "tipo" in acao;
      const res = await fetch(gerar ? `/api/faturas/${id}/cobrancas` : `/api/faturas/${id}/cobrancas/${acao.cobrancaId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: gerar ? JSON.stringify({ tipo: acao.tipo }) : undefined,
      });
      const corpo = (await res.json().catch(() => null)) as (CobrancaDaTela & { error?: string }) | null;
      if (res.status === 403) setRecado({ ok: false, texto: "Seu perfil não gera nem atualiza cobrança." });
      else if (!res.ok || !corpo) setRecado({ ok: false, texto: corpo?.error ?? "Não foi possível falar com o Mercado Pago." });
      else setRecado({ ok: true, texto: gerar ? `${ROTULO_DO_TIPO[acao.tipo]} gerado.` : `Situação: ${rotuloDaSituacao(corpo.situacao).toLowerCase()}.` });
      await carregar(id);
    } catch {
      setRecado({ ok: false, texto: "Não foi possível falar com o Mercado Pago." });
    } finally {
      setOcupado(false);
    }
  };

  if (erro) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-8">
        <h1 className="font-outfit font-bold text-lg">{erro}</h1>
        <Link href="/dashboard/faturamento" className="text-sm text-blue-600 hover:underline">
          Voltar para o faturamento
        </Link>
      </div>
    );
  }

  if (!fatura) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  const cobrancas = fatura.cobrancas ?? [];
  const emAberto = (tipo: TipoDeCobranca) => cobrancas.some((cobranca) => cobranca.tipo === tipo && cobranca.situacao === "PENDING");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/dashboard/faturamento" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" />
          Faturamento
        </Link>
        <div className="flex items-center gap-5">
          {fatura.status === "PAID" && fatura.transaction && (
            <Link href={`/dashboard/financeiro/recibo/${fatura.transaction.id}`} className="text-sm text-blue-600 hover:underline">
              Recibo
            </Link>
          )}
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
            <Printer className="w-4 h-4" />
            Imprimir ou salvar em PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-8 text-gray-900">
        <div className="flex flex-wrap justify-between gap-6">
          <div>
            <h1 className="text-2xl font-outfit font-bold">Fatura nº {fatura.number}</h1>
            <p className="text-sm text-gray-600 mt-1">
              {SITUACAO[fatura.status]}
              {fatura.paidAt ? ` em ${formatDate(fatura.paidAt)}` : ""}
            </p>
          </div>
          <dl className="text-sm text-right">
            <dt className="text-xs text-gray-500">Emissão</dt>
            <dd>{formatDate(fatura.issuedAt)}</dd>
            <dt className="text-xs text-gray-500 mt-2">Vencimento</dt>
            <dd className="font-medium">{formatCalendarDate(fatura.dueDate)}</dd>
          </dl>
        </div>

        <div className="mt-6 text-sm">
          <p className="text-xs text-gray-500">Cliente</p>
          <p className="font-medium">{fatura.client.companyName}</p>
          {fatura.client.tradeName && <p className="text-gray-600">{fatura.client.tradeName}</p>}
          <p className="text-gray-600">{formatDocument(fatura.client.cnpj)}</p>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 border-b border-gray-200">
              <tr>
                <th className="py-2 pr-4 font-medium">Data</th>
                <th className="py-2 pr-4 font-medium">Rastreio</th>
                <th className="py-2 pr-4 font-medium">Trajeto</th>
                <th className="py-2 pr-4 font-medium">Destinatário</th>
                <th className="py-2 pr-4 font-medium">Volumes / Peso</th>
                <th className="py-2 font-medium text-right">Frete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fatura.collections.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-4">{formatDate(c.createdAt)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{c.trackingCode ?? "-"}</td>
                  <td className="py-2 pr-4">
                    {c.origin} → {c.destination}
                  </td>
                  <td className="py-2 pr-4">{c.receiver}</td>
                  <td className="py-2 pr-4">
                    {c.volumes} · {formatWeight(c.weight)}
                  </td>
                  <td className="py-2 text-right">{formatCurrency(c.freightValue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-300">
                <td colSpan={5} className="py-3 text-right font-medium">
                  Total
                </td>
                <td className="py-3 text-right text-lg font-bold">{formatCurrency(fatura.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {(fatura.gateway || cobrancas.length > 0) && (
          <section data-cobrancas aria-label="Cobrança pelo Mercado Pago" className="mt-4 max-w-xl space-y-2 print:hidden">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold mr-auto">Mercado Pago</h2>
              {fatura.gateway &&
                fatura.status === "OPEN" &&
                (["PIX", "BOLETO"] as const)
                  .filter((tipo) => !emAberto(tipo))
                  .map((tipo) => (
                    <button
                      key={tipo}
                      type="button"
                      data-gerar={tipo}
                      disabled={ocupado}
                      onClick={() => void cobrar({ tipo })}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60"
                    >
                      {tipo === "PIX" ? "Gerar Pix" : "Gerar boleto"}
                    </button>
                  ))}
            </div>
            {recado && (
              <p role={recado.ok ? "status" : "alert"} className={`text-sm ${recado.ok ? "text-green-700" : "text-red-600"}`}>
                {recado.texto}
              </p>
            )}
            {cobrancas.map((cobranca) => (
              <div key={cobranca.id} data-cobranca={cobranca.id} className="space-y-2">
                <p className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-medium">{ROTULO_DO_TIPO[cobranca.tipo]}</span>
                  <span data-situacao={cobranca.situacao} className={cobranca.situacao === "REVIEW" ? "text-amber-700 font-medium" : "text-gray-600"}>
                    {rotuloDaSituacao(cobranca.situacao)}
                    {cobranca.pagaEm ? ` em ${formatDate(cobranca.pagaEm)}` : ""}
                  </span>
                  <span className="text-xs text-gray-500">gerada em {formatDate(cobranca.criadaEm)}</span>
                  {(cobranca.situacao === "PENDING" || cobranca.situacao === "REVIEW") && (
                    <button type="button" data-atualizar={cobranca.id} disabled={ocupado} onClick={() => void cobrar({ cobrancaId: cobranca.id })} className="text-sm text-blue-600 hover:underline disabled:opacity-60">
                      Atualizar situação
                    </button>
                  )}
                </p>
                {cobranca.nota && <p className="text-xs text-amber-800">{cobranca.nota}</p>}
                {cobranca.situacao === "PENDING" && cobranca.tipo === "PIX" && <PixDinamico pix={cobranca} />}
                {cobranca.situacao === "PENDING" && cobranca.tipo === "BOLETO" && <Boleto boleto={cobranca} />}
              </div>
            ))}
          </section>
        )}

        {fatura.pix && <PixCopiaECola codigo={fatura.pix} className="mt-4 max-w-xl" />}
        {fatura.status === "OPEN" && !fatura.pix && !fatura.gateway && (
          <p data-sem-pix className="mt-4 text-xs text-gray-500 print:hidden">
            Para a fatura sair com o Pix Copia e Cola, cadastre a chave Pix em Empresa &gt; Cobrança.
          </p>
        )}

        {fatura.status === "CANCELLED" && (
          <p className="mt-4 text-sm text-gray-600">
            Fatura cancelada: as cargas voltaram a ficar disponíveis e não aparecem mais aqui.
          </p>
        )}
        {fatura.notes && <p className="mt-4 text-sm text-gray-600 whitespace-pre-wrap">{fatura.notes}</p>}
      </div>
    </div>
  );
}

"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Loader2, LogIn, ShieldAlert, Users, Wallet } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { FAIXAS, FAIXA_LABEL, textoDoAviso, type Devedor, type TotaisDaCobranca } from "@/lib/cobranca";
import { AVISO_PIX_ESTATICO } from "@/lib/pix";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";

/**
 * Cobrança: quem deve, quanto e há quanto tempo, com o aviso pronto para copiar.
 *
 * A tela só lê. A baixa continua no Faturamento e no Financeiro, e o aviso não
 * é enviado por aqui: o operador copia o texto e manda por onde costuma falar
 * com o cliente.
 */

type Posicao = { hoje: string; empresa: { name: string }; totais: TotaisDaCobranca; devedores: Devedor[] };

type Carga = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; posicao: Posicao };

const FALHA = "Não foi possível carregar a cobrança.";
const FALHA_AO_COPIAR = "Não foi possível copiar. Selecione o texto e copie.";

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";

async function carregar(): Promise<Carga> {
  try {
    const res = await fetch("/api/financeiro/cobranca");
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    const corpo = await res.json().catch(() => null);
    if (!res.ok) return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA };
    return { denied: null, erro: null, posicao: corpo as Posicao };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

// O "hoje" da API é um dia do calendário do Brasil; meio-dia de lá cai no mesmo dia em qualquer fuso do navegador.
const meioDiaNoBrasil = (dia: string) => new Date(`${dia}T12:00:00-03:00`);

const atraso = (titulo: Devedor["titulos"][number]) => {
  if (!titulo.dueDate) return "sem vencimento";
  if (titulo.diasDeAtraso === 0) return "a vencer";
  return `${titulo.diasDeAtraso} ${titulo.diasDeAtraso === 1 ? "dia" : "dias"}`;
};

export default function CobrancaPage() {
  const [carga, setCarga] = useState<Carga | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copia, setCopia] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    carregar().then((resultado) => {
      if (ativo) setCarga(resultado);
    });
    return () => {
      ativo = false;
    };
  }, []);

  const tentarDeNovo = async () => {
    setCarga(null);
    setCarga(await carregar());
  };

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopia({ ok: true, texto: "Aviso copiado." });
    } catch {
      // Sem permissão ou fora de HTTPS: o texto continua na tela para copiar à mão.
      setCopia({ ok: false, texto: FALHA_AO_COPIAR });
    }
  };

  if (!carga) {
    return (
      <div className="flex items-center justify-center h-[400px]" role="status" aria-label="Carregando">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
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
              Entre de novo para ver a cobrança.{" "}
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

  if (carga.erro !== null) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
        <span>{carga.erro}</span>
        <button onClick={() => void tentarDeNovo()} className="font-medium underline">
          Tentar de novo
        </button>
      </div>
    );
  }

  const { posicao } = carga;
  const { totais, devedores } = posicao;

  return (
    <div className="space-y-3 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Cobrança</h1>
        <p className="hidden md:block text-gray-500 text-sm mt-1">Quem deve, quanto e há quanto tempo</p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-4">
        <Cartao rotulo="Em aberto" valor={formatCurrency(totais.emAberto)} icone={<Wallet className="w-5 h-5 text-blue-600" />} />
        <Cartao rotulo="Vencido" valor={formatCurrency(totais.vencido)} alerta={totais.vencido > 0} icone={<AlertTriangle className="w-5 h-5 text-red-600" />} />
        <Cartao rotulo="A vencer" valor={formatCurrency(totais.aVencer)} icone={<CalendarClock className="w-5 h-5 text-amber-600" />} />
        <Cartao rotulo="Clientes em atraso" valor={String(totais.devedoresEmAtraso)} alerta={totais.devedoresEmAtraso > 0} icone={<Users className="w-5 h-5 text-red-600" />} />
      </div>

      <dl className={`${CARD} grid grid-cols-3 gap-x-2 gap-y-2 p-3 md:gap-4 md:p-5 lg:grid-cols-5`}>
        {FAIXAS.map((faixa) => (
          <div key={faixa} data-faixa={faixa}>
            <dt className="text-[11px] md:text-xs leading-tight text-gray-500">{FAIXA_LABEL[faixa]}</dt>
            <dd className="mt-0.5 md:mt-1 text-sm md:text-base font-semibold text-gray-900 dark:text-white">{formatCurrency(totais.porFaixa[faixa])}</dd>
          </div>
        ))}
      </dl>

      <div className={`${CARD} overflow-hidden`}>
        {devedores.length === 0 ? (
          <p className="p-10 text-center text-gray-500">Nenhum valor a receber em aberto.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="block md:table w-full text-sm">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Devedor</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Vencido</th>
                  <th className="px-4 py-3 font-medium text-right">Maior atraso</th>
                  <th className="px-4 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {devedores.map((devedor) => {
                  const expandido = aberto === devedor.chave;
                  const comAviso = aviso === devedor.chave;
                  return (
                    <Fragment key={devedor.chave}>
                      <tr data-devedor={devedor.chave} className="grid grid-cols-3 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                        <td className="col-span-3 min-w-0 md:table-cell md:px-4 md:py-3">
                          <button
                            aria-expanded={expandido}
                            onClick={() => setAberto(expandido ? null : devedor.chave)}
                            className="font-medium text-gray-900 dark:text-white hover:underline text-left"
                          >
                            {devedor.nome}
                          </button>
                          <span className="block text-xs text-gray-500">
                            {devedor.titulos.length} {devedor.titulos.length === 1 ? "título" : "títulos"}
                          </span>
                        </td>
                        <td data-rotulo="Total" className="min-w-0 md:table-cell md:px-4 md:py-3 md:text-right text-gray-900 dark:text-white before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">{formatCurrency(devedor.total)}</td>
                        <td data-rotulo="Vencido" className={`min-w-0 md:table-cell md:px-4 md:py-3 md:text-right before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none ${devedor.vencido > 0 ? "text-red-600 font-medium" : "text-gray-600 dark:text-gray-300"}`}>
                          {formatCurrency(devedor.vencido)}
                        </td>
                        <td data-rotulo="Maior atraso" className="min-w-0 md:table-cell md:px-4 md:py-3 md:text-right text-gray-600 dark:text-gray-300 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">
                          {devedor.maiorAtraso === 0 ? "-" : `${devedor.maiorAtraso} ${devedor.maiorAtraso === 1 ? "dia" : "dias"}`}
                        </td>
                        <td className="col-span-3 min-w-0 md:table-cell md:px-4 md:py-3 md:text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              setCopia(null);
                              setAviso(comAviso ? null : devedor.chave);
                            }}
                            className="text-blue-600 hover:underline"
                          >
                            Aviso de cobrança
                          </button>
                        </td>
                      </tr>

                      {comAviso && (
                        <tr data-aviso={devedor.chave} className="block md:table-row">
                          <td colSpan={5} className="block md:table-cell px-3 py-3 md:px-4 md:py-4 bg-gray-50 dark:bg-gray-950">
                            <Aviso
                              texto={textoDoAviso({ empresa: posicao.empresa, devedor, hoje: meioDiaNoBrasil(posicao.hoje) })}
                              copia={copia}
                              aoCopiar={copiar}
                              comPix={devedor.titulos.some((titulo) => titulo.pix)}
                            />
                          </td>
                        </tr>
                      )}

                      {expandido && (
                        <tr data-titulos={devedor.chave} className="block md:table-row">
                          <td colSpan={5} className="block md:table-cell px-3 py-3 md:px-4 md:py-4 overflow-x-auto bg-gray-50 dark:bg-gray-950">
                            <table className="w-full text-sm">
                              <thead className="text-left text-gray-500">
                                <tr>
                                  <th className="py-1 pr-4 font-medium">Título</th>
                                  <th className="py-1 pr-4 font-medium">Vencimento</th>
                                  <th className="py-1 pr-4 font-medium">Atraso</th>
                                  <th className="py-1 font-medium text-right">Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {devedor.titulos.map((titulo) => (
                                  <tr key={titulo.id} data-titulo={titulo.id}>
                                    <td className="py-1 pr-4 text-gray-900 dark:text-white">
                                      {titulo.description}
                                      {titulo.invoice && (
                                        <Link href={`/dashboard/faturamento/${titulo.invoice.id}`} className="ml-2 text-xs text-blue-600 hover:underline">
                                          ver fatura
                                        </Link>
                                      )}
                                    </td>
                                    <td className="py-1 pr-4 text-gray-600 dark:text-gray-300">{formatCalendarDate(titulo.dueDate)}</td>
                                    <td className={`py-1 pr-4 ${titulo.diasDeAtraso > 0 ? "text-red-600" : "text-gray-600 dark:text-gray-300"}`}>
                                      {atraso(titulo)}
                                    </td>
                                    <td className="py-1 text-right text-gray-900 dark:text-white">{formatCurrency(titulo.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        A baixa é feita no Faturamento (título de fatura) ou no Financeiro (lançamento manual). Título pago sai desta lista.
      </p>
    </div>
  );
}

function Aviso({
  texto,
  copia,
  aoCopiar,
  comPix,
}: {
  texto: string;
  /** O aviso leva o Pix Copia e Cola de cada título (chave cadastrada em Empresa). */
  comPix: boolean;
  copia: { ok: boolean; texto: string } | null;
  aoCopiar: (texto: string) => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <textarea
        readOnly
        aria-label="Texto do aviso de cobrança"
        value={texto}
        rows={Math.min(16, texto.split("\n").length + 1)}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm dark:text-white"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void aoCopiar(texto)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium">
          Copiar
        </button>
        {copia && (
          <p role="status" className={`text-sm ${copia.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {copia.texto}
          </p>
        )}
        <p className="text-xs text-gray-500">O sistema não envia o aviso: copie e mande pelo canal que você usa com o cliente.</p>
      </div>
      <p data-pix-do-aviso className="text-xs text-gray-500">
        {comPix
          ? `O aviso leva o Pix Copia e Cola de cada título, com o valor dele. ${AVISO_PIX_ESTATICO}`
          : "Para o aviso levar o Pix Copia e Cola de cada título, cadastre a chave Pix em Empresa > Cobrança."}
      </p>
    </div>
  );
}

function Cartao({ rotulo, valor, icone, alerta = false }: { rotulo: string; valor: string; icone: React.ReactNode; alerta?: boolean }) {
  return (
    <div className={`${CARD} p-3 md:p-5`} data-cartao={rotulo}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs md:text-sm leading-tight text-gray-500">{rotulo}</p>
        {icone}
      </div>
      <p className={`mt-1 md:mt-2 text-lg md:text-xl font-bold ${alerta ? "text-red-600" : "text-gray-900 dark:text-white"}`}>{valor}</p>
    </div>
  );
}

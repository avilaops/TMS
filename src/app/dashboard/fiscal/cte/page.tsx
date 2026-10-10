"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, FileText, Loader2, X } from "lucide-react";
import { COLLECTION_STATUS, formatCurrency, formatWeight, statusBadge } from "@/lib/format";
import { cteRegistrado, pendenciasParaCte, type CargaParaCte } from "@/lib/nfe";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, LABEL, ROTULO, erroDe } from "../../deposito/comum";
import { Negado, chaveEmBlocos } from "../comum";

/**
 * CT-e: este sistema ainda NÃO emite. A tela lista as cargas que já saíram (em
 * rota ou entregues) com os dados que um CT-e precisa, todas como "não
 * emitido", e deixa registrar o número e a chave de um CT-e emitido em outro
 * sistema. Nada daqui fala com a SEFAZ.
 */

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; cargas: CargaParaCte[] };

const FALHA = "Não foi possível carregar as cargas.";
const FALHA_AO_REGISTRAR = "Não foi possível registrar o CT-e.";

async function carregar(): Promise<Dados> {
  try {
    const res = await fetch("/api/fiscal/cte");
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, cargas: (await res.json()) as CargaParaCte[] };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

function Registro({ carga, aoFechar, aoGravar }: { carga: CargaParaCte; aoFechar: () => void; aoGravar: (carga: CargaParaCte) => void }) {
  const registrado = cteRegistrado(carga);
  const [numero, setNumero] = useState(carga.cteNumber === null ? "" : String(carga.cteNumber));
  const [chave, setChave] = useState(carga.cteKey ?? "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const gravar = async (cteNumber: string | null, cteKey: string | null) => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch("/api/fiscal/cte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: carga.id, cteNumber, cteKey }),
      });
      if (!res.ok) {
        setErro(await erroDe(res, FALHA_AO_REGISTRAR));
        return;
      }
      aoGravar((await res.json()) as CargaParaCte);
    } catch {
      setErro(FALHA_AO_REGISTRAR);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50" role="dialog" aria-modal="true" aria-label="Registrar CT-e emitido em outro sistema">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void gravar(numero, chave);
        }}
        className="flex flex-col w-full md:max-w-lg bg-white dark:bg-gray-900 md:rounded-2xl shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold font-outfit text-gray-900 dark:text-white">Registrar CT-e</h2>
            <p className="text-xs text-gray-500 truncate">
              Carga <span className="font-mono">{carga.trackingCode ?? "sem código"}</span> · {carga.client.tradeName || carga.client.companyName}
            </p>
          </div>
          <button type="button" onClick={aoFechar} className="p-2 text-gray-500" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Informe o número e a chave de um CT-e que já foi emitido e autorizado em outro sistema. Este registro só anota os dados na carga: nada é enviado à SEFAZ.
          </p>
          {erro && (
            <p role="alert" className="px-3 py-2 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
              {erro}
            </p>
          )}
          <label className="block">
            <span className={LABEL}>Número do CT-e</span>
            <input required inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className={LABEL}>Chave de acesso do CT-e (44 dígitos)</span>
            <textarea required rows={2} inputMode="numeric" value={chave} onChange={(e) => setChave(e.target.value)} className={`${INPUT} font-mono resize-none`} />
          </label>
          <button type="submit" disabled={enviando} className={`${BOTAO_AZUL} w-full`}>
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar registro
          </button>
          {registrado && (
            <button type="button" disabled={enviando} onClick={() => void gravar(null, null)} className={`${BOTAO_CLARO} w-full`}>
              Desfazer o registro
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default function CtePage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [registrando, setRegistrando] = useState<CargaParaCte | null>(null);

  useEffect(() => {
    let ativo = true;
    carregar().then((resultado) => {
      if (ativo) setDados(resultado);
    });
    return () => {
      ativo = false;
    };
  }, []);

  if (dados && dados.denied !== null) return <Negado motivo={dados.denied} />;

  const cargas = dados && dados.denied === null && dados.erro === null ? dados.cargas : null;

  const aoGravar = (gravada: CargaParaCte) => {
    setDados((atual) =>
      atual && atual.denied === null && atual.erro === null
        ? { ...atual, cargas: atual.cargas.map((carga) => (carga.id === gravada.id ? gravada : carga)) }
        : atual,
    );
    setRegistrando(null);
  };

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">CT-e</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Cargas em rota ou entregues e o registro do CT-e emitido em outro sistema</p>
        </div>
        <Link href="/dashboard/fiscal" className={`${BOTAO_CLARO} shrink-0`}>
          <ArrowLeft className="w-4 h-4" />
          Notas fiscais
        </Link>
      </div>

      <div data-aviso-cte role="note" className="flex items-start gap-2 px-3 py-2.5 text-sm text-amber-900 border border-amber-300 rounded-xl bg-amber-50">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
        <p>
          <strong>Este sistema ainda não emite CT-e.</strong> A emissão não está ligada à SEFAZ: falta o certificado digital A1 da transportadora, o credenciamento e a homologação.
          <span className="hidden md:inline"> Use os dados abaixo no seu emissor e, depois de autorizado, registre aqui o número e a chave.</span>
        </p>
      </div>

      {!dados && (
        <div className="flex items-center justify-center h-[200px]" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {dados && dados.denied === null && dados.erro !== null && (
        <p role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {dados.erro}
        </p>
      )}

      {cargas && (
        <div className={`${CARD} overflow-hidden`}>
          {cargas.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p>Nenhuma carga em rota ou entregue.</p>
            </div>
          ) : (
            <table className="block md:table w-full text-sm">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Carga</th>
                  <th className="px-4 py-3 font-medium">Remetente e destinatário</th>
                  <th className="px-4 py-3 font-medium">Rota</th>
                  <th className="px-4 py-3 font-medium">Volumes e peso</th>
                  <th className="px-4 py-3 font-medium">Mercadoria e frete</th>
                  <th className="px-4 py-3 font-medium">Chave da NF-e</th>
                  <th className="px-4 py-3 font-medium">CT-e</th>
                  <th className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {cargas.map((carga) => {
                  const registrado = cteRegistrado(carga);
                  const faltas = pendenciasParaCte(carga);
                  const selo = statusBadge(COLLECTION_STATUS, carga.status);
                  return (
                    <tr key={carga.id} data-carga={carga.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{carga.client.tradeName || carga.client.companyName}</p>
                        <p className="text-xs text-gray-500">
                          <span className="font-mono">{carga.trackingCode ?? "sem código"}</span> · {selo.label}
                        </p>
                      </td>
                      <td data-rotulo="Remetente e destinatário" className={`col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        <span className="block truncate">{carga.sender}</span>
                        <span className="block truncate">{carga.receiver}</span>
                      </td>
                      <td data-rotulo="Rota" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        <span className="block truncate">{carga.origin}</span>
                        <span className="block truncate">{carga.destination}</span>
                      </td>
                      <td data-rotulo="Volumes e peso" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        {carga.volumes} · {formatWeight(carga.weight)}
                      </td>
                      <td data-rotulo="Mercadoria e frete" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        <span className="block">{formatCurrency(carga.invoiceValue)}</span>
                        <span className="block text-xs text-gray-500">frete {carga.freightValue === null ? "a cotar" : formatCurrency(carga.freightValue)}</span>
                      </td>
                      <td data-rotulo="Chave da NF-e" className={`min-w-0 md:table-cell md:px-4 md:py-3 ${ROTULO}`}>
                        {carga.invoiceKey ? (
                          <span className="block font-mono text-[11px] text-gray-600 dark:text-gray-300 break-all md:max-w-[12rem]">{carga.invoiceKey}</span>
                        ) : (
                          <span className="text-amber-700">não informada</span>
                        )}
                      </td>
                      <td data-rotulo="CT-e" className={`min-w-0 md:table-cell md:px-4 md:py-3 ${ROTULO}`}>
                        {registrado ? (
                          <>
                            <span data-cte="registrado" className="inline-block text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 whitespace-nowrap">
                              Registrado nº {carga.cteNumber}
                            </span>
                            <span className="block mt-1 font-mono text-[10px] text-gray-500 break-all md:max-w-[12rem]">{chaveEmBlocos(carga.cteKey ?? "")}</span>
                          </>
                        ) : (
                          <>
                            <span data-cte="nao-emitido" className="inline-block text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 whitespace-nowrap">
                              Não emitido
                            </span>
                            {faltas.length > 0 && <span className="block mt-1 text-[11px] text-amber-700">Falta: {faltas.join(", ")}</span>}
                          </>
                        )}
                      </td>
                      <td className="min-w-0 md:table-cell md:px-4 md:py-3 text-right md:text-left">
                        <button type="button" onClick={() => setRegistrando(carga)} className="text-sm font-medium text-blue-600 hover:underline">
                          {registrado ? "Alterar registro" : "Registrar CT-e"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {registrando && <Registro key={registrando.id} carga={registrando} aoFechar={() => setRegistrando(null)} aoGravar={aoGravar} />}
    </div>
  );
}

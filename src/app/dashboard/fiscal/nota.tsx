"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Loader2, X } from "lucide-react";
import { COLLECTION_STATUS, formatCurrency, formatDate, formatDocument, formatWeight, statusBadge } from "@/lib/format";
import { cidadeUf, type CargaDaNota, type NotaImportada, type SugestaoDeCarga } from "@/lib/nfe";
import { BOTAO_AZUL, BOTAO_CLARO, INPUT, LABEL, erroDe } from "../deposito/comum";
import { chaveEmBlocos, numeroDaNota } from "./comum";

/**
 * Uma nota importada: o que o sistema leu do XML e, enquanto ela não tem
 * carga, as duas saídas: confirmar a carga sugerida (criada pelo mesmo caminho
 * do painel de minutas) ou ligar a nota a uma carga que já existe, pelo código
 * de rastreio. No celular ocupa a tela inteira.
 */

export type NotaAberta = { nota: NotaImportada; sugestao: SugestaoDeCarga | null; cargaComAChave: CargaDaNota | null };

export type ClienteDaLista = { id: string; companyName: string; tradeName: string | null; cnpj: string; active: boolean };

type Aba = "criar" | "ligar";

type Form = { clientId: string; sender: string; receiver: string; origin: string; destination: string; volumes: string; weight: string };

const paraForm = (sugestao: SugestaoDeCarga | null): Form => ({
  clientId: sugestao?.clientId ?? "",
  sender: sugestao?.sender ?? "",
  receiver: sugestao?.receiver ?? "",
  origin: sugestao?.origin ?? "",
  destination: sugestao?.destination ?? "",
  volumes: sugestao?.volumes == null ? "" : String(sugestao.volumes),
  weight: sugestao?.weight == null ? "" : String(sugestao.weight),
});

const FALHA_AO_CRIAR = "Não foi possível criar a carga.";
const FALHA_AO_LIGAR = "Não foi possível ligar a nota à carga.";

function Parte({ rotulo, nome, documento, lugar }: { rotulo: string; nome: string | null; documento: string | null; lugar: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-tight text-gray-500">{rotulo}</dt>
      <dd className="text-sm font-medium text-gray-900 dark:text-white truncate">{nome ?? "não informado"}</dd>
      <dd className="text-xs text-gray-500 truncate">
        {documento ? formatDocument(documento) : "sem documento"}
        {lugar ? ` · ${lugar}` : ""}
      </dd>
    </div>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-tight text-gray-500">{rotulo}</dt>
      <dd className="text-sm text-gray-900 dark:text-white truncate">{valor}</dd>
    </div>
  );
}

export function PainelDaNota({
  aberta,
  clientes,
  aoFechar,
  aoMudar,
}: {
  aberta: NotaAberta;
  clientes: ClienteDaLista[];
  aoFechar: () => void;
  /** A nota ganhou carga: quem abriu o painel atualiza a lista. */
  aoMudar: (nota: NotaImportada) => void;
}) {
  const { nota, sugestao, cargaComAChave } = aberta;
  const [aba, setAba] = useState<Aba>(cargaComAChave ? "ligar" : "criar");
  const [form, setForm] = useState<Form>(() => paraForm(sugestao));
  const [codigo, setCodigo] = useState(cargaComAChave?.trackingCode ?? "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState("");

  const campo = (nome: keyof Form) => ({
    value: form[nome],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [nome]: e.target.value }),
  });

  const enviar = async (caminho: "carga" | "ligar", corpo: unknown, falha: string, sucesso: (nota: NotaImportada) => string) => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch(`/api/fiscal/notas/${nota.id}/${caminho}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!res.ok) {
        setErro(await erroDe(res, falha));
        return;
      }
      const resposta = (await res.json()) as { nota: NotaImportada };
      setFeito(sucesso(resposta.nota));
      aoMudar(resposta.nota);
    } catch {
      setErro(falha);
    } finally {
      setEnviando(false);
    }
  };

  const criar = (e: React.FormEvent) => {
    e.preventDefault();
    void enviar("carga", form, FALHA_AO_CRIAR, (ligada) => `Carga criada com o código ${ligada.collection?.trackingCode ?? ""}.`);
  };

  const ligar = (e: React.FormEvent) => {
    e.preventDefault();
    void enviar("ligar", { trackingCode: codigo }, FALHA_AO_LIGAR, (ligada) => `Nota ligada à carga ${ligada.collection?.trackingCode ?? ""}.`);
  };

  const carga = nota.collection;
  const selo = carga ? statusBadge(COLLECTION_STATUS, carga.status) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50" role="dialog" aria-modal="true" aria-label={`NF-e ${numeroDaNota(nota)}`}>
      <div data-nota={nota.id} className="flex flex-col w-full md:max-w-2xl md:max-h-[90vh] bg-white dark:bg-gray-900 md:rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold font-outfit text-gray-900 dark:text-white truncate">NF-e {numeroDaNota(nota)}</h2>
            <p className="font-mono text-[10px] md:text-xs text-gray-500 truncate" title={nota.accessKey}>
              {chaveEmBlocos(nota.accessKey)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a href={`/api/fiscal/notas/${nota.id}/xml`} download className="p-2 text-blue-600" aria-label="Baixar o XML" title="Baixar o XML">
              <Download className="w-5 h-5" />
            </a>
            <button type="button" onClick={aoFechar} className="p-2 text-gray-500" aria-label="Fechar">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Parte rotulo="Emitente" nome={nota.issuerName} documento={nota.issuerTaxId} lugar={cidadeUf(nota.issuerCity, nota.issuerState)} />
            <Parte rotulo="Destinatário" nome={nota.recipientName} documento={nota.recipientTaxId} lugar={cidadeUf(nota.recipientCity, nota.recipientState)} />
            <Dado rotulo="Valor da nota" valor={formatCurrency(nota.totalValue)} />
            <Dado rotulo="Emissão" valor={formatDate(nota.issuedAt)} />
            <Dado rotulo="Volumes e peso" valor={`${nota.volumes ?? "-"} · ${formatWeight(nota.grossWeight)}`} />
            <Dado rotulo="Natureza" valor={nota.operationNature ?? "-"} />
          </dl>

          {feito && (
            <p role="status" className="px-3 py-2 text-sm text-emerald-800 border border-emerald-200 rounded-lg bg-emerald-50">
              {feito}
            </p>
          )}

          {carga && (
            <div data-carga={carga.id} className="px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl">
              <p className="text-[11px] text-gray-500">Carga desta nota</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                <span className="font-mono">{carga.trackingCode ?? "sem código"}</span> · {carga.origin} → {carga.destination}
              </p>
              <div className="flex items-center justify-between gap-3 mt-1">
                {selo && <span className={`text-xs px-2 py-0.5 rounded-full border ${selo.className}`}>{selo.label}</span>}
                <Link href="/dashboard/coletas" className="text-sm font-medium text-blue-600 hover:underline">
                  Ver nas minutas
                </Link>
              </div>
            </div>
          )}

          {!carga && (
            <>
              {sugestao && sugestao.avisos.length > 0 && aba === "criar" && (
                <ul data-avisos className="px-3 py-2 text-xs text-amber-800 border border-amber-200 rounded-lg bg-amber-50 space-y-0.5">
                  {sugestao.avisos.map((aviso) => (
                    <li key={aviso}>{aviso}</li>
                  ))}
                </ul>
              )}

              {cargaComAChave && (
                <p data-carga-com-a-chave className="px-3 py-2 text-xs text-sky-800 border border-sky-200 rounded-lg bg-sky-50">
                  A carga {cargaComAChave.trackingCode ?? "sem código"} já tem a chave desta nota. Ligue a nota a ela.
                </p>
              )}

              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800" role="tablist">
                {(["criar", "ligar"] as const).map((qual) => (
                  <button
                    key={qual}
                    type="button"
                    role="tab"
                    aria-selected={aba === qual}
                    onClick={() => {
                      setAba(qual);
                      setErro("");
                    }}
                    className={`py-1.5 text-sm rounded-lg ${aba === qual ? "bg-white dark:bg-gray-900 font-medium text-gray-900 dark:text-white shadow-sm" : "text-gray-600 dark:text-gray-400"}`}
                  >
                    {qual === "criar" ? "Criar carga" : "Ligar a uma carga"}
                  </button>
                ))}
              </div>

              {erro && (
                <p role="alert" className="px-3 py-2 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
                  {erro}
                </p>
              )}

              {aba === "criar" ? (
                <form onSubmit={criar} className="space-y-2">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
                    <label className="col-span-2 block">
                      <span className={LABEL}>Cliente pagador</span>
                      <select required className={INPUT} {...campo("clientId")}>
                        <option value="">Escolha o cliente</option>
                        {clientes.map((cliente) => (
                          <option key={cliente.id} value={cliente.id}>
                            {cliente.tradeName || cliente.companyName} ({formatDocument(cliente.cnpj)})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block min-w-0">
                      <span className={LABEL}>Remetente</span>
                      <input required maxLength={200} className={INPUT} {...campo("sender")} />
                    </label>
                    <label className="block min-w-0">
                      <span className={LABEL}>Destinatário</span>
                      <input required maxLength={200} className={INPUT} {...campo("receiver")} />
                    </label>
                    <label className="block min-w-0">
                      <span className={LABEL}>Origem</span>
                      <input required maxLength={200} placeholder="Cidade - UF" className={INPUT} {...campo("origin")} />
                    </label>
                    <label className="block min-w-0">
                      <span className={LABEL}>Destino</span>
                      <input required maxLength={200} placeholder="Cidade - UF" className={INPUT} {...campo("destination")} />
                    </label>
                    <label className="block min-w-0">
                      <span className={LABEL}>Volumes</span>
                      <input required inputMode="numeric" className={INPUT} {...campo("volumes")} />
                    </label>
                    <label className="block min-w-0">
                      <span className={LABEL}>Peso (kg)</span>
                      <input required inputMode="decimal" className={INPUT} {...campo("weight")} />
                    </label>
                  </div>
                  <p className="text-xs text-gray-500">
                    Valor da NF ({formatCurrency(nota.totalValue)}) e chave vêm da nota. O frete sai da tabela do cliente.
                  </p>
                  <button type="submit" disabled={enviando} className={`${BOTAO_AZUL} w-full`}>
                    {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
                    Criar carga
                  </button>
                </form>
              ) : (
                <form onSubmit={ligar} className="space-y-2">
                  <label className="block">
                    <span className={LABEL}>Código de rastreio da carga</span>
                    <input
                      required
                      inputMode="numeric"
                      placeholder="10 dígitos"
                      value={codigo}
                      onChange={(e) => setCodigo(e.target.value)}
                      className={`${INPUT} font-mono`}
                    />
                  </label>
                  <p className="text-xs text-gray-500">Se a carga já tem chave de NF-e, ela precisa ser a desta nota.</p>
                  <button type="submit" disabled={enviando} className={`${BOTAO_AZUL} w-full`}>
                    {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
                    Ligar a nota à carga
                  </button>
                </form>
              )}
            </>
          )}

          {carga && (
            <button type="button" onClick={aoFechar} className={`${BOTAO_CLARO} w-full`}>
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

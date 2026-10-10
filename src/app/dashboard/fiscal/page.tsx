"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, FileUp, Loader2, XCircle } from "lucide-react";
import { formatCurrency, formatDate, formatDocument } from "@/lib/format";
import { LIMITE_DO_XML_BYTES, XML_GRANDE, type NotaImportada } from "@/lib/nfe";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, ROTULO, erroDe } from "../deposito/comum";
import { Negado, numeroDaNota } from "./comum";
import { PainelDaNota, type ClienteDaLista, type NotaAberta } from "./nota";

/**
 * Notas fiscais: o operador envia um ou vários XML de NF-e; o sistema lê,
 * guarda a nota com o XML original e sugere a carga. A lista mostra as notas
 * importadas, com a carga a que cada uma está ligada, e a busca é por chave,
 * número, CNPJ ou razão social. Abrir uma nota mostra o que foi lido e, se ela
 * ainda não tem carga, deixa criar a carga ou ligar a uma que já existe.
 */

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; notas: NotaImportada[] };

/** O que aconteceu com cada arquivo enviado. */
type Envio = { arquivo: string; nota: NotaImportada | null; aberta: NotaAberta | null; erro: string | null };

const FALHA = "Não foi possível carregar as notas.";
const FALHA_AO_IMPORTAR = "Não foi possível importar este arquivo.";
const FALHA_AO_ABRIR = "Não foi possível abrir a nota.";

async function carregar(busca: string): Promise<Dados> {
  try {
    const res = await fetch(`/api/fiscal/notas${busca.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : ""}`);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, notas: (await res.json()) as NotaImportada[] };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

async function importar(arquivo: File): Promise<Envio> {
  const envio: Envio = { arquivo: arquivo.name, nota: null, aberta: null, erro: null };
  // O servidor confere de novo; aqui é só para não subir um arquivo que já se sabe recusado.
  if (arquivo.size > LIMITE_DO_XML_BYTES) return { ...envio, erro: XML_GRANDE };
  try {
    const res = await fetch("/api/fiscal/notas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xml: await arquivo.text() }),
    });
    if (res.status === 409) {
      const corpo = (await res.json()) as { error: string; nota: NotaImportada | null };
      return { ...envio, nota: corpo.nota, erro: corpo.error };
    }
    if (!res.ok) return { ...envio, erro: await erroDe(res, FALHA_AO_IMPORTAR) };
    const aberta = (await res.json()) as NotaAberta;
    return { ...envio, nota: aberta.nota, aberta };
  } catch {
    return { ...envio, erro: FALHA_AO_IMPORTAR };
  }
}

export default function NotasFiscaisPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [busca, setBusca] = useState("");
  const [versao, setVersao] = useState(0);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [importando, setImportando] = useState(false);
  const [aberta, setAberta] = useState<NotaAberta | null>(null);
  const [aviso, setAviso] = useState("");
  const [clientes, setClientes] = useState<ClienteDaLista[]>([]);
  const arquivos = useRef<HTMLInputElement>(null);

  // A busca é feita no servidor; a espera evita uma consulta por tecla.
  useEffect(() => {
    let ativo = true;
    const espera = setTimeout(
      () => {
        carregar(busca).then((resultado) => {
          if (ativo) setDados(resultado);
        });
      },
      busca ? 300 : 0,
    );
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [busca, versao]);

  // Clientes ativos para o seletor do pagador.
  useEffect(() => {
    let ativo = true;
    fetch("/api/clientes")
      .then((res) => (res.ok ? (res.json() as Promise<ClienteDaLista[]>) : []))
      .then((lista) => {
        if (ativo) setClientes(lista.filter((cliente) => cliente.active));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);

  const aoEscolher = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const escolhidos = [...(e.target.files ?? [])];
    e.target.value = "";
    if (escolhidos.length === 0) return;

    setImportando(true);
    setAviso("");
    const feitos: Envio[] = [];
    // Um de cada vez: cada nota é uma gravação, e a ordem da lista fica a do envio.
    for (const arquivo of escolhidos) feitos.push(await importar(arquivo));
    setEnvios(feitos);
    setImportando(false);
    setVersao((v) => v + 1);

    // Um arquivo só, lido sem erro: vai direto para a confirmação da carga.
    if (feitos.length === 1 && feitos[0].aberta) setAberta(feitos[0].aberta);
  };

  const abrir = async (id: string) => {
    setAviso("");
    try {
      const res = await fetch(`/api/fiscal/notas/${id}`);
      if (!res.ok) {
        setAviso(await erroDe(res, FALHA_AO_ABRIR));
        return;
      }
      setAberta((await res.json()) as NotaAberta);
    } catch {
      setAviso(FALHA_AO_ABRIR);
    }
  };

  const aoMudar = (nota: NotaImportada) => {
    setAberta({ nota, sugestao: null, cargaComAChave: null });
    setEnvios((atuais) => atuais.map((envio) => (envio.nota?.id === nota.id ? { ...envio, nota, aberta: null } : envio)));
    setVersao((v) => v + 1);
  };

  if (dados && dados.denied !== null) return <Negado motivo={dados.denied} />;

  const notas = dados && dados.denied === null && dados.erro === null ? dados.notas : null;

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Notas fiscais</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Importe o XML da NF-e para guardar a nota e criar a carga</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href="/dashboard/fiscal/cte" className={BOTAO_CLARO}>
            CT-e
          </Link>
          <button type="button" disabled={importando} onClick={() => arquivos.current?.click()} className={BOTAO_AZUL}>
            {importando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            Importar XML
          </button>
          <input
            ref={arquivos}
            type="file"
            multiple
            accept=".xml,text/xml,application/xml"
            aria-label="Arquivos XML de NF-e"
            onChange={(e) => void aoEscolher(e)}
            className="hidden"
          />
        </div>
      </div>

      {aviso && (
        <p role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {aviso}
        </p>
      )}

      {envios.length > 0 && (
        <div data-envios className={`${CARD} overflow-hidden`}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {envios.filter((envio) => envio.erro === null).length} de {envios.length} importado(s)
            </p>
            <button type="button" onClick={() => setEnvios([])} className="text-sm text-blue-600 hover:underline">
              Limpar
            </button>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {envios.map((envio, i) => (
              <li key={`${envio.arquivo}-${i}`} data-envio={envio.erro === null ? "ok" : "erro"} className="flex items-start gap-2 px-3 py-2">
                {envio.erro === null ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 dark:text-white truncate">
                    {envio.nota && envio.erro === null ? `NF-e ${numeroDaNota(envio.nota)} · ${envio.nota.issuerName}` : envio.arquivo}
                  </p>
                  <p className={`text-xs ${envio.erro === null ? "text-gray-500" : "text-red-700"}`}>
                    {envio.erro ?? (envio.nota?.collection ? `Carga ${envio.nota.collection.trackingCode ?? ""}` : `${formatCurrency(envio.nota?.totalValue)} · sem carga ainda`)}
                  </p>
                </div>
                {envio.nota && (
                  <button type="button" onClick={() => void abrir(envio.nota!.id)} className="shrink-0 text-sm font-medium text-blue-600 hover:underline">
                    {envio.erro === null && !envio.nota.collection ? "Criar carga" : "Abrir"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        type="search"
        aria-label="Buscar por chave, número, CNPJ ou razão social"
        placeholder="Chave, número, CNPJ ou nome"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className={INPUT}
      />

      {!dados && (
        <div className="flex items-center justify-center h-[200px]" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {dados && dados.denied === null && dados.erro !== null && (
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {dados.erro}{" "}
          <button type="button" onClick={() => setVersao((v) => v + 1)} className="font-medium underline">
            Tentar de novo
          </button>
        </div>
      )}

      {notas && (
        <div className={`${CARD} overflow-hidden`}>
          {notas.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p>{busca.trim() ? "Nenhuma nota com esta busca." : "Nenhuma nota importada ainda. Envie o XML de uma NF-e."}</p>
            </div>
          ) : (
            <table className="block md:table w-full text-sm">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Nota</th>
                  <th className="px-4 py-3 font-medium">Emitente</th>
                  <th className="px-4 py-3 font-medium">Destinatário</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Carga</th>
                  <th className="px-4 py-3 font-medium">Importada em</th>
                  <th className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {notas.map((nota) => (
                  <tr key={nota.id} data-nota={nota.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                      <p className="font-medium text-gray-900 dark:text-white">NF-e {numeroDaNota(nota)}</p>
                      <p className="font-mono text-[11px] text-gray-500 truncate md:max-w-[14rem]" title={nota.accessKey}>
                        {nota.accessKey}
                      </p>
                    </td>
                    <td data-rotulo="Emitente" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                      <span className="block truncate">{nota.issuerName}</span>
                      <span className="block text-xs text-gray-500">{formatDocument(nota.issuerTaxId)}</span>
                    </td>
                    <td data-rotulo="Destinatário" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                      <span className="block truncate">{nota.recipientName ?? "-"}</span>
                      <span className="block text-xs text-gray-500">{nota.recipientTaxId ? formatDocument(nota.recipientTaxId) : "-"}</span>
                    </td>
                    <td data-rotulo="Valor" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap ${ROTULO}`}>
                      {formatCurrency(nota.totalValue)}
                    </td>
                    <td data-rotulo="Carga" className={`min-w-0 md:table-cell md:px-4 md:py-3 ${ROTULO}`}>
                      {nota.collection ? (
                        <Link href="/dashboard/coletas" className="font-mono text-blue-600 hover:underline" title={`${nota.collection.origin} → ${nota.collection.destination}`}>
                          {nota.collection.trackingCode ?? "sem código"}
                        </Link>
                      ) : (
                        <span className="text-amber-700">sem carga</span>
                      )}
                    </td>
                    <td data-rotulo="Importada em" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap ${ROTULO}`}>
                      {formatDate(nota.createdAt)}
                    </td>
                    <td className="min-w-0 md:table-cell md:px-4 md:py-3">
                      <div className="flex justify-end md:justify-start gap-3 text-sm">
                        <button type="button" onClick={() => void abrir(nota.id)} className="font-medium text-blue-600 hover:underline">
                          {nota.collection ? "Abrir" : "Criar carga"}
                        </button>
                        <a href={`/api/fiscal/notas/${nota.id}/xml`} download className="text-blue-600 hover:underline">
                          XML
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {aberta && <PainelDaNota key={aberta.nota.id} aberta={aberta} clientes={clientes} aoFechar={() => setAberta(null)} aoMudar={aoMudar} />}
    </div>
  );
}

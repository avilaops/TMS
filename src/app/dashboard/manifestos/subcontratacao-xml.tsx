"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { ROTULO_DO_AMBIENTE } from "@/lib/cte";
import type { CargaDaSubcontratacao } from "@/lib/subcontratacao";
import { lerXmlDaSubcontratada, LIMITE_XML_SUBCONTRATADA, XML_SUBCONTRATADA_GRANDE, type XmlDaSubcontratada } from "@/lib/subcontratacao-xml";

type Props = { manifestId: string; cargas: CargaDaSubcontratacao[]; ocupado: boolean; aoOcupar: (valor: string | null) => void; aoImportar: () => Promise<void> };

export function ImportarXmlDaSubcontratada({ manifestId, cargas, ocupado, aoOcupar, aoImportar }: Props) {
  const [arquivo, setArquivo] = useState<{ xml: string; documento: XmlDaSubcontratada } | null>(null);
  const [carga, setCarga] = useState("");
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const leitura = useRef(0);
  const ativo = useRef(true);
  useEffect(() => { ativo.current = true; return () => { ativo.current = false; }; }, []);

  const escolherArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selecionado = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    const versao = ++leitura.current;
    setArquivo(null); setCarga(""); setErro(""); setMensagem("");
    if (!selecionado) return;
    if (selecionado.size > LIMITE_XML_SUBCONTRATADA) return setErro(XML_SUBCONTRATADA_GRANDE);
    aoOcupar("ler-xml");
    try {
      const xml = await selecionado.text();
      if (!ativo.current || versao !== leitura.current) return;
      const resultado = lerXmlDaSubcontratada(xml);
      if (!resultado.ok) setErro(resultado.erro);
      else setArquivo({ xml, documento: resultado.documento });
    } catch {
      if (ativo.current && versao === leitura.current) setErro("Não foi possível ler o arquivo XML. Escolha o arquivo novamente.");
    } finally {
      if (ativo.current && versao === leitura.current) aoOcupar(null);
    }
  };

  const importar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado || !arquivo) return;
    if (arquivo.documento.kind === "CTE" && !cargas.some((item) => item.id === carga)) return setErro("Escolha a carga que o CT-e da subcontratada cobre.");
    aoOcupar("importar-xml"); setErro(""); setMensagem("");
    try {
      const res = await fetch(`/api/manifestos/${manifestId}/subcontratacao/importar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xml: arquivo.xml, ...(arquivo.documento.kind === "CTE" ? { collectionId: carga } : {}) }) });
      const corpo = await res.json().catch(() => null);
      if (!ativo.current) return;
      if (!res.ok) setErro(typeof corpo?.error === "string" ? corpo.error : "Não foi possível importar o XML.");
      else {
        setArquivo(null); setCarga("");
        await aoImportar();
        if (ativo.current) setMensagem("XML importado. Consulte a SEFAZ para conferir a situação atual.");
      }
    } catch {
      if (ativo.current) setErro("Não foi possível importar o XML. Tente novamente.");
    } finally { if (ativo.current) aoOcupar(null); }
  };

  return (
    <form data-importar-xml onSubmit={importar} className="space-y-2 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
      <label className="block min-w-0 space-y-1">
        <span className="text-sm font-medium text-gray-900 dark:text-white">Importar XML da subcontratada</span>
        <span className="block text-xs text-gray-500">CT-e ou MDF-e completo, com protocolo. Até 1 MB.</span>
        <input type="file" accept=".xml,application/xml,text/xml" disabled={ocupado} onChange={escolherArquivo} className="block w-full min-w-0 text-xs text-gray-600 dark:text-gray-300 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-blue-700 disabled:opacity-50" />
      </label>
      {arquivo && (
        <div className="space-y-2">
          <p className="text-xs text-gray-600 dark:text-gray-300">{arquivo.documento.kind === "CTE" ? "CT-e" : "MDF-e"} · {ROTULO_DO_AMBIENTE[arquivo.documento.environment]} · {arquivo.documento.issuedAt.split("-").reverse().join("/")}{arquivo.documento.unloadState ? ` · descarga em ${arquivo.documento.unloadState}` : ""}</p>
          {arquivo.documento.kind === "CTE" && (
            <label className="block space-y-1 text-xs text-gray-700 dark:text-gray-300">Carga que o CT-e cobre
              <select name="xmlCollectionId" value={carga} onChange={(e) => setCarga(e.target.value)} disabled={ocupado} className="block w-full min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent p-2 text-sm">
                <option value="">Escolha a carga…</option>
                {cargas.map((item) => <option key={item.id} value={item.id}>{item.codigo} · {item.destino}</option>)}
              </select>
            </label>
          )}
          <p className="text-xs text-gray-500">O protocolo está no arquivo. A situação atual será conferida pela consulta à SEFAZ.</p>
          <button type="submit" disabled={ocupado} className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Importar XML
          </button>
        </div>
      )}
      {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
      {mensagem && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{mensagem}</p>}
    </form>
  );
}

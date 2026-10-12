"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { diaNoBrasil } from "@/lib/financeiro";
import { formatCalendarDate } from "@/lib/format";
import { chaveEmBlocos } from "@/lib/minuta";
import { QUEM_EMITE_O_MDFE, ROTULO_DO_DOCUMENTO, UFS_DE_DESCARGA, avisoDeMdfeEmDobro, type DocumentoDaSubcontratada, type SubcontratacaoDaViagem, type TipoDeDocumento } from "@/lib/subcontratacao";

/**
 * Os documentos da transportadora subcontratada numa viagem: o CT-e dela por
 * carga e o MDF-e dela por UF de descarregamento. Só guarda a chave e a data
 * (nada é emitido por aqui). Aparece na aba MDF-e da viagem (é a chave do
 * MDF-e dela que libera a saída quando é ela quem o emite) e na aba Frete, e
 * some quando a viagem não tem contrato de frete valendo com uma transportadora.
 *
 * `recolhido`: começa numa linha só, com o botão de abrir; aberto, avisa quem
 * o mostra (`aoAlternar`) para esconder o resto e a parte caber na tela do celular.
 */

const CAMPO =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
const ROTULO = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
const BOTAO = "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center justify-center gap-2";
const BOTAO_CLARO = "border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 px-4 py-2 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50";

const FALHA_AO_CARREGAR = "Não foi possível carregar os documentos da subcontratada.";

async function mensagemDeErro(res: Response, padrao: string): Promise<string> {
  const corpo = await res.json().catch(() => null);
  return typeof corpo?.error === "string" ? corpo.error : padrao;
}

async function buscar(manifestId: string): Promise<SubcontratacaoDaViagem | { erro: string }> {
  try {
    const res = await fetch(`/api/manifestos/${manifestId}/subcontratacao`);
    if (res.ok) return (await res.json()) as SubcontratacaoDaViagem;
    if (res.status === 403) return { erro: "Seu perfil não tem acesso aos documentos fiscais." };
    return { erro: await mensagemDeErro(res, FALHA_AO_CARREGAR) };
  } catch {
    return { erro: FALHA_AO_CARREGAR };
  }
}

const formEmBranco = () => ({ kind: "MDFE" as TipoDeDocumento, accessKey: "", collectionId: "", unloadState: "", issuedAt: diaNoBrasil(new Date()) });

export function DocumentosDaSubcontratada({
  manifestId,
  podeAlterar,
  recolhido = false,
  aoAlternar,
  aoMudar,
}: {
  manifestId: string;
  /** O perfil registra e exclui documento (capacidade `fiscal`). */
  podeAlterar: boolean;
  recolhido?: boolean;
  aoAlternar?: (aberto: boolean) => void;
  /** Um documento foi registrado ou excluído. */
  aoMudar?: () => void;
}) {
  const [dados, setDados] = useState<SubcontratacaoDaViagem | { erro: string } | null>(null);
  const [aberto, setAberto] = useState(!recolhido);
  const [form, setForm] = useState(formEmBranco);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const ler = useCallback(async () => setDados(await buscar(manifestId)), [manifestId]);

  useEffect(() => {
    let ativo = true;
    buscar(manifestId).then((lido) => {
      if (ativo) setDados(lido);
    });
    return () => {
      ativo = false;
    };
  }, [manifestId]);

  if (!dados) {
    // Recolhido, não ocupa a tela enquanto não se sabe se a viagem tem subcontratada.
    return recolhido ? null : (
      <div className="flex justify-center py-6" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }
  if ("erro" in dados) {
    return recolhido ? null : (
      <p role="alert" className="text-sm text-red-600">
        {dados.erro}
      </p>
    );
  }
  const { parceiro } = dados;
  if (!parceiro) {
    return recolhido ? null : (
      <p data-subcontratacao="sem-parceiro" className="text-sm text-gray-500">
        Esta viagem não tem frete contratado com uma transportadora parceira.
      </p>
    );
  }

  const alternar = (novo: boolean) => {
    setErro("");
    setAberto(novo);
    aoAlternar?.(novo);
  };

  const ctes = dados.cargas.reduce((soma, carga) => soma + carga.ctes.length, 0);
  const cargasComCte = dados.cargas.filter((carga) => carga.precisaDeCte);

  if (!aberto) {
    return (
      <div data-subcontratacao="resumo" className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 px-3 py-2">
        <p className="min-w-0 text-xs text-blue-900 dark:text-blue-200">
          <span className="block font-semibold truncate" title={parceiro.name}>
            Subcontratada: {parceiro.name}
          </span>
          <span className="block">
            MDF-e dela: {dados.mdfes.length} · CT-e dela: {ctes}
            {dados.semCte.length > 0 ? ` (${dados.semCte.length} carga${dados.semCte.length === 1 ? "" : "s"} sem)` : ""}
          </span>
        </p>
        <button type="button" data-abrir-subcontratacao onClick={() => alternar(true)} className={`${BOTAO_CLARO} shrink-0 bg-white dark:bg-gray-900`}>
          Documentos
        </button>
      </div>
    );
  }

  const escreve = podeAlterar && dados.viagem.status !== "CANCELLED";
  const emDobro = avisoDeMdfeEmDobro(dados.ufsEmDobro);
  // As UF da viagem primeiro; as outras continuam na lista (o destino pode não ter sido reconhecido).
  const ufs = [...dados.ufsDeDescarga, ...UFS_DE_DESCARGA.filter((uf) => !dados.ufsDeDescarga.includes(uf))];

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado("registrar");
    setErro("");
    try {
      const res = await fetch(`/api/manifestos/${manifestId}/subcontratacao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (res.ok) {
        setForm((atual) => ({ ...atual, accessKey: "" }));
        await ler();
        aoMudar?.();
      } else {
        setErro(await mensagemDeErro(res, "Erro ao registrar o documento."));
      }
    } catch {
      setErro("Erro ao registrar o documento.");
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async (documento: DocumentoDaSubcontratada) => {
    if (!confirm(`Excluir o registro deste ${ROTULO_DO_DOCUMENTO[documento.kind as TipoDeDocumento] ?? "documento"} da subcontratada?`)) return;
    setOcupado(documento.id);
    setErro("");
    try {
      const res = await fetch(`/api/manifestos/${manifestId}/subcontratacao/${documento.id}`, { method: "DELETE" });
      if (res.ok) {
        await ler();
        aoMudar?.();
      } else {
        setErro(await mensagemDeErro(res, "Erro ao excluir o documento."));
      }
    } catch {
      setErro("Erro ao excluir o documento.");
    } finally {
      setOcupado(null);
    }
  };

  const linha = (documento: DocumentoDaSubcontratada, titulo: string) => (
    <li key={`${documento.id}:${titulo}`} data-documento-da-subcontratada={documento.accessKey} className="flex items-center gap-2 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-900 dark:text-white">
          {titulo} · {formatCalendarDate(documento.issuedAt)}
        </p>
        <p className="font-mono text-[10px] text-gray-500 break-all">{chaveEmBlocos(documento.accessKey)}</p>
      </div>
      {escreve && (
        <button type="button" aria-label="Excluir documento" disabled={ocupado !== null} onClick={() => excluir(documento)} className="shrink-0 p-1 text-gray-400 hover:text-red-600 disabled:opacity-50">
          {ocupado === documento.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      )}
    </li>
  );

  return (
    <section data-subcontratacao="documentos" className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate" title={parceiro.name}>
            Subcontratada: {parceiro.name}
          </h3>
          <p className="text-[11px] leading-tight text-gray-500">Só a chave é guardada: quem emite o CT-e e o MDF-e dela é ela.</p>
        </div>
        {recolhido && (
          <button type="button" data-fechar-subcontratacao onClick={() => alternar(false)} className={`${BOTAO_CLARO} shrink-0`}>
            Voltar
          </button>
        )}
      </div>

      {dados.noVeiculoDela && (
        <p data-quem-emite className="text-[11px] leading-tight text-gray-600 dark:text-gray-400">
          {QUEM_EMITE_O_MDFE}
        </p>
      )}
      {emDobro && (
        <p data-mdfe-em-dobro role="note" className="text-[11px] leading-tight text-amber-700 dark:text-amber-400">
          {emDobro}
        </p>
      )}

      <ul data-lista="mdfe" className="divide-y divide-gray-100 dark:divide-gray-800">
        {dados.mdfes.length === 0 ? <li className="py-1 text-xs text-gray-500">Nenhum MDF-e da subcontratada registrado.</li> : dados.mdfes.map((mdfe) => linha(mdfe, `MDF-e · descarga em ${mdfe.unloadState}`))}
      </ul>
      <ul data-lista="cte" className="divide-y divide-gray-100 dark:divide-gray-800">
        {cargasComCte.flatMap((carga) =>
          carga.ctes.length === 0
            ? [
                <li key={carga.id} data-carga-sem-cte={carga.id} className="py-1 text-xs text-amber-700 dark:text-amber-400">
                  Carga {carga.codigo}: sem CT-e da subcontratada.
                </li>,
              ]
            : carga.ctes.map((cte) => linha(cte, `CT-e · carga ${carga.codigo}`)),
        )}
      </ul>

      {erro && (
        <p role="alert" className="text-sm text-red-600">
          {erro}
        </p>
      )}

      {escreve && (
        <form onSubmit={registrar} data-registrar-documento className="grid grid-cols-2 gap-x-3 gap-y-1.5 md:gap-3 border-t border-gray-100 dark:border-gray-800 pt-2">
          <label className="block min-w-0 space-y-0.5">
            <span className={ROTULO}>Documento dela</span>
            <select name="kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as TipoDeDocumento })} className={CAMPO}>
              <option value="MDFE">MDF-e</option>
              <option value="CTE">CT-e</option>
            </select>
          </label>
          {form.kind === "CTE" ? (
            <label className="block min-w-0 space-y-0.5">
              <span className={ROTULO}>Carga</span>
              <select name="collectionId" required value={form.collectionId} onChange={(e) => setForm({ ...form, collectionId: e.target.value })} className={CAMPO}>
                <option value="">Escolha…</option>
                {dados.cargas.map((carga) => (
                  <option key={carga.id} value={carga.id}>
                    {carga.codigo} · {carga.destino}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block min-w-0 space-y-0.5">
              <span className={ROTULO}>UF de descarga</span>
              <select name="unloadState" required value={form.unloadState} onChange={(e) => setForm({ ...form, unloadState: e.target.value })} className={CAMPO}>
                <option value="">Escolha…</option>
                {ufs.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="col-span-2 block min-w-0 space-y-0.5">
            <span className={ROTULO}>Chave de acesso (44 posições, com o CNPJ dela)</span>
            <input name="accessKey" required maxLength={60} value={form.accessKey} onChange={(e) => setForm({ ...form, accessKey: e.target.value })} className={`${CAMPO} text-xs font-mono`} />
          </label>
          <label className="block min-w-0 space-y-0.5">
            <span className={ROTULO}>Emitido em</span>
            <input name="issuedAt" type="date" required value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} className={CAMPO} />
          </label>
          <div className="flex items-end justify-end">
            <button type="submit" disabled={ocupado !== null} className={`${BOTAO} w-full`}>
              {ocupado === "registrar" && <Loader2 className="w-4 h-4 animate-spin" />}
              Registrar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AlertTriangle, ArrowLeft, FileText, Loader2 } from "lucide-react";
import { pode } from "@/lib/permissoes";
import {
  DIAS_DO_BLOQUEIO_DA_PLACA,
  DIAS_PARA_AVISAR_ENCERRAMENTO,
  TIPOS_DE_EMITENTE,
  diasDesde,
  type ConfiguracaoDoMdfe,
  type MdfeEmitido,
  type RespostaDeNaoEncerrados,
  type SituacaoDaEmissao,
  type StatusDoServico,
} from "@/lib/mdfe";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, LABEL, ROTULO, erroDe, quando } from "../../deposito/comum";
import { Negado, chaveEmBlocos } from "../comum";
import { AcoesDoMdfe, SituacaoDoMdfe } from "./painel";

/**
 * MDF-e: os manifestos eletrônicos emitidos pela empresa, com a situação de
 * cada um. Daqui se baixa o XML e o DAMDFE, se encerra, se cancela e se inclui
 * condutor; a emissão é feita na viagem (Manifestos → viagem → aba MDF-e), que
 * é de onde saem as cargas, o veículo e o motorista.
 *
 * A tela nunca diz "autorizado" por conta própria: mostra o que a rota
 * devolveu.
 */

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; mdfes: MdfeEmitido[] };

const FALHA = "Não foi possível carregar os MDF-e.";
const FALHA_NA_SEFAZ = "Não foi possível consultar a SEFAZ.";

async function carregar(): Promise<Dados> {
  try {
    const res = await fetch("/api/fiscal/mdfe");
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, mdfes: (await res.json()) as MdfeEmitido[] };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

/** O topo: o ambiente em uso, o que falta para emitir e as duas consultas à SEFAZ (status e não encerrados). */
function Situacao({ situacao }: { situacao: SituacaoDaEmissao | null }) {
  const [status, setStatus] = useState<StatusDoServico | { erro: string } | null>(null);
  const [abertos, setAbertos] = useState<RespostaDeNaoEncerrados | { erro: string } | null>(null);
  const [consultando, setConsultando] = useState<"status" | "abertos" | null>(null);

  const consultar = async <T,>(qual: "status" | "abertos", caminho: string, guardar: (lido: T | { erro: string }) => void) => {
    setConsultando(qual);
    try {
      const res = await fetch(caminho);
      guardar(res.ok ? ((await res.json()) as T) : { erro: await erroDe(res, FALHA_NA_SEFAZ) });
    } catch {
      guardar({ erro: FALHA_NA_SEFAZ });
    } finally {
      setConsultando(null);
    }
  };

  if (!situacao) return null;
  if (!situacao.pronta) {
    return (
      <div data-aviso-mdfe="falta" role="note" className="flex items-start gap-2 px-3 py-2.5 text-sm text-amber-900 border border-amber-300 rounded-xl bg-amber-50">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
        <div className="min-w-0">
          <p className="font-semibold">A emissão de MDF-e ainda não está pronta nesta empresa.</p>
          <ul className="list-disc list-inside">
            {situacao.faltas.map((falta) => (
              <li key={falta}>{falta}</li>
            ))}
          </ul>
          <Link href="/dashboard/empresa" className="font-medium text-blue-700 hover:underline">
            Abrir Empresa → Fiscal
          </Link>
        </div>
      </div>
    );
  }
  const homologacao = situacao.ambiente === "HOMOLOGACAO";
  return (
    <div data-aviso-mdfe="pronta" role="note" className={`px-3 py-2 text-sm border rounded-xl space-y-1 ${homologacao ? "text-amber-900 border-amber-300 bg-amber-50" : "text-emerald-900 border-emerald-300 bg-emerald-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0">
          <strong>{homologacao ? "Emissão em homologação" : "Emissão em produção"}</strong>
          {homologacao ? ": MDF-e de teste, sem valor fiscal." : ": MDF-e com valor fiscal."}
        </p>
        <div className="flex shrink-0 gap-3 text-xs font-medium">
          <button type="button" data-consultar-sefaz disabled={consultando !== null} onClick={() => void consultar<StatusDoServico>("status", "/api/fiscal/mdfe/status-servico", setStatus)} className="underline disabled:opacity-60">
            {consultando === "status" ? "Consultando…" : "Status da SEFAZ"}
          </button>
          <button type="button" data-consultar-abertos disabled={consultando !== null} onClick={() => void consultar<RespostaDeNaoEncerrados>("abertos", "/api/fiscal/mdfe/nao-encerrados", setAbertos)} className="underline disabled:opacity-60">
            {consultando === "abertos" ? "Consultando…" : "Não encerrados na SEFAZ"}
          </button>
        </div>
      </div>
      {status && <p data-status-sefaz className="text-xs">{"erro" in status ? status.erro : `SEFAZ ${status.autorizador}: ${status.cStat ?? ""} ${status.motivo}`}</p>}
      {abertos && "erro" in abertos && <p data-abertos-na-sefaz className="text-xs">{abertos.erro}</p>}
      {abertos && !("erro" in abertos) && (
        <div data-abertos-na-sefaz className="text-xs">
          <p>
            {abertos.cStat} {abertos.motivo}
          </p>
          {abertos.mdfes.length > 0 && (
            <ul className="list-disc list-inside">
              {abertos.mdfes.map((aberto) => (
                <li key={aberto.chave} className="break-all">
                  {aberto.mdfe ? `MDF-e nº ${aberto.mdfe.numero} · viagem #${aberto.mdfe.viagem} · ${aberto.mdfe.placa} · descarga em ${aberto.mdfe.ufDeFim}` : `Emitido fora deste sistema: ${chaveEmBlocos(aberto.chave)} (protocolo ${aberto.protocolo})`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const FALHA_AO_SALVAR = "Não foi possível salvar a configuração.";

/** Série, numeração, tipo de emitente e seguro padrão. Só aparece para o administrador (a rota responde 403 aos outros). */
function Configuracao() {
  const [configuracao, setConfiguracao] = useState<ConfiguracaoDoMdfe | null>(null);
  const [aberta, setAberta] = useState(false);
  const [form, setForm] = useState({ serie: "1", proximoNumero: "1", tipoDeEmitente: "1", seguradora: "", cnpjDaSeguradora: "", apolice: "" });
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  const aplicar = (lida: ConfiguracaoDoMdfe) => {
    setConfiguracao(lida);
    setForm({
      serie: String(lida.serie),
      proximoNumero: String(lida.proximoNumero),
      tipoDeEmitente: lida.tipoDeEmitente,
      seguradora: lida.seguradora ?? "",
      cnpjDaSeguradora: lida.cnpjDaSeguradora ?? "",
      apolice: lida.apolice ?? "",
    });
  };

  useEffect(() => {
    let ativo = true;
    fetch("/api/fiscal/mdfe/configuracao")
      .then((res) => (res.ok ? res.json() : null))
      .then((lida: ConfiguracaoDoMdfe | null) => {
        if (ativo && lida) aplicar(lida);
      })
      .catch(() => {
        // Sem a leitura (ou sem permissão) a configuração não aparece.
      });
    return () => {
      ativo = false;
    };
  }, []);

  const salvar = async () => {
    setSalvando(true);
    setMensagem(null);
    try {
      const res = await fetch("/api/fiscal/mdfe/configuracao", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) return setMensagem({ ok: false, texto: await erroDe(res, FALHA_AO_SALVAR) });
      aplicar((await res.json()) as ConfiguracaoDoMdfe);
      setMensagem({ ok: true, texto: "Configuração salva." });
    } catch {
      setMensagem({ ok: false, texto: FALHA_AO_SALVAR });
    } finally {
      setSalvando(false);
    }
  };

  if (!configuracao?.disponivel) return null;
  const campo = (nome: keyof typeof form, rotulo: string, numerico = false) => (
    <label className="block space-y-1 min-w-0">
      <span className={LABEL}>{rotulo}</span>
      <input data-campo={nome} inputMode={numerico ? "numeric" : undefined} value={form[nome]} onChange={(e) => setForm((atual) => ({ ...atual, [nome]: e.target.value }))} className={INPUT} />
    </label>
  );

  return (
    <section data-configuracao-do-mdfe className={`${CARD} p-3 md:p-4 space-y-2`}>
      <button type="button" data-abrir-configuracao aria-expanded={aberta} onClick={() => setAberta((atual) => !atual)} className="flex w-full items-center justify-between text-sm font-semibold text-gray-900 dark:text-white">
        <span>Configuração</span>
        <span className="text-xs font-normal text-gray-500">
          série {configuracao.serie} · próximo nº {configuracao.proximoNumero} · {TIPOS_DE_EMITENTE[configuracao.tipoDeEmitente].split(" (")[0]}
        </span>
      </button>
      {aberta && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
          className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4"
        >
          {campo("serie", "Série", true)}
          {campo("proximoNumero", "Próximo número", true)}
          <label className="col-span-2 block space-y-1 min-w-0">
            <span className={LABEL}>Tipo de emitente</span>
            <select data-campo="tipoDeEmitente" value={form.tipoDeEmitente} onChange={(e) => setForm((atual) => ({ ...atual, tipoDeEmitente: e.target.value }))} className={INPUT}>
              {Object.entries(TIPOS_DE_EMITENTE).map(([codigo, rotulo]) => (
                <option key={codigo} value={codigo}>
                  {rotulo}
                </option>
              ))}
            </select>
          </label>
          {campo("seguradora", "Seguradora (padrão)")}
          {campo("cnpjDaSeguradora", "CNPJ da seguradora")}
          {campo("apolice", "Apólice")}
          <div className="flex items-end">
            <button type="submit" disabled={salvando} className={`${BOTAO_AZUL} w-full`}>
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
          </div>
          {mensagem && (
            <p role={mensagem.ok ? "status" : "alert"} className={`col-span-2 text-sm ${mensagem.ok ? "text-green-700" : "text-red-600"}`}>
              {mensagem.texto}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export default function MdfePage() {
  const { data: session } = useSession();
  const podeAlterar = pode(session?.user?.role, "fiscal");
  const [dados, setDados] = useState<Dados | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDaEmissao | null>(null);

  const recarregar = useCallback(async () => {
    setDados(await carregar());
  }, []);

  useEffect(() => {
    let ativo = true;
    carregar().then((resultado) => {
      if (ativo) setDados(resultado);
    });
    fetch("/api/fiscal/mdfe/situacao")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: SituacaoDaEmissao | null) => {
        if (ativo && corpo) setSituacao(corpo);
      })
      .catch(() => {
        // Sem a leitura o aviso do topo não aparece; a aba da viagem diz o que falta.
      });
    return () => {
      ativo = false;
    };
  }, []);

  if (dados && dados.denied !== null) return <Negado motivo={dados.denied} />;

  const mdfes = dados && dados.denied === null && dados.erro === null ? dados.mdfes : null;

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">MDF-e</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Manifestos eletrônicos das viagens: XML, DAMDFE, encerramento, cancelamento e inclusão de condutor</p>
        </div>
        <Link href="/dashboard/fiscal" className={`${BOTAO_CLARO} shrink-0`}>
          <ArrowLeft className="w-4 h-4" />
          Notas fiscais
        </Link>
      </div>

      <Situacao situacao={situacao} />
      <Configuracao />

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

      {mdfes && (
        <div className={`${CARD} overflow-hidden`}>
          {mdfes.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p>Nenhum MDF-e emitido.</p>
              <p className="text-sm">
                A emissão é feita na viagem:{" "}
                <Link href="/dashboard/manifestos" className="font-medium text-blue-600 hover:underline">
                  Manifestos
                </Link>{" "}
                → abrir a viagem → aba MDF-e.
              </p>
            </div>
          ) : (
            <table className="block md:table w-full text-sm">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Viagem</th>
                  <th className="px-4 py-3 font-medium">Rota</th>
                  <th className="px-4 py-3 font-medium">MDF-e</th>
                  <th className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {mdfes.map((mdfe) => {
                  const dias = mdfe.situacao === "AUTHORIZED" ? diasDesde(mdfe.autorizadoEm) : 0;
                  return (
                    <tr key={mdfe.id} data-mdfe-id={mdfe.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                      <td className="min-w-0 md:table-cell md:px-4 md:py-3">
                        <p className="font-medium text-gray-900 dark:text-white">Viagem #{mdfe.viagem}</p>
                        <p className="text-xs text-gray-500">
                          {mdfe.placa} · {quando(mdfe.atualizadoEm)}
                        </p>
                      </td>
                      <td data-rotulo="Rota" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        {mdfe.ufDeInicio} → {mdfe.ufDeFim}
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <SituacaoDoMdfe mdfe={mdfe} />
                        {dias >= DIAS_PARA_AVISAR_ENCERRAMENTO && (
                          <span data-em-aberto className="block mt-1 text-[11px] text-amber-700">
                            Autorizado há {dias} dias e ainda não encerrado: a SEFAZ bloqueia MDF-e novo da placa depois de {DIAS_DO_BLOQUEIO_DA_PLACA} dias.
                          </span>
                        )}
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <AcoesDoMdfe mdfe={mdfe} damdfe={situacao?.damdfe ?? false} podeAlterar={podeAlterar} aoMudar={() => void recarregar()} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

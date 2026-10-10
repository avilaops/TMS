"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { formatCurrency, formatWeight } from "@/lib/format";
import {
  CATEGORIAS_DE_COMBINACAO,
  JUSTIFICATIVA_MAXIMA,
  JUSTIFICATIVA_MINIMA,
  ROTULO_DA_SITUACAO,
  TIPOS_DE_CARGA,
  TIPOS_DE_EMITENTE,
  TIPOS_DE_VALE_PEDAGIO,
  dentroDoPrazoDeCancelamento,
  seloDoMdfe,
  type ConferenciaDoMdfe,
  type MdfeEmitido,
  type MdfesDaViagem,
  type ResultadoDaEmissao,
} from "@/lib/mdfe";
import { ROTULO_DO_AMBIENTE } from "@/lib/cte";
import { UFS } from "@/lib/roteiro";
import { BotaoDanfe } from "@/components/fiscal/botao-danfe";
import { BOTAO_AZUL, BOTAO_CLARO, INPUT, LABEL, erroDe, quando } from "../../deposito/comum";
import { chaveEmBlocos } from "../comum";
import { entradasDoFormulario, formularioDasEntradas, type FormularioDoMdfe } from "./formulario";

/**
 * O MDF-e na tela: a aba "MDF-e" da viagem (conferir, informar o que falta e
 * emitir, um documento por UF de descarregamento) e as ações de um MDF-e
 * autorizado (XML, DAMDFE, encerrar, cancelar, incluir condutor), que a lista
 * de MDF-e também usa.
 *
 * A tela nunca diz "autorizado", "encerrado" ou "cancelado" por conta própria:
 * mostra o que a rota devolveu, e a rota só devolve isso com o protocolo da
 * SEFAZ.
 */

const MOLDURA = "fixed inset-0 z-[60] flex items-stretch md:items-center justify-center md:p-4 bg-black/50";
const JANELA = "flex flex-col w-full md:max-w-lg bg-white dark:bg-gray-900 md:rounded-2xl shadow-xl overflow-hidden";
const GRADE = "grid grid-cols-2 gap-x-3 gap-y-2";

export const COR_DO_SELO: Record<MdfeEmitido["situacao"], string> = {
  AUTHORIZED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-blue-100 text-blue-800",
  CANCELLED: "bg-gray-200 text-gray-700",
  REJECTED: "bg-red-100 text-red-700",
  DRAFT: "bg-amber-100 text-amber-800",
};

const json = (corpo: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

const Alerta = ({ texto }: { texto: string }) => (
  <p role="alert" className="px-3 py-2 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
    {texto}
  </p>
);

/** Um grupo do formulário. Fica fora do componente que o usa: definido lá dentro, seria recriado a cada tecla e o campo perderia o foco. */
const Grupo = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <fieldset className="space-y-1.5">
    <legend className="text-xs font-semibold text-gray-800 dark:text-gray-200">{titulo}</legend>
    <div className={GRADE}>{children}</div>
  </fieldset>
);

const Linha = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-[11px] leading-tight text-gray-500">{rotulo}</dt>
    <dd className="text-sm text-gray-900 dark:text-white break-words">{children}</dd>
  </div>
);

function Cabecalho({ titulo, mdfe, aoFechar }: { titulo: string; mdfe: MdfeEmitido; aoFechar: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="min-w-0">
        <h2 className="text-lg font-bold font-outfit text-gray-900 dark:text-white">{titulo}</h2>
        <p className="text-xs text-gray-500 truncate">
          Viagem #{mdfe.viagem} · {mdfe.placa} · {mdfe.ufDeInicio} → {mdfe.ufDeFim}
        </p>
      </div>
      <button type="button" onClick={aoFechar} className="p-2 text-gray-500" aria-label="Fechar">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

/* ---------------------------- Eventos de um MDF-e ---------------------------- */

type Acao = "encerrar" | "cancelar" | "condutor";

/** O dia de hoje no relógio de Brasília (AAAA-MM-DD), para o campo de data. */
const hoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

function Encerramento({ mdfe, aoFechar, aoMudar }: { mdfe: MdfeEmitido; aoFechar: () => void; aoMudar: () => void }) {
  const [dia, setDia] = useState(hoje());
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState(mdfe.ufDeFim);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const encerrar = async () => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch(`/api/fiscal/mdfe/emissao/${mdfe.id}/encerrar`, json({ dia, cidade, uf }));
      if (!res.ok) return setErro(await erroDe(res, "Não foi possível encerrar o MDF-e."));
      aoMudar();
      aoFechar();
    } catch {
      setErro("Não foi possível encerrar o MDF-e.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Encerrar MDF-e">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void encerrar();
        }}
        className={JANELA}
      >
        <Cabecalho titulo={`Encerrar MDF-e nº ${mdfe.numero}`} mdfe={mdfe} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            O encerramento é obrigatório ao fim do último descarregamento. É um evento enviado à SEFAZ: o MDF-e só fica encerrado quando ela registra. Enquanto ele estiver em aberto, a SEFAZ rejeita MDF-e novo desta placa para a mesma UF.
          </p>
          {erro && <Alerta texto={erro} />}
          <div className={GRADE}>
            <label className="block space-y-1 min-w-0">
              <span className={LABEL}>Data do fim da viagem</span>
              <input required type="date" data-campo="dia" max={hoje()} value={dia} onChange={(e) => setDia(e.target.value)} className={INPUT} />
            </label>
            <label className="block space-y-1 min-w-0">
              <span className={LABEL}>UF</span>
              <select data-campo="uf" value={uf} onChange={(e) => setUf(e.target.value)} className={INPUT}>
                {UFS.map((sigla) => (
                  <option key={sigla} value={sigla}>
                    {sigla}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 block space-y-1 min-w-0">
              <span className={LABEL}>Cidade em que a viagem terminou</span>
              <input required data-campo="cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} className={INPUT} />
            </label>
          </div>
          <button type="submit" disabled={enviando || cidade.trim().length < 2} className={`${BOTAO_AZUL} w-full`}>
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
            Encerrar o MDF-e na SEFAZ
          </button>
        </div>
      </form>
    </div>
  );
}

function Cancelamento({ mdfe, aoFechar, aoMudar }: { mdfe: MdfeEmitido; aoFechar: () => void; aoMudar: () => void }) {
  const [justificativa, setJustificativa] = useState("");
  const [naoSaiu, setNaoSaiu] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const noPrazo = dentroDoPrazoDeCancelamento(mdfe.autorizadoEm);

  const cancelar = async () => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch(`/api/fiscal/mdfe/emissao/${mdfe.id}/cancelar`, json({ justificativa, transporteNaoIniciado: naoSaiu }));
      if (!res.ok) return setErro(await erroDe(res, "Não foi possível cancelar o MDF-e."));
      aoMudar();
      aoFechar();
    } catch {
      setErro("Não foi possível cancelar o MDF-e.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Cancelar MDF-e">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void cancelar();
        }}
        className={JANELA}
      >
        <Cabecalho titulo={`Cancelar MDF-e nº ${mdfe.numero}`} mdfe={mdfe} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            O cancelamento só vale até 24 horas depois da autorização e antes de o veículo sair. Depois disso, o MDF-e é encerrado, não cancelado.
          </p>
          {!noPrazo && (
            <p data-fora-do-prazo className="px-3 py-2 text-sm text-amber-900 border border-amber-200 rounded-lg bg-amber-50">
              O prazo de 24 horas já passou: a SEFAZ não aceita mais o cancelamento. Encerre o MDF-e.
            </p>
          )}
          {erro && <Alerta texto={erro} />}
          <label className="block">
            <span className={LABEL}>
              Justificativa ({JUSTIFICATIVA_MINIMA} a {JUSTIFICATIVA_MAXIMA} letras)
            </span>
            <textarea required rows={3} data-campo="justificativa" minLength={JUSTIFICATIVA_MINIMA} maxLength={JUSTIFICATIVA_MAXIMA} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} className={`${INPUT} resize-none`} />
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input type="checkbox" data-campo="naoSaiu" checked={naoSaiu} onChange={(e) => setNaoSaiu(e.target.checked)} className="mt-1" />
            <span>Confirmo que o veículo ainda não saiu com esta carga.</span>
          </label>
          <button type="submit" disabled={enviando || !noPrazo || !naoSaiu || justificativa.trim().length < JUSTIFICATIVA_MINIMA} className={`${BOTAO_AZUL} w-full`}>
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancelar o MDF-e na SEFAZ
          </button>
        </div>
      </form>
    </div>
  );
}

function Condutor({ mdfe, aoFechar, aoMudar }: { mdfe: MdfeEmitido; aoFechar: () => void; aoMudar: () => void }) {
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const incluir = async () => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch(`/api/fiscal/mdfe/emissao/${mdfe.id}/condutor`, json({ nome, cpf }));
      if (!res.ok) return setErro(await erroDe(res, "Não foi possível incluir o condutor."));
      aoMudar();
      aoFechar();
    } catch {
      setErro("Não foi possível incluir o condutor.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Incluir condutor no MDF-e">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void incluir();
        }}
        className={JANELA}
      >
        <Cabecalho titulo={`Incluir condutor no MDF-e nº ${mdfe.numero}`} mdfe={mdfe} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">Para a troca de motorista no meio da viagem. É um evento enviado à SEFAZ; o condutor só entra no MDF-e quando ela registra.</p>
          {erro && <Alerta texto={erro} />}
          <label className="block space-y-1">
            <span className={LABEL}>Nome do condutor</span>
            <input required data-campo="nome" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} className={INPUT} />
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>CPF</span>
            <input required data-campo="cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} className={INPUT} />
          </label>
          <button type="submit" disabled={enviando || nome.trim().length < 2 || cpf.replace(/\D/g, "").length !== 11} className={`${BOTAO_AZUL} w-full`}>
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
            Incluir o condutor na SEFAZ
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * As ações de um MDF-e que a SEFAZ autorizou: baixar o XML, o DAMDFE, encerrar,
 * cancelar e incluir condutor. `podeAlterar`: o perfil tem a capacidade
 * `fiscal` (quem só lê o fiscal baixa, mas não envia evento).
 */
export function AcoesDoMdfe({ mdfe, damdfe, podeAlterar, aoMudar }: { mdfe: MdfeEmitido; damdfe: boolean; podeAlterar: boolean; aoMudar: () => void }) {
  const [aberta, setAberta] = useState<Acao | null>(null);
  const autorizado = mdfe.situacao === "AUTHORIZED";
  const temXml = autorizado || mdfe.situacao === "CLOSED" || mdfe.situacao === "CANCELLED";
  if (!temXml) return null;

  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
        <a data-acao="xml" href={`/api/fiscal/mdfe/emissao/${mdfe.id}/xml`} className="text-blue-600 hover:underline">
          Baixar XML
        </a>
        {damdfe && mdfe.situacao !== "CANCELLED" && <BotaoDanfe documento="damdfe" endereco={`/api/fiscal/mdfe/emissao/${mdfe.id}/damdfe`} className="text-blue-600" />}
        {autorizado && podeAlterar && (
          <>
            <button type="button" data-acao="encerrar" onClick={() => setAberta("encerrar")} className="text-blue-600 hover:underline">
              Encerrar
            </button>
            <button type="button" data-acao="condutor" onClick={() => setAberta("condutor")} className="text-gray-700 dark:text-gray-300 hover:underline">
              Incluir condutor
            </button>
            <button type="button" data-acao="cancelar" onClick={() => setAberta("cancelar")} className="text-red-600 hover:underline">
              Cancelar
            </button>
          </>
        )}
      </div>
      {aberta === "encerrar" && <Encerramento mdfe={mdfe} aoFechar={() => setAberta(null)} aoMudar={aoMudar} />}
      {aberta === "cancelar" && <Cancelamento mdfe={mdfe} aoFechar={() => setAberta(null)} aoMudar={aoMudar} />}
      {aberta === "condutor" && <Condutor mdfe={mdfe} aoFechar={() => setAberta(null)} aoMudar={aoMudar} />}
    </>
  );
}

/** O selo, a chave e os eventos de um MDF-e. */
export function SituacaoDoMdfe({ mdfe }: { mdfe: MdfeEmitido }) {
  return (
    <div className="min-w-0">
      <span data-mdfe={mdfe.situacao} title={ROTULO_DA_SITUACAO[mdfe.situacao]} className={`inline-block text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${COR_DO_SELO[mdfe.situacao]}`}>
        {seloDoMdfe(mdfe)}
      </span>
      {mdfe.situacao === "REJECTED" && (
        <span data-rejeicao className="block mt-1 text-[11px] text-red-700">
          {mdfe.cStat} - {mdfe.motivo}
        </span>
      )}
      {mdfe.situacao !== "DRAFT" && mdfe.situacao !== "REJECTED" && <span className="block mt-1 font-mono text-[10px] text-gray-500 break-all">{chaveEmBlocos(mdfe.chave)}</span>}
      {mdfe.eventos.length > 0 && (
        <ul data-eventos className="mt-1 space-y-0.5 text-[11px] text-gray-600 dark:text-gray-400">
          {mdfe.eventos.map((evento) => (
            <li key={evento.id}>
              {evento.descricao} · {quando(evento.registradoEm)}
              {evento.protocolo ? ` · protocolo ${evento.protocolo}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------- Conferir e emitir (viagem) ----------------------- */

const FALHA_AO_CARREGAR = "Não foi possível carregar os MDF-e da viagem.";
const FALHA_AO_CONFERIR = "Não foi possível conferir o MDF-e.";
const FALHA_NA_EMISSAO = "Não foi possível falar com o servidor. Confira a situação do MDF-e antes de tentar de novo.";

const maisNovo = (a: MdfeEmitido | null, b: MdfeEmitido | null) => (!a ? b : !b ? a : b.atualizadoEm > a.atualizadoEm ? b : a);

/** Um MDF-e da viagem (uma UF de descarregamento): resumo, o que falta, o formulário e o botão que transmite. */
function Documento({
  manifestId,
  inicial,
  viagem,
  podeAlterar,
  aoMudar,
}: {
  manifestId: string;
  inicial: ConferenciaDoMdfe;
  viagem: Pick<MdfesDaViagem, "damdfe" | "reboques" | "ambiente">;
  podeAlterar: boolean;
  aoMudar: () => void;
}) {
  const [conferencia, setConferencia] = useState(inicial);
  const [form, setForm] = useState<FormularioDoMdfe>(() => formularioDasEntradas(inicial.entradas));
  const [percursoInformado, setPercursoInformado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<"conferir" | "emitir" | null>(null);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<{ autorizado: boolean; mensagem: string } | null>(null);

  const { resumo } = conferencia;
  // O MDF-e mais novo entre o que esta tela recebeu ao emitir e o que a viagem releu depois (um evento muda a situação).
  const mdfe = maisNovo(conferencia.mdfe, inicial.mdfe);
  const uf = conferencia.ufDeDescarga;
  const jaAutorizado = mdfe?.situacao === "AUTHORIZED" || mdfe?.situacao === "CLOSED";
  const corpo = () => ({ manifestId, ufDeDescarga: uf, entradas: entradasDoFormulario(form, percursoInformado) });
  const mudar = (campo: keyof FormularioDoMdfe, valor: string | boolean) => setForm((atual) => ({ ...atual, [campo]: valor }));

  const conferir = async () => {
    setOcupado("conferir");
    setErro("");
    try {
      const res = await fetch("/api/fiscal/mdfe/conferencia", json(corpo()));
      if (!res.ok) setErro(await erroDe(res, FALHA_AO_CONFERIR));
      else setConferencia((await res.json()) as ConferenciaDoMdfe);
    } catch {
      setErro(FALHA_AO_CONFERIR);
    } finally {
      setOcupado(null);
    }
  };

  const emitir = async () => {
    setOcupado("emitir");
    setErro("");
    setResultado(null);
    try {
      const res = await fetch("/api/fiscal/mdfe/emissao", json(corpo()));
      if (!res.ok) setErro(await erroDe(res, FALHA_NA_EMISSAO));
      else {
        const lido = (await res.json()) as ResultadoDaEmissao;
        setResultado({ autorizado: lido.autorizado, mensagem: lido.mensagem });
        setConferencia((atual) => ({ ...atual, mdfe: lido.mdfe, pendencias: lido.autorizado ? [] : atual.pendencias }));
      }
    } catch {
      setErro(FALHA_NA_EMISSAO);
    } finally {
      setOcupado(null);
      aoMudar();
    }
  };

  const campo = (nome: keyof FormularioDoMdfe, rotulo: string, opcoes: { largo?: boolean; numerico?: boolean; tipo?: string } = {}) => (
    <label className={`block space-y-0.5 min-w-0 ${opcoes.largo ? "col-span-2" : ""}`}>
      <span className={LABEL}>{rotulo}</span>
      <input data-campo={nome} type={opcoes.tipo} inputMode={opcoes.numerico ? "decimal" : undefined} value={String(form[nome])} onChange={(e) => mudar(nome, e.target.value)} className={INPUT} />
    </label>
  );
  const escolha = (nome: keyof FormularioDoMdfe, rotulo: string, opcoes: readonly (readonly [string, string])[], largo = false) => (
    <label className={`block space-y-0.5 min-w-0 ${largo ? "col-span-2" : ""}`}>
      <span className={LABEL}>{rotulo}</span>
      <select data-campo={nome} value={String(form[nome])} onChange={(e) => mudar(nome, e.target.value)} className={INPUT}>
        {opcoes.map(([valor, texto]) => (
          <option key={valor} value={valor}>
            {texto}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section data-documento={uf} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">MDF-e · descarga em {uf}</h3>
        {mdfe ? <SituacaoDoMdfe mdfe={mdfe} /> : <span data-mdfe="nao-emitido" className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 whitespace-nowrap">Não emitido</span>}
      </div>

      {resultado && (
        <p data-resultado={resultado.autorizado ? "autorizado" : "nao-autorizado"} role="status" className={`flex items-start gap-2 px-3 py-2 text-sm rounded-lg border ${resultado.autorizado ? "text-emerald-800 border-emerald-200 bg-emerald-50" : "text-red-700 border-red-200 bg-red-50"}`}>
          {resultado.autorizado ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{resultado.mensagem}</span>
        </p>
      )}
      {erro && <Alerta texto={erro} />}

      {mdfe && <AcoesDoMdfe mdfe={mdfe} damdfe={viagem.damdfe} podeAlterar={podeAlterar} aoMudar={aoMudar} />}

      {!jaAutorizado && (
        <>
          {mdfe && !resultado && mdfe.semResposta && (
            <p data-ultima-resposta className="px-3 py-2 text-xs text-amber-900 border border-amber-200 rounded-lg bg-amber-50">
              O último envio ficou sem resposta: emitir de novo começa consultando a SEFAZ pela chave.
            </p>
          )}

          {resumo && (
            <dl data-resumo className={GRADE}>
              <Linha rotulo="Ambiente · série / número">
                {ROTULO_DO_AMBIENTE[resumo.ambiente]} · {resumo.serie} / {resumo.numeroPrevisto}
              </Linha>
              <Linha rotulo="Emitente">{TIPOS_DE_EMITENTE[resumo.tipoDeEmitente].split(" (")[0]}</Linha>
              <Linha rotulo="Carrega em">{resumo.carregamento.length === 0 ? "a definir" : `${resumo.carregamento.join(", ")} (${resumo.ufDeInicio ?? "?"})`}</Linha>
              <Linha rotulo="Percurso">{resumo.percurso === null ? "informar" : resumo.percurso.length === 0 ? "direto" : resumo.percurso.join(" → ")}</Linha>
              <Linha rotulo="Descarrega em">{resumo.descargas.map((descarga) => `${descarga.municipio} (${descarga.documentos})`).join(", ") || "a definir"}</Linha>
              <Linha rotulo="Documentos · valor · peso">
                {resumo.documentos} · {formatCurrency(resumo.valorDaCarga)} · {formatWeight(resumo.pesoKg)}
              </Linha>
              <Linha rotulo="Veículo">{[resumo.placa, ...resumo.reboques].join(" + ")}</Linha>
              <Linha rotulo="Condutor">{resumo.condutor}</Linha>
            </dl>
          )}

          {conferencia.pendencias.length > 0 && (
            <ul data-pendencias className="px-3 py-2 space-y-1 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50 list-disc list-inside">
              {conferencia.pendencias.map((pendencia) => (
                <li key={pendencia}>{pendencia}</li>
              ))}
            </ul>
          )}
          {conferencia.avisos.length > 0 && (
            <ul data-avisos className="px-3 py-2 space-y-1 text-xs text-amber-900 border border-amber-200 rounded-lg bg-amber-50 list-disc list-inside">
              {conferencia.avisos.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
          )}

          {podeAlterar && (
            <>
              <button type="button" data-informar aria-expanded={aberto} onClick={() => setAberto((atual) => !atual)} className="text-sm font-medium text-blue-600 hover:underline">
                {aberto ? "Fechar os dados do MDF-e" : "Informar dados do MDF-e (percurso, CIOT, seguro, produto…)"}
              </button>

              {aberto && (
                <div data-formulario className="space-y-3">
                  <Grupo titulo="Percurso e CIOT">
                    <label className="col-span-2 block space-y-0.5 min-w-0">
                      <span className={LABEL}>UFs do meio do caminho, na ordem (ex.: PR, SC)</span>
                      <input
                        data-campo="percurso"
                        value={form.percurso}
                        onChange={(e) => {
                          setPercursoInformado(true);
                          mudar("percurso", e.target.value);
                        }}
                        className={INPUT}
                      />
                      {resumo && resumo.opcoesDePercurso.length > 0 && (
                        <span className="flex flex-wrap gap-2 pt-1">
                          {resumo.opcoesDePercurso.map((opcao) => (
                            <button
                              key={opcao.join()}
                              type="button"
                              data-opcao-de-percurso={opcao.join(",")}
                              onClick={() => {
                                setPercursoInformado(true);
                                mudar("percurso", opcao.join(", "));
                              }}
                              className="px-2 py-0.5 text-xs border border-blue-200 text-blue-700 rounded-full"
                            >
                              por {opcao.join(" e ")}
                            </button>
                          ))}
                        </span>
                      )}
                    </label>
                    {campo("ciot", "CIOT (12 dígitos)", { numerico: true })}
                    {campo("ciotDocumento", "CPF/CNPJ de quem gerou")}
                  </Grupo>

                  <Grupo titulo="Seguro da carga">
                    {campo("seguradora", "Seguradora")}
                    {campo("cnpjDaSeguradora", "CNPJ da seguradora")}
                    {campo("apolice", "Apólice")}
                    {campo("averbacoes", "Averbação desta viagem")}
                    {escolha("seguroResponsavel", "Responsável", [
                      ["1", "A transportadora"],
                      ["2", "O contratante"],
                    ])}
                    {form.seguroResponsavel === "2" && campo("seguroDocumento", "CPF/CNPJ do contratante")}
                  </Grupo>

                  <Grupo titulo={resumo?.lotacao ? "Produto predominante (carga lotação: NCM e CEPs obrigatórios)" : "Produto predominante"}>
                    {campo("produto", "Produto")}
                    {escolha("tipoDeCarga", "Tipo de carga", Object.entries(TIPOS_DE_CARGA))}
                    {campo("ncm", "NCM", { numerico: true })}
                    {resumo?.lotacao && campo("cepDeCarregamento", "CEP de carregamento", { numerico: true })}
                    {resumo?.lotacao && campo("cepDeDescarregamento", "CEP de descarga", { numerico: true })}
                  </Grupo>

                  <Grupo titulo={resumo?.lotacao ? "Pagamento do frete (obrigatório na carga lotação)" : "Pagamento do frete (opcional)"}>
                    {campo("pagador", "CPF/CNPJ de quem paga")}
                    {campo("valorDoFrete", "Valor do contrato (R$)", { numerico: true })}
                    {escolha("conta", "Recebe por", [
                      ["pix", "Pix"],
                      ["banco", "Banco e agência"],
                      ["ipef", "Instituição de pagamento"],
                    ])}
                    {form.conta === "pix" && campo("pix", "Chave Pix")}
                    {form.conta === "banco" && campo("banco", "Banco (código)", { numerico: true })}
                    {form.conta === "banco" && campo("agencia", "Agência", { numerico: true })}
                    {form.conta === "ipef" && campo("cnpjDaIpef", "CNPJ da instituição")}
                    <label className="col-span-2 flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                      <input type="checkbox" data-campo="aPrazo" checked={form.aPrazo} onChange={(e) => mudar("aPrazo", e.target.checked)} />
                      <span>Pagamento a prazo</span>
                    </label>
                    {form.aPrazo && campo("adiantamento", "Adiantamento (R$)", { numerico: true })}
                    {form.aPrazo && campo("vencimento", "Vencimento do saldo", { tipo: "date" })}
                  </Grupo>

                  <Grupo titulo="Vale-pedágio, reboques e lacres (opcionais)">
                    {campo("valePedagioFornecedor", "CNPJ da fornecedora do vale")}
                    {campo("valePedagioValor", "Valor do vale (R$)", { numerico: true })}
                    {escolha("valePedagioCategoria", "Categoria (eixos)", [["", "Não informado"], ...Object.entries(CATEGORIAS_DE_COMBINACAO)])}
                    {escolha("valePedagioTipo", "Tipo do vale", [["", "Não informado"], ...Object.entries(TIPOS_DE_VALE_PEDAGIO)])}
                    {escolha("reboque1", "Reboque 1", [["", "Sem reboque"], ...viagem.reboques.map((reboque) => [reboque.id, reboque.placa] as const)])}
                    {escolha("reboque2", "Reboque 2", [["", "Sem reboque"], ...viagem.reboques.map((reboque) => [reboque.id, reboque.placa] as const)])}
                    {campo("lacres", "Lacres (separados por vírgula)", { largo: true })}
                  </Grupo>
                </div>
              )}

              <div className="flex gap-2">
                <button type="button" data-conferir disabled={ocupado !== null} onClick={() => void conferir()} className={`${BOTAO_CLARO} flex-1`}>
                  {ocupado === "conferir" && <Loader2 className="w-4 h-4 animate-spin" />}
                  Conferir
                </button>
                <button type="button" data-emitir disabled={ocupado !== null || conferencia.pendencias.length > 0} onClick={() => void emitir()} className={`${BOTAO_AZUL} flex-1`}>
                  {ocupado === "emitir" && <Loader2 className="w-4 h-4 animate-spin" />}
                  {ocupado === "emitir" ? "Transmitindo…" : viagem.ambiente === "HOMOLOGACAO" ? "Emitir em homologação" : "Emitir"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * A aba "MDF-e" da viagem: um documento por UF de descarregamento. Carrega
 * sozinha; quem não lê o fiscal vê só o aviso de acesso.
 */
export function MdfeDaViagem({ manifestId, podeAlterar }: { manifestId: string; podeAlterar: boolean }) {
  const [dados, setDados] = useState<MdfesDaViagem | { erro: string } | null>(null);
  const [volta, setVolta] = useState(0);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/fiscal/mdfe/emissao?manifestId=${encodeURIComponent(manifestId)}`)
      .then(async (res) => {
        if (res.status === 401) return { erro: "Sessão expirada. Entre de novo." };
        if (res.status === 403) return { erro: "Seu perfil não tem acesso aos documentos fiscais." };
        return res.ok ? ((await res.json()) as MdfesDaViagem) : { erro: await erroDe(res, FALHA_AO_CARREGAR) };
      })
      .catch(() => ({ erro: FALHA_AO_CARREGAR }))
      .then((lido) => {
        if (ativo) setDados(lido);
      });
    return () => {
      ativo = false;
    };
  }, [manifestId, volta]);

  if (!dados) {
    return (
      <div className="flex justify-center py-8" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }
  if ("erro" in dados) return <Alerta texto={dados.erro} />;

  return (
    <div data-mdfe-da-viagem className="space-y-3">
      {!dados.pronta && (
        <div data-aviso-mdfe="falta" role="note" className="flex items-start gap-2 px-3 py-2.5 text-sm text-amber-900 border border-amber-300 rounded-xl bg-amber-50">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div className="min-w-0">
            <p className="font-semibold">A emissão de MDF-e ainda não está pronta nesta empresa.</p>
            <ul className="list-disc list-inside">
              {dados.faltas.map((falta) => (
                <li key={falta}>{falta}</li>
              ))}
            </ul>
            <Link href="/dashboard/empresa" className="font-medium text-blue-700 hover:underline">
              Abrir Empresa → Fiscal
            </Link>
          </div>
        </div>
      )}
      {dados.pronta && dados.ambiente === "HOMOLOGACAO" && (
        <p data-aviso-mdfe="homologacao" role="note" className="px-3 py-2 text-xs text-amber-900 border border-amber-300 rounded-xl bg-amber-50">
          <strong>Emissão em homologação</strong>: MDF-e de teste, sem valor fiscal.
        </p>
      )}
      {dados.documentos.length === 0 && <p className="py-6 text-sm text-center text-gray-500">A viagem ainda não tem carga com destino reconhecido.</p>}
      {dados.documentos.map((documento) => (
        <Documento key={documento.ufDeDescarga} manifestId={manifestId} inicial={documento} viagem={dados} podeAlterar={podeAlterar} aoMudar={() => setVolta((atual) => atual + 1)} />
      ))}
    </div>
  );
}

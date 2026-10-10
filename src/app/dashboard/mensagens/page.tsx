"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, PlugZap, RotateCw } from "lucide-react";
import {
  ROTULO_DA_SITUACAO,
  SITUACOES,
  TIPOS_DE_AVISO,
  descricaoDaSituacao,
  podeReenviar,
  rotuloDoTipo,
  situacaoDoAviso,
  type Aviso,
  type SituacaoDoAviso,
} from "@/lib/mensageria";
import { AcessoRestrito } from "@/components/AcessoRestrito";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";

/**
 * Mensageria: o histórico dos avisos que o TMS gerou para sistemas de fora
 * (carga que mudou de status, fatura, título vencido, chamado), com a situação
 * de cada entrega e o "Tentar de novo" para o que falhou.
 *
 * A tela mostra se o aviso chegou ao endereço cadastrado em Empresa →
 * Integração. O TMS não escreve para motorista nem cliente por conta própria:
 * quem manda o WhatsApp ou o e-mail é o sistema que recebe o aviso.
 */

type Filtros = { tipo: string; situacao: string };
type Pagina = { url: string | null; eventos: Aviso[]; proximo: string | null };
type Carga = { denied: DeniedReason } | { denied: null; erro: string } | ({ denied: null; erro: null } & Pagina);

const SEM_FILTRO: Filtros = { tipo: "", situacao: "" };
const FALHA = "Não foi possível carregar os avisos.";

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
const CAMPO =
  "block w-full min-w-0 mt-0.5 px-3 py-1.5 md:py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm";
const ROTULO = "min-w-0 text-xs md:text-sm text-gray-500";
const COM_ROTULO =
  "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none";

const SELO: Record<SituacaoDoAviso, string> = {
  entregue: "border-emerald-200 bg-emerald-50 text-emerald-700",
  fila: "border-gray-200 bg-gray-50 text-gray-600",
  falhou: "border-amber-200 bg-amber-50 text-amber-700",
  desistiu: "border-red-200 bg-red-50 text-red-700",
};

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

async function buscar(filtros: Filtros, cursor: string | null): Promise<Carga> {
  try {
    const query = new URLSearchParams();
    if (filtros.tipo) query.set("tipo", filtros.tipo);
    if (filtros.situacao) query.set("situacao", filtros.situacao);
    if (cursor) query.set("cursor", cursor);
    const res = await fetch(`/api/eventos?${query}`);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    const corpo = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(corpo?.eventos)) {
      return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA };
    }
    return { denied: null, erro: null, url: corpo.integracao?.url ?? null, eventos: corpo.eventos, proximo: corpo.proximo ?? null };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

export default function MensagensPage() {
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [buscandoMais, setBuscandoMais] = useState(false);
  // O aviso cujo "Tentar de novo" está em curso, e o que a última tentativa respondeu.
  const [reenviando, setReenviando] = useState<string | null>(null);
  const [retorno, setRetorno] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    buscar(filtros, null).then((resultado) => {
      if (ativo) setCarga(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [filtros]);

  const filtrar = (campo: keyof Filtros, valor: string) => {
    setCarga(null);
    setRetorno(null);
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  };

  const carregarMais = async () => {
    if (!carga || carga.denied !== null || carga.erro !== null || !carga.proximo) return;
    setBuscandoMais(true);
    const mais = await buscar(filtros, carga.proximo);
    setBuscandoMais(false);
    if (mais.denied !== null || mais.erro !== null) {
      setCarga(mais);
      return;
    }
    setCarga({ ...mais, eventos: [...carga.eventos, ...mais.eventos] });
  };

  const tentarDeNovo = async (id: string) => {
    setReenviando(id);
    setRetorno(null);
    try {
      const res = await fetch(`/api/eventos/${id}/reenviar`, { method: "POST" });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) {
        setRetorno({ ok: false, texto: typeof corpo?.error === "string" ? corpo.error : "Não foi possível tentar de novo." });
        return;
      }
      setRetorno({ ok: true, texto: "Aviso devolvido à fila. A próxima tentativa sai em até 15 segundos." });
      // A linha muda no lugar: com o filtro "Falhou" ligado ela sumiria, e o operador não veria o que fez.
      setCarga((atual) =>
        atual && atual.denied === null && atual.erro === null
          ? { ...atual, eventos: atual.eventos.map((evento) => (evento.id === id ? (corpo as Aviso) : evento)) }
          : atual,
      );
    } catch {
      setRetorno({ ok: false, texto: "Não foi possível tentar de novo." });
    } finally {
      setReenviando(null);
    }
  };

  if (carga && carga.denied !== null) return <AcessoRestrito motivo={carga.denied} oQue="a mensageria" />;

  const pronta = carga && carga.denied === null && carga.erro === null ? carga : null;
  const filtrando = filtros.tipo !== "" || filtros.situacao !== "";

  return (
    <div className="space-y-3 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Mensageria</h1>
        <p className="hidden md:block text-gray-500 text-sm mt-1">
          Avisos que o TMS gerou para sistemas de fora. Quem escreve para o cliente ou o motorista (WhatsApp, e-mail) é o sistema que recebe o aviso.
        </p>
      </div>

      {pronta && pronta.url === null && (
        <div data-sem-endereco className={`${CARD} flex items-start gap-3 p-3 md:p-5`}>
          <PlugZap className="w-5 h-5 mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-gray-900 dark:text-white">Nenhum endereço de integração cadastrado</p>
            <p className="mt-0.5 text-gray-600 dark:text-gray-300">
              Sem endereço, o TMS não gera aviso nenhum: nada sai para WhatsApp, e-mail ou outro sistema.{" "}
              <Link href="/dashboard/empresa" className="font-medium text-blue-600 hover:underline">
                Cadastrar em Empresa → Integração
              </Link>
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:flex md:gap-4">
        <label className={`${ROTULO} md:w-64`}>
          Tipo
          <select value={filtros.tipo} onChange={(e) => filtrar("tipo", e.target.value)} className={CAMPO}>
            <option value="">Todos</option>
            {Object.entries(TIPOS_DE_AVISO).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className={`${ROTULO} md:w-48`}>
          Situação
          <select value={filtros.situacao} onChange={(e) => filtrar("situacao", e.target.value)} className={CAMPO}>
            <option value="">Todas</option>
            {SITUACOES.map((situacao) => (
              <option key={situacao} value={situacao}>
                {ROTULO_DA_SITUACAO[situacao]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {retorno && (
        <div
          role={retorno.ok ? "status" : "alert"}
          className={`px-4 py-3 text-sm border rounded-lg ${retorno.ok ? "text-emerald-700 border-emerald-200 bg-emerald-50" : "text-red-700 border-red-200 bg-red-50"}`}
        >
          {retorno.texto}
        </div>
      )}

      {!carga && (
        <div className="flex items-center justify-center h-[300px]" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {carga && carga.denied === null && carga.erro !== null && (
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {carga.erro}
        </div>
      )}

      {pronta && pronta.eventos.length === 0 && (
        <p className={`${CARD} px-4 py-10 text-center text-sm text-gray-500`}>
          {filtrando ? "Nenhum aviso com estes filtros." : "Nenhum aviso gerado ainda."}
        </p>
      )}

      {pronta && pronta.eventos.length > 0 && (
        <div className={`${CARD} overflow-hidden`}>
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Aviso</th>
                <th className="px-4 py-3 font-medium">Gerado em</th>
                <th className="px-4 py-3 font-medium">Situação</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
              {pronta.eventos.map((evento) => {
                const situacao = situacaoDoAviso(evento);
                return (
                  <tr key={evento.id} data-aviso={evento.id} data-situacao={situacao} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 md:table-row">
                    <td className="min-w-0 md:table-cell md:px-4 md:py-3 font-medium text-gray-900 dark:text-white">{rotuloDoTipo(evento.type)}</td>
                    <td data-rotulo="Gerado em" className={`min-w-0 md:table-cell md:px-4 md:py-3 whitespace-nowrap text-right md:text-left text-gray-600 dark:text-gray-300 ${COM_ROTULO}`}>
                      {dataHora(evento.createdAt)}
                    </td>
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full border ${SELO[situacao]}`}>{ROTULO_DA_SITUACAO[situacao]}</span>
                      <p className="mt-0.5 text-xs text-gray-500 break-words">
                        {situacao === "entregue" && evento.deliveredAt ? `Entregue em ${dataHora(evento.deliveredAt)}` : descricaoDaSituacao(evento)}
                        {situacao === "falhou" ? `. Próxima tentativa: ${dataHora(evento.nextAttemptAt)}` : ""}
                      </p>
                    </td>
                    {/* Sem botão, a célula não ocupa linha no cartão do celular. */}
                    <td className={`${podeReenviar(evento) ? "" : "hidden "}col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 md:text-right`}>
                      {podeReenviar(evento) && (
                        <button
                          type="button"
                          onClick={() => void tentarDeNovo(evento.id)}
                          disabled={reenviando !== null}
                          className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 disabled:opacity-60"
                        >
                          <RotateCw className={`w-4 h-4 ${reenviando === evento.id ? "animate-spin" : ""}`} />
                          Tentar de novo
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {pronta.proximo && (
            <div className="p-3 border-t border-gray-100 dark:border-gray-800 text-center">
              <button
                type="button"
                onClick={carregarMais}
                disabled={buscandoMais}
                className="min-h-10 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 disabled:opacity-60"
              >
                {buscandoMais ? "Carregando..." : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

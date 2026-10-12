"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { rotuloDoMotivo } from "@/lib/equipe";
import {
  EXPLICACAO_DO_PARCEIRO,
  EXPLICACAO_SEM_KM,
  type ContaDoMes,
  type FechamentoDoMes,
  type PessoaDoFechamento,
  basesPorExtenso,
  formasPorExtenso,
  mesAtual,
  mesPorExtenso,
  parcelasPorExtenso,
  valorALancar,
} from "@/lib/remuneracao";
import { BOTAO, CARD, COM_ROTULO, INPUT, LABEL, Mensagem, TABELA, TBODY, TD, TH, THEAD, TR, enviar, erroDe, type Aviso } from "./comum";

/**
 * Fechamento mensal da remuneração variável: por motorista e por ajudante, as
 * viagens finalizadas no mês com o que cada uma rendeu, os adiantamentos e
 * vales em aberto e o saldo a pagar. A lista mostra o mês; a pessoa abre num
 * painel com as viagens, e é nele que o administrador fecha (congela os valores
 * e lança o saldo no Financeiro) ou reabre o mês.
 *
 * As contas estão em src/lib/remuneracao.ts; a tela só mostra o que a rota
 * devolve. É um demonstrativo gerencial, não folha de pagamento.
 */

const FALHA = "Não foi possível carregar o fechamento.";
const CAMPO = "min-w-0 w-full px-2 py-1.5 md:px-3 md:py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950";

const dia = (data: string) => data.slice(5).split("-").reverse().join("/");
const paraOCampo = (valor: number | null | undefined) => (valor == null ? "" : String(valor).replace(".", ","));

const SELO_ABERTO = "bg-amber-50 text-amber-700 border-amber-200";
const SELO_FECHADO = "bg-emerald-50 text-emerald-700 border-emerald-200";

/** O selo da situação do mês da pessoa, com o aviso de que a conta mudou depois do fechamento. */
function Situacao({ pessoa }: { pessoa: PessoaDoFechamento }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {pessoa.diferenca && (
        <span data-mudou className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-700" title="A conta de hoje é diferente da que foi fechada">
          <AlertTriangle className="w-3 h-3" /> mudou
        </span>
      )}
      <span data-situacao={pessoa.fechamento ? "fechado" : "aberto"} className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full border ${pessoa.fechamento ? SELO_FECHADO : SELO_ABERTO}`}>
        {pessoa.fechamento ? "Fechado" : "Aberto"}
      </span>
    </span>
  );
}

export function Fechamento({ podeFechar, alteraValores }: { podeFechar: boolean; alteraValores: boolean }) {
  const [mes, setMes] = useState(mesAtual);
  const [resposta, setResposta] = useState<FechamentoDoMes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // A pessoa aberta no painel, pela chave: os dados dela vêm sempre da última leitura.
  const [aberta, setAberta] = useState<string | null>(null);

  const ler = useCallback(async (doMes: string) => {
    try {
      const res = await fetch(`/api/equipe/fechamento?mes=${encodeURIComponent(doMes)}`);
      if (!res.ok) return setErro(await erroDe(res, FALHA));
      setErro(null);
      setResposta((await res.json()) as FechamentoDoMes);
    } catch {
      setErro(FALHA);
    }
  }, []);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/equipe/fechamento?mes=${encodeURIComponent(mes)}`)
      .then(async (res) => {
        if (!ativo) return;
        if (!res.ok) return setErro(await erroDe(res, FALHA));
        setErro(null);
        setResposta((await res.json()) as FechamentoDoMes);
      })
      .catch(() => {
        if (ativo) setErro(FALHA);
      });
    return () => {
      ativo = false;
    };
  }, [mes]);

  const mudarMes = (valor: string) => {
    // Campo de mês apagado manda vazio: fica o que estava.
    if (!valor) return;
    setResposta(null);
    setErro(null);
    setAberta(null);
    setMes(valor);
  };

  const pessoa = resposta?.pessoas.find((linha) => linha.chave === aberta) ?? null;

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-end justify-between gap-2">
        <label className="min-w-0 text-xs text-gray-500">
          Mês
          <input type="month" value={mes} max={mesAtual()} onChange={(e) => mudarMes(e.target.value)} data-campo="mes" className={`${CAMPO} block mt-1`} />
        </label>
        {resposta && (
          <p className="text-right text-xs text-gray-500" data-resumo="saldo">
            Saldo do mês
            <strong className="block text-base text-gray-900 dark:text-white">{formatCurrency(resposta.total.saldo)}</strong>
          </p>
        )}
      </div>

      {erro && (
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {erro}
        </div>
      )}

      {!resposta && !erro && (
        <div className="flex items-center justify-center h-32" role="status" aria-label="Carregando">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      )}

      {resposta && (
        <div className={`${CARD} overflow-hidden`}>
          {resposta.pessoas.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">Ninguém com viagem finalizada, adiantamento em aberto ou forma de remuneração neste mês.</p>
          ) : (
            <table className={TABELA}>
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Pessoa</th>
                  <th className={`${TH} text-right`}>Viagens</th>
                  <th className={`${TH} text-right`}>Variável</th>
                  <th className={`${TH} text-right`}>Adiantamentos</th>
                  <th className={`${TH} text-right`}>Saldo</th>
                  <th className={TH}>Situação</th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {resposta.pessoas.map((linha) => {
                  const conta = linha.fechamento?.conta ?? linha.atual;
                  return (
                    <tr key={linha.chave} data-pessoa={linha.chave} onClick={() => setAberta(linha.chave)} className={`${TR} !grid-cols-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50`}>
                      <td className={`${TD} col-span-3 font-medium text-gray-900 dark:text-white`}>
                        <div className="flex items-center justify-between gap-2">
                          <button type="button" data-abrir-pessoa={linha.chave} className="min-w-0 truncate text-left">
                            {linha.nome} <span className="text-xs font-normal text-gray-500">({linha.tipo})</span>
                          </button>
                          {/* No celular a situação fica ao lado do nome; no computador, na última coluna. */}
                          <span className="md:hidden shrink-0">
                            <Situacao pessoa={linha} />
                          </span>
                        </div>
                      </td>
                      <td data-rotulo="Viagens" className={`${TD} ${COM_ROTULO} hidden md:table-cell md:text-right text-gray-600 dark:text-gray-300`}>{conta.viagens.length}</td>
                      <td data-rotulo={`Variável (${conta.viagens.length} ${conta.viagens.length === 1 ? "viagem" : "viagens"})`} className={`${TD} ${COM_ROTULO} md:text-right text-gray-900 dark:text-white`}>{formatCurrency(conta.variavel)}</td>
                      <td data-rotulo="Adiantamentos" className={`${TD} ${COM_ROTULO} md:text-right text-gray-600 dark:text-gray-300`}>{formatCurrency(conta.adiantado)}</td>
                      <td data-rotulo="Saldo" className={`${TD} ${COM_ROTULO} md:text-right font-semibold ${conta.saldo < 0 ? "text-red-700" : "text-gray-900 dark:text-white"}`}>{formatCurrency(conta.saldo)}</td>
                      <td className={`${TD} hidden md:table-cell`}>
                        <Situacao pessoa={linha} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="px-3 py-2 md:px-4 md:py-3 text-[11px] md:text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800">
            Saldo = variável das viagens finalizadas no mês − adiantamentos e vales em aberto do mês. Demonstrativo gerencial: não é folha de pagamento.
          </p>
        </div>
      )}

      {pessoa && (
        <PainelDaPessoa
          key={`${pessoa.chave}:${mes}`}
          pessoa={pessoa}
          mes={mes}
          podeFechar={podeFechar}
          alteraValores={alteraValores}
          aoFechar={() => setAberta(null)}
          aoMudar={() => ler(mes)}
        />
      )}
    </div>
  );
}

/* ------------------------------ O painel da pessoa ----------------------------- */

function Numero({ rotulo, valor, forte = false, negativo = false }: { rotulo: string; valor: number; forte?: boolean; negativo?: boolean }) {
  return (
    <div data-numero={rotulo} className="min-w-0">
      <dt className="text-[11px] md:text-xs text-gray-500 truncate">{rotulo}</dt>
      <dd className={`${forte ? "text-base md:text-lg font-bold" : "text-sm md:text-base font-semibold"} ${negativo ? "text-red-700" : "text-gray-900 dark:text-white"}`}>{formatCurrency(valor)}</dd>
    </div>
  );
}

function ViagensDaConta({ conta }: { conta: ContaDoMes }) {
  if (conta.viagens.length === 0) return <p className="text-xs text-gray-500">Nenhuma viagem finalizada no mês.</p>;
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {conta.viagens.map((linha) => (
        <li key={linha.manifestId} data-viagem={linha.manifestId} className="py-1.5">
          <p className="flex justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium text-gray-900 dark:text-white">
              #{linha.codigo} · {linha.saida === linha.finalizada ? dia(linha.saida) : `${dia(linha.saida)} a ${dia(linha.finalizada)}`} · {linha.placa}
            </span>
            <span className="shrink-0 font-semibold">{formatCurrency(linha.total)}</span>
          </p>
          <p className="text-[11px] md:text-xs text-gray-500">
            {basesPorExtenso(linha)}
            {linha.frete > 0 ? ` · frete ${formatCurrency(linha.frete)}` : ""}
          </p>
          {linha.fora === "PARCEIRO" ? (
            <p data-fora className="text-[11px] md:text-xs text-amber-700">{EXPLICACAO_DO_PARCEIRO}</p>
          ) : (
            <p className="text-[11px] md:text-xs text-gray-600 dark:text-gray-300">{parcelasPorExtenso(linha) || "Sem forma de remuneração com valor"}</p>
          )}
          {linha.semKm && <p data-sem-km className="text-[11px] md:text-xs text-amber-700">{EXPLICACAO_SEM_KM}</p>}
        </li>
      ))}
    </ul>
  );
}

function PainelDaPessoa({
  pessoa,
  mes,
  podeFechar,
  alteraValores,
  aoFechar,
  aoMudar,
}: {
  pessoa: PessoaDoFechamento;
  mes: string;
  /** O perfil fecha e reabre o mês (capacidade `equipeFechamento`). */
  podeFechar: boolean;
  /** O perfil altera os valores da equipe (capacidade `equipeValores`): muda a diária e o fixo do ajudante. */
  alteraValores: boolean;
  aoFechar: () => void;
  aoMudar: () => Promise<void> | void;
}) {
  const fechado = pessoa.fechamento;
  const conta = fechado?.conta ?? pessoa.atual;
  // No celular, uma parte por vez: as viagens ou os adiantamentos.
  const [parte, setParte] = useState<"viagens" | "adiantamentos">("viagens");
  // O passo de confirmação: nada é gravado até o "Confirmar".
  const [confirmando, setConfirmando] = useState<"fechar" | "reabrir" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [formas, setFormas] = useState({ dailyRate: paraOCampo(pessoa.formas.dailyRate), perTripRate: paraOCampo(pessoa.formas.perTripRate) });
  const [editandoFormas, setEditandoFormas] = useState(false);

  const chamar = async (pedido: () => Promise<Response>, falha: string, sucesso: string) => {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await pedido();
      if (!res.ok) return setAviso({ ok: false, texto: await erroDe(res, falha) });
      setConfirmando(null);
      setEditandoFormas(false);
      setAviso({ ok: true, texto: sucesso });
      await aoMudar();
    } catch {
      setAviso({ ok: false, texto: falha });
    } finally {
      setOcupado(false);
    }
  };

  const fechar = () => chamar(() => enviar("/api/equipe/fechamento", "POST", { pessoa: pessoa.chave, mes }), "Erro ao fechar o mês.", "Mês fechado.");
  const reabrir = () => chamar(() => enviar(`/api/equipe/fechamento/${fechado?.id}`, "DELETE"), "Erro ao reabrir o mês.", "Mês reaberto.");
  const salvarFormas = (e: React.FormEvent) => {
    e.preventDefault();
    return chamar(() => enviar(`/api/equipe/ajudantes/${pessoa.chave.split(":")[1]}/remuneracao`, "PATCH", formas), "Erro ao gravar a remuneração do ajudante.", "Remuneração do ajudante gravada.");
  };

  const aLancar = valorALancar(pessoa.atual);
  const nadaAFechar = pessoa.atual.viagens.length === 0 && pessoa.atual.adiantamentos.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div role="dialog" aria-label={`Fechamento de ${pessoa.nome}`} data-painel-do-fechamento className="bg-white dark:bg-gray-900 md:rounded-2xl w-full max-w-2xl md:max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100 dark:border-gray-800">
        <div className="px-3 py-2 md:px-6 md:py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white truncate">{pessoa.nome}</h2>
            <p className="text-xs text-gray-500 truncate">
              {pessoa.tipo === "motorista" ? "Motorista" : "Ajudante"} · {mesPorExtenso(mes)}
              {fechado ? ` · fechado por ${fechado.fechadoPor}` : ""}
            </p>
          </div>
          <span className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full border ${fechado ? SELO_FECHADO : SELO_ABERTO}`}>{fechado ? "Fechado" : "Aberto"}</span>
          <button onClick={aoFechar} aria-label="Fechar" className="shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-2 md:space-y-4">
          <dl className="grid grid-cols-3 gap-x-3">
            <Numero rotulo="Variável" valor={conta.variavel} />
            <Numero rotulo="Adiantamentos" valor={conta.adiantado} />
            <Numero rotulo={conta.saldo < 0 ? "Saldo (deve)" : "Saldo a pagar"} valor={conta.saldo} forte negativo={conta.saldo < 0} />
          </dl>

          {/* As formas do cadastro. A do motorista se altera em Motoristas; a do ajudante, aqui. */}
          {editandoFormas ? (
            <form onSubmit={salvarFormas} data-formas-do-ajudante className="grid grid-cols-2 gap-x-3 gap-y-2 items-end">
              <label className="block min-w-0 space-y-0.5">
                <span className={LABEL}>Diária (R$ por dia)</span>
                <input inputMode="decimal" value={formas.dailyRate} onChange={(e) => setFormas({ ...formas, dailyRate: e.target.value })} placeholder="Não usa" data-forma="dailyRate" className={INPUT} />
              </label>
              <label className="block min-w-0 space-y-0.5">
                <span className={LABEL}>Fixo por viagem (R$)</span>
                <input inputMode="decimal" value={formas.perTripRate} onChange={(e) => setFormas({ ...formas, perTripRate: e.target.value })} placeholder="Não usa" data-forma="perTripRate" className={INPUT} />
              </label>
              <div className="col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditandoFormas(false)} disabled={ocupado} className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300">
                  Cancelar
                </button>
                <button type="submit" disabled={ocupado} className={BOTAO}>
                  {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
                  Salvar
                </button>
              </div>
            </form>
          ) : (
            <p data-formas className="flex items-start justify-between gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span className="min-w-0">{formasPorExtenso(pessoa.formas)}</span>
              {pessoa.tipo === "ajudante" && alteraValores && (
                <button type="button" data-alterar-formas onClick={() => setEditandoFormas(true)} className="shrink-0 font-medium text-blue-700 dark:text-blue-400 underline">
                  Alterar
                </button>
              )}
            </p>
          )}

          {/* Fechado e a conta de hoje mudou: o fechado não muda sozinho. */}
          {fechado && pessoa.diferenca && (
            <p role="alert" data-diferenca className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              A conta de hoje é diferente da que foi fechada: variável {formatCurrency(pessoa.atual.variavel)} ({pessoa.diferenca.variavel >= 0 ? "+" : "−"}
              {formatCurrency(Math.abs(pessoa.diferenca.variavel))}), adiantamentos {formatCurrency(pessoa.atual.adiantado)}, saldo {formatCurrency(pessoa.atual.saldo)}. Alguma viagem ou adiantamento do mês mudou depois do
              fechamento. Reabra o mês para fechar de novo com os valores de hoje.
            </p>
          )}

          <div role="tablist" aria-label="Parte do fechamento" className="grid grid-cols-2 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
            {(
              [
                ["viagens", `Viagens (${conta.viagens.length})`],
                ["adiantamentos", `Adiantamentos (${conta.adiantamentos.length})`],
              ] as const
            ).map(([chave, rotulo]) => (
              <button
                key={chave}
                type="button"
                role="tab"
                aria-selected={parte === chave}
                data-parte={chave}
                onClick={() => setParte(chave)}
                className={`py-1 rounded-lg text-xs md:text-sm font-semibold ${parte === chave ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {parte === "viagens" ? (
            <ViagensDaConta conta={conta} />
          ) : conta.adiantamentos.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhum adiantamento ou vale em aberto com data neste mês.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {conta.adiantamentos.map((adiantamento) => (
                <li key={adiantamento.id} data-adiantamento={adiantamento.id} className="flex justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                    {dia(adiantamento.date)} · {rotuloDoMotivo(adiantamento.reason)}
                  </span>
                  <span className="shrink-0 font-medium">− {formatCurrency(adiantamento.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-3 py-2 md:px-6 md:py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 space-y-2">
          <Mensagem aviso={aviso} />
          {confirmando === "fechar" ? (
            <div role="alertdialog" aria-label="Fechar o mês" data-confirmar-fechamento className="space-y-2">
              <p className="text-xs md:text-sm text-gray-700 dark:text-gray-200">
                Fechar {mesPorExtenso(mes)} de {pessoa.nome}? Os valores ficam congelados e{" "}
                {aLancar > 0 ? (
                  <>
                    <strong>{formatCurrency(aLancar)}</strong> entram no Financeiro como despesa em aberto (Remuneração variável).
                  </>
                ) : (
                  "nada é lançado no Financeiro, porque não há saldo a pagar."
                )}
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmando(null)} disabled={ocupado} className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300">
                  Cancelar
                </button>
                <button type="button" data-confirmar onClick={fechar} disabled={ocupado} className={BOTAO}>
                  {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirmar fechamento
                </button>
              </div>
            </div>
          ) : confirmando === "reabrir" ? (
            <div role="alertdialog" aria-label="Reabrir o mês" data-confirmar-reabertura className="space-y-2">
              <p className="text-xs md:text-sm text-gray-700 dark:text-gray-200">
                Reabrir {mesPorExtenso(mes)} de {pessoa.nome}? O fechamento é desfeito{fechado?.lancamento ? " e o lançamento dele sai do Financeiro (se já foi pago, a reabertura é recusada)" : ""}.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmando(null)} disabled={ocupado} className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300">
                  Cancelar
                </button>
                <button type="button" data-confirmar onClick={reabrir} disabled={ocupado} className={BOTAO}>
                  {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirmar reabertura
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {fechado ? (
                <>
                  <p className="mr-auto min-w-0 text-[11px] md:text-xs text-gray-500" data-lancamento={fechado.lancamento?.status ?? "sem"}>
                    {fechado.lancamento ? `No Financeiro: ${formatCurrency(fechado.lancamento.amount)} ${fechado.lancamento.status === "PAID" ? "(pago)" : "(em aberto)"}` : "Sem lançamento no Financeiro"}
                  </p>
                  <Link href={`/dashboard/equipe/fechamento/${fechado.id}/recibo`} data-recibo-do-fechamento className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-700 text-sm font-medium text-blue-700 dark:text-blue-400 px-3 py-2 rounded-xl">
                    <Printer className="w-4 h-4" /> Recibo
                  </Link>
                  {podeFechar && (
                    <button type="button" data-reabrir onClick={() => setConfirmando("reabrir")} disabled={ocupado} className="border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 px-3 py-2 rounded-xl">
                      Reabrir
                    </button>
                  )}
                </>
              ) : podeFechar ? (
                <button type="button" data-fechar-o-mes onClick={() => setConfirmando("fechar")} disabled={ocupado || nadaAFechar} title={nadaAFechar ? "Não há viagem finalizada nem adiantamento em aberto neste mês" : undefined} className={BOTAO}>
                  Fechar o mês
                </button>
              ) : (
                <p className="text-xs text-gray-500">Fechar o mês é do Administrador.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

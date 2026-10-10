"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, LogIn, Package, ShieldAlert, TrendingUp, Wallet } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COLLECTION_STATUS, formatCurrency, formatWeight, statusBadge } from "@/lib/format";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/crm";
import { periodoDoRelatorio, type Relatorio, type Resultado } from "@/lib/relatorios";
import { codigoDaViagem } from "@/lib/viagem";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";

/**
 * Relatórios básicos: operação, comercial e financeiro de um período em meses.
 * A tela só lê; as contas vêm prontas de `/api/relatorios`.
 */

// `resultado` (DRE, margem por cliente e resultado por viagem) vem junto na mesma resposta.
type Resposta = Relatorio & { periodo: { de: string; ate: string }; resultado?: Resultado };

type Carga = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; relatorio: Resposta };

const FALHA = "Não foi possível carregar os relatórios.";

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
const CAMPO = "min-w-0 w-full px-2 py-1.5 md:px-3 md:py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950";

async function carregar(de: string, ate: string): Promise<Carga> {
  try {
    const res = await fetch(`/api/relatorios?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    const corpo = await res.json().catch(() => null);
    if (!res.ok) return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA };
    return { denied: null, erro: null, relatorio: corpo as Resposta };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

const porcento = (valor: number | null) => (valor === null ? "-" : `${valor.toLocaleString("pt-BR")}%`);
const horas = (valor: number | null) => (valor === null ? "-" : `${valor.toLocaleString("pt-BR")} h`);

export default function RelatoriosPage() {
  const [periodo, setPeriodo] = useState(periodoDoRelatorio);
  const [carga, setCarga] = useState<Carga | null>(null);

  useEffect(() => {
    let ativo = true;
    carregar(periodo.de, periodo.ate).then((resultado) => {
      if (ativo) setCarga(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [periodo]);

  const mudarPeriodo = (campo: "de" | "ate", valor: string) => {
    // Campo de mês apagado manda vazio: fica o que estava.
    if (!valor) return;
    setCarga(null);
    setPeriodo((atual) => ({ ...atual, [campo]: valor }));
  };

  if (carga && carga.denied !== null) {
    if (carga.denied === "login") {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LogIn className="w-5 h-5 text-blue-600" />
              Sessão expirada
            </CardTitle>
            <CardDescription>
              Entre de novo para ver os relatórios.{" "}
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
          <CardDescription>Os relatórios são restritos ao perfil Administrador.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2 md:gap-4">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Relatórios</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Operação, comercial e financeiro do período</p>
        </div>
        <div className="flex items-end gap-2 md:gap-3">
          <label className="min-w-0 text-xs text-gray-500">
            De
            <input type="month" value={periodo.de} onChange={(e) => mudarPeriodo("de", e.target.value)} className={`${CAMPO} block mt-1`} />
          </label>
          <label className="min-w-0 text-xs text-gray-500">
            Até
            <input type="month" value={periodo.ate} onChange={(e) => mudarPeriodo("ate", e.target.value)} className={`${CAMPO} block mt-1`} />
          </label>
        </div>
      </div>

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

      {carga && carga.denied === null && carga.erro === null && <Conteudo relatorio={carga.relatorio} />}
    </div>
  );
}

const SECOES = ["Operação", "Comercial", "Financeiro", "Resultado"] as const;

function Conteudo({ relatorio }: { relatorio: Resposta }) {
  const { operacional, comercial, financeiro, resultado } = relatorio;
  const { prazo } = operacional;
  // No celular aparece uma seção por vez, escolhida nas abas; no computador, as três em sequência.
  const [secao, setSecao] = useState<(typeof SECOES)[number]>("Operação");

  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-4">
        <Cartao rotulo="Cargas no período" valor={String(operacional.cargas)} icone={<Package className="w-5 h-5 text-blue-600" />} />
        <Cartao rotulo="Entregas no prazo" valor={porcento(prazo.taxaNoPrazo)} icone={<CheckCircle2 className="w-5 h-5 text-emerald-600" />} />
        <Cartao rotulo="Conversão de cotações" valor={porcento(comercial.conversao)} icone={<TrendingUp className="w-5 h-5 text-violet-600" />} />
        <Cartao
          rotulo="Resultado realizado"
          valor={formatCurrency(financeiro.resultado)}
          alerta={financeiro.resultado < 0}
          icone={<Wallet className="w-5 h-5 text-blue-600" />}
        />
      </div>

      <div role="tablist" aria-label="Seção" className="md:hidden grid grid-cols-4 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
        {SECOES.map((nome) => (
          <button
            key={nome}
            type="button"
            role="tab"
            aria-selected={secao === nome}
            data-aba={nome}
            onClick={() => setSecao(nome)}
            className={`py-1.5 rounded-lg text-[13px] font-semibold ${secao === nome ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
          >
            {nome}
          </button>
        ))}
      </div>

      <Secao ativa={secao} titulo="Operação" descricao="Cargas criadas no período e entregas feitas nele. O prazo corre da coleta à entrega.">
        <Linhas
          itens={[
            ["Entregas", String(prazo.entregas)],
            ["No prazo", String(prazo.noPrazo)],
            ["Fora do prazo", String(prazo.foraDoPrazo)],
            ["Sem medição", String(prazo.semMedicao)],
            ["Tempo médio", horas(prazo.tempoMedioHoras)],
          ]}
        />
        <div className="flex flex-wrap gap-1.5 md:gap-2 px-3 pb-3 md:px-5 md:pb-5">
          {Object.entries(operacional.porStatus).map(([status, quantidade]) => {
            const selo = statusBadge(COLLECTION_STATUS, status);
            return (
              <span key={status} data-status={status} className={`px-2.5 py-1 text-xs border rounded-full ${selo.className}`}>
                {selo.label}: {quantidade}
              </span>
            );
          })}
        </div>
        <Tabela
          vazio="Nenhuma entrega no período."
          colunas={["Motorista", "Entregas", "No prazo", "Fora do prazo", "% no prazo", "Tempo médio"]}
          linhas={operacional.motoristas.map((m) => ({
            chave: m.chave || "sem-motorista",
            celulas: [m.nome, String(m.entregas), String(m.noPrazo), String(m.foraDoPrazo), porcento(m.taxaNoPrazo), horas(m.tempoMedioHoras)],
          }))}
        />
      </Secao>

      <Secao ativa={secao} titulo="Comercial" descricao="Cotações recebidas no período e frete das cargas criadas nele, por cliente.">
        <Linhas
          itens={[
            ["Cotações recebidas", String(comercial.cotacoes)],
            ...LEAD_STATUSES.map((status): [string, string] => [LEAD_STATUS_LABELS[status], String(comercial.porStatus[status] ?? 0)]),
            ["Frete das cargas", formatCurrency(comercial.frete)],
          ]}
        />
        <Tabela
          vazio="Nenhuma carga no período."
          colunas={["Cliente", "Cargas", "Peso", "Frete", "A cotar"]}
          linhas={comercial.clientes.map((c) => ({
            chave: c.clientId,
            celulas: [c.nome, String(c.cargas), formatWeight(c.peso), formatCurrency(c.frete), String(c.aCotar)],
          }))}
        />
      </Secao>

      <Secao ativa={secao} titulo="Financeiro" descricao="Recebido e pago no período, pela data do pagamento e pelo valor que entrou (com juros, multa e desconto). A inadimplência é a posição de hoje.">
        <Linhas
          itens={[
            ["Recebido", formatCurrency(financeiro.recebido)],
            ["Pago", formatCurrency(financeiro.pago)],
            ["Resultado", formatCurrency(financeiro.resultado)],
            ["A receber em aberto", formatCurrency(financeiro.aReceberEmAberto)],
            ["Vencido", formatCurrency(financeiro.vencido)],
            ["Inadimplência", porcento(financeiro.inadimplencia)],
          ]}
        />
        {financeiro.vencido > 0 && (
          <p className="flex items-center gap-2 px-3 pb-3 md:px-5 md:pb-4 text-sm text-red-600">
            <AlertTriangle className="w-4 h-4" />
            <span>
              Há valores vencidos.{" "}
              <Link href="/dashboard/cobranca" className="font-medium underline">
                Ver a cobrança
              </Link>
            </span>
          </p>
        )}
        <Tabela
          vazio="Nenhuma despesa paga no período."
          colunas={["Despesa por categoria", "Total"]}
          linhas={financeiro.despesasPorCategoria.map((d) => ({ chave: d.categoria, celulas: [d.categoria, formatCurrency(d.total)] }))}
        />
        {/* Só as despesas pagas no período; sem nenhuma, a tabela de categorias acima já disse isso. */}
        {financeiro.despesasPorCentroDeCusto.length > 0 && (
          <Tabela
            vazio=""
            colunas={["Despesa por centro de custo", "Total"]}
            linhas={financeiro.despesasPorCentroDeCusto.map((d) => ({ chave: `centro:${d.centro}`, celulas: [d.centro, formatCurrency(d.total)] }))}
          />
        )}
        {/* DRE básico: a receita recebida por categoria fecha a conta com as despesas por categoria acima. */}
        {resultado && resultado.dre.receitas.length > 0 && (
          <Tabela
            vazio=""
            colunas={["DRE: receita por categoria", "Total"]}
            linhas={[
              ...resultado.dre.receitas.map((r) => ({ chave: `receita:${r.categoria}`, celulas: [r.categoria, formatCurrency(r.total)] })),
              { chave: "dre:despesas", celulas: ["(−) Despesas pagas", formatCurrency(resultado.dre.despesa)] },
              { chave: "dre:resultado", celulas: [`(=) Resultado${resultado.dre.margem === null ? "" : ` (${porcento(resultado.dre.margem)})`}`, formatCurrency(resultado.dre.resultado)] },
            ]}
          />
        )}
      </Secao>

      {resultado && (
        <Secao
          ativa={secao}
          titulo="Resultado"
          descricao="Margem das cargas entregues no período, por cliente, com o custo das viagens rateado pelo peso, e o resultado das viagens finalizadas nele."
        >
          <Linhas
            itens={[
              ["Frete das viagens", formatCurrency(resultado.totalDasViagens.frete)],
              ["Custo das viagens", formatCurrency(resultado.totalDasViagens.custo)],
              ["Resultado", formatCurrency(resultado.totalDasViagens.resultado)],
              ["Margem", porcento(resultado.totalDasViagens.margem)],
              ["Viagens", String(resultado.viagens.length)],
              ["Clientes", String(resultado.clientes.length)],
            ]}
          />
          <Tabela
            vazio="Nenhuma carga entregue no período."
            colunas={["Cliente", "Frete", "Custo", "Resultado", "Margem"]}
            linhas={resultado.clientes.map((c) => ({
              chave: `margem:${c.clientId}`,
              celulas: [c.nome, formatCurrency(c.frete), formatCurrency(c.custo), formatCurrency(c.resultado), porcento(c.margem)],
            }))}
          />
          <Tabela
            vazio="Nenhuma viagem finalizada no período."
            colunas={["Viagem", "Frete", "Custo", "Resultado", "Margem"]}
            linhas={resultado.viagens.map((v) => ({
              chave: `viagem:${v.id}`,
              celulas: [`#${codigoDaViagem(v.id)} · ${v.motorista}`, formatCurrency(v.frete), formatCurrency(v.custo), formatCurrency(v.resultado), porcento(v.margem)],
            }))}
          />
        </Secao>
      )}
    </>
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

function Secao({ ativa, titulo, descricao, children }: { ativa: string; titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <section className={`${ativa === titulo ? "" : "hidden md:block "}${CARD} overflow-hidden`} aria-label={titulo}>
      <div className="px-3 pt-3 md:px-5 md:pt-5">
        <h2 className="hidden md:block text-lg font-semibold text-gray-900 dark:text-white">{titulo}</h2>
        <p className="md:mt-1 text-xs md:text-sm text-gray-500">{descricao}</p>
      </div>
      {children}
    </section>
  );
}

function Linhas({ itens }: { itens: [string, string][] }) {
  return (
    <dl className="grid grid-cols-3 gap-x-2 gap-y-3 p-3 md:gap-4 md:p-5 lg:grid-cols-6">
      {itens.map(([rotulo, valor]) => (
        <div key={rotulo} data-linha={rotulo}>
          <dt className="text-[11px] md:text-xs leading-tight text-gray-500">{rotulo}</dt>
          <dd className="mt-0.5 md:mt-1 text-sm md:text-base font-semibold text-gray-900 dark:text-white">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Tabela({ colunas, linhas, vazio }: { colunas: string[]; linhas: { chave: string; celulas: string[] }[]; vazio: string }) {
  if (linhas.length === 0) return <p className="px-3 pb-3 md:px-5 md:pb-6 text-sm text-gray-500">{vazio}</p>;

  return (
    <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
          <tr>
            {colunas.map((coluna, i) => (
              <th key={coluna} className={`px-2 py-2 md:px-4 md:py-3 text-xs md:text-sm font-medium ${i === 0 ? "" : "text-right"}`}>
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {linhas.map((linha) => (
            <tr key={linha.chave} data-linha-da-tabela={linha.chave}>
              {linha.celulas.map((celula, i) => (
                <td key={i} className={`px-2 py-2 md:px-4 md:py-3 ${i === 0 ? "font-medium text-gray-900 dark:text-white" : "text-right text-gray-600 dark:text-gray-300"}`}>
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

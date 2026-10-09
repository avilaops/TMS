"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, LogIn, Package, ShieldAlert, TrendingUp, Wallet } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COLLECTION_STATUS, formatCurrency, formatWeight, statusBadge } from "@/lib/format";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/crm";
import { periodoDoRelatorio, type Relatorio } from "@/lib/relatorios";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";

/**
 * Relatórios básicos: operação, comercial e financeiro de um período em meses.
 * A tela só lê; as contas vêm prontas de `/api/relatorios`.
 */

type Resposta = Relatorio & { periodo: { de: string; ate: string } };

type Carga = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; relatorio: Resposta };

const FALHA = "Não foi possível carregar os relatórios.";

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
const CAMPO = "px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950";

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Relatórios</h1>
          <p className="text-gray-500 text-sm mt-1">Operação, comercial e financeiro do período</p>
        </div>
        <div className="flex items-end gap-3">
          <label className="text-xs text-gray-500">
            De
            <input type="month" value={periodo.de} onChange={(e) => mudarPeriodo("de", e.target.value)} className={`${CAMPO} block mt-1`} />
          </label>
          <label className="text-xs text-gray-500">
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

function Conteudo({ relatorio }: { relatorio: Resposta }) {
  const { operacional, comercial, financeiro } = relatorio;
  const { prazo } = operacional;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <Secao titulo="Operação" descricao="Cargas criadas no período e entregas feitas nele. O prazo corre da coleta à entrega.">
        <Linhas
          itens={[
            ["Entregas", String(prazo.entregas)],
            ["No prazo", String(prazo.noPrazo)],
            ["Fora do prazo", String(prazo.foraDoPrazo)],
            ["Sem medição", String(prazo.semMedicao)],
            ["Tempo médio da coleta à entrega", horas(prazo.tempoMedioHoras)],
          ]}
        />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
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

      <Secao titulo="Comercial" descricao="Cotações recebidas no período e frete das cargas criadas nele, por cliente.">
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

      <Secao titulo="Financeiro" descricao="Recebido e pago no período, pela data do pagamento. A inadimplência é a posição de hoje.">
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
          <p className="flex items-center gap-2 px-5 pb-4 text-sm text-red-600">
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
      </Secao>
    </>
  );
}

function Cartao({ rotulo, valor, icone, alerta = false }: { rotulo: string; valor: string; icone: React.ReactNode; alerta?: boolean }) {
  return (
    <div className={`${CARD} p-5`} data-cartao={rotulo}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rotulo}</p>
        {icone}
      </div>
      <p className={`mt-2 text-xl font-bold ${alerta ? "text-red-600" : "text-gray-900 dark:text-white"}`}>{valor}</p>
    </div>
  );
}

function Secao({ titulo, descricao, children }: { titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <section className={`${CARD} overflow-hidden`} aria-label={titulo}>
      <div className="px-5 pt-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{titulo}</h2>
        <p className="mt-1 text-sm text-gray-500">{descricao}</p>
      </div>
      {children}
    </section>
  );
}

function Linhas({ itens }: { itens: [string, string][] }) {
  return (
    <dl className="grid gap-4 p-5 sm:grid-cols-3 lg:grid-cols-6">
      {itens.map(([rotulo, valor]) => (
        <div key={rotulo} data-linha={rotulo}>
          <dt className="text-xs text-gray-500">{rotulo}</dt>
          <dd className="mt-1 font-semibold text-gray-900 dark:text-white">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Tabela({ colunas, linhas, vazio }: { colunas: string[]; linhas: { chave: string; celulas: string[] }[]; vazio: string }) {
  if (linhas.length === 0) return <p className="px-5 pb-6 text-sm text-gray-500">{vazio}</p>;

  return (
    <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-800">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
          <tr>
            {colunas.map((coluna, i) => (
              <th key={coluna} className={`px-4 py-3 font-medium ${i === 0 ? "" : "text-right"}`}>
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {linhas.map((linha) => (
            <tr key={linha.chave} data-linha-da-tabela={linha.chave}>
              {linha.celulas.map((celula, i) => (
                <td key={i} className={`px-4 py-3 ${i === 0 ? "font-medium text-gray-900 dark:text-white" : "text-right text-gray-600 dark:text-gray-300"}`}>
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

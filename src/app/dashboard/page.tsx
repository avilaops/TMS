"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { Users, Truck, Package, PackageCheck, DollarSign, FileText, Loader2, AlertTriangle, LogIn, Eye, EyeOff, CheckCircle2, Circle, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatCurrency } from "@/lib/format";
import {
  alternarReceitaOculta,
  assinarReceitaOculta,
  loadStats,
  primeirosPassos,
  receitaEstaOculta,
  showFinance,
  type PainelState,
} from "./painel";

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// Classes escritas por extenso: o Tailwind só gera o que encontra no código.
const CORES = {
  green: { fundo: "bg-green-50 dark:bg-green-900/20", texto: "text-green-700 dark:text-green-400" },
  blue: { fundo: "bg-blue-50 dark:bg-blue-900/20", texto: "text-blue-700 dark:text-blue-400" },
  orange: { fundo: "bg-orange-50 dark:bg-orange-900/20", texto: "text-orange-700 dark:text-orange-400" },
  purple: { fundo: "bg-purple-50 dark:bg-purple-900/20", texto: "text-purple-700 dark:text-purple-400" },
} as const;

type Cartao = {
  title: string;
  href: string;
  value: number | string;
  icon: LucideIcon;
  chip: string;
  cor: keyof typeof CORES;
  /** Linha de baixo: o segundo número do cartão. */
  apoio: string;
  /** Convite para o primeiro cadastro, quando ainda não há nada; toma o lugar do `apoio`. */
  vazio: string | null;
  ocultavel: boolean;
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const [state, setState] = useState<PainelState>({ status: "loading" });

  const fetchStats = useCallback(async () => {
    setState({ status: "loading" });
    const result = await loadStats(() => fetch('/api/dashboard'));
    if (result.status === "error" || result.status === "expired") console.error("Dashboard API error:", result.cause);
    setState(result);
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const receitaOculta = useSyncExternalStore(assinarReceitaOculta, receitaEstaOculta, () => false);

  const isLoading = state.status === "loading";
  const expired = state.status === "expired";
  const failed = state.status === "error" || expired;
  const stats = state.status === "ready" ? state.stats : undefined;
  const finance = showFinance(state, session?.user?.role);

  // Com erro, o valor vira "—": zero pareceria um número de verdade.
  const value = (v: number | string) => (failed ? "—" : v);
  const trend = (label: string) => (failed ? "Indisponível" : label);

  const detalhe = stats?.detalhe;
  const pronto = state.status === "ready";

  // Cada cartão leva à lista correspondente. `vazio` troca a linha de baixo por
  // um convite para o primeiro cadastro, em vez de deixar só um zero na tela.
  const statCards: Cartao[] = [
    ...(finance
      ? [{
          title: "Receita",
          href: "/dashboard/financeiro",
          value: value(receitaOculta ? "R$ ••••" : formatCurrency(stats?.receita || 0)),
          icon: DollarSign,
          chip: trend("Recebida"),
          cor: "green" as const,
          apoio: receitaOculta ? "Valor escondido" : `${formatCurrency(stats?.receitaDoMes ?? 0)} neste mês`,
          vazio: (stats?.receita ?? 0) === 0 ? "Lançar receita" : null,
          ocultavel: true,
        }]
      : []),
    {
      title: "Coletas",
      href: "/dashboard/coletas",
      value: value(detalhe?.coletasAtivas ?? stats?.coletas ?? 0),
      icon: Package,
      chip: trend("Ativas"),
      cor: "blue",
      apoio: `${detalhe?.coletasEntregues ?? 0} entregues`,
      vazio: (stats?.coletas ?? 0) === 0 ? "Emitir minuta" : null,
      ocultavel: false,
    },
    {
      title: "Viagens (MDF-e)",
      href: "/dashboard/manifestos",
      value: value(detalhe?.viagensEmRota ?? 0),
      icon: Truck,
      chip: trend("Em rota"),
      cor: "orange",
      apoio: `${detalhe?.viagensEmMontagem ?? 0} em montagem · ${detalhe?.viagensFinalizadas ?? 0} finalizadas`,
      vazio: (stats?.manifestos ?? 0) === 0 ? "Montar viagem" : null,
      ocultavel: false,
    },
    {
      title: "Clientes",
      href: "/dashboard/clientes",
      value: value(detalhe?.clientesAtivos ?? stats?.clientes ?? 0),
      icon: Users,
      chip: trend("Ativos"),
      cor: "purple",
      apoio: `${detalhe?.clientesInativos ?? 0} inativos`,
      vazio: (stats?.clientes ?? 0) === 0 ? "Cadastrar cliente" : null,
      ocultavel: false,
    },
  ];

  const entregas = stats?.entregasDaSemana ?? DIAS.map(() => 0);
  const maiorDia = Math.max(...entregas, 1);
  const semEntregas = pronto && entregas.every((quantidade) => quantidade === 0);
  const passos = stats ? primeirosPassos(stats) : [];
  const faltamPassos = passos.some((passo) => !passo.feito);

  const acoes = [
    { href: "/dashboard/coletas", rotulo: "Emitir Minuta", icone: Package, cor: "blue" as const },
    { href: "/dashboard/manifestos", rotulo: "Nova Viagem", icone: Truck, cor: "orange" as const },
    { href: "/dashboard/fiscal", rotulo: "Importar NF-e", icone: FileText, cor: "purple" as const },
    ...(finance ? [{ href: "/dashboard/financeiro", rotulo: "Novo Lançamento", icone: DollarSign, cor: "green" as const }] : []),
  ];

  return (
    <div className="space-y-3 md:space-y-6">
      {expired && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <span className="flex items-center gap-2">
            <LogIn className="w-5 h-5 shrink-0" />
            Sessão expirada. Entre novamente para ver os indicadores.
          </span>
          <Link href="/login" className="font-medium underline underline-offset-2 hover:no-underline">
            Entrar novamente
          </Link>
        </div>
      )}

      {failed && !expired && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            Não foi possível carregar os indicadores.
          </span>
          <button onClick={fetchStats} className="font-medium underline underline-offset-2 hover:no-underline">
            Tentar de novo
          </button>
        </div>
      )}

      {/* Cartões: dois por linha no celular, para o painel caber numa tela só */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        {statCards.map((stat, i) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={stat.title}
            data-cartao={stat.title}
            className="relative bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-3 py-2.5 md:p-6 rounded-2xl md:rounded-3xl shadow-lg shadow-gray-200/40 hover:shadow-xl transition-all group"
          >
            <div className="flex items-center justify-between mb-1 md:mb-4">
              <div className={`w-7 h-7 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center shadow-sm ${CORES[stat.cor].fundo}`}>
                <stat.icon className={`w-4 h-4 md:w-6 md:h-6 ${CORES[stat.cor].texto}`} />
              </div>
              <span className={`text-[10px] md:text-xs font-bold px-2 py-1 md:px-3 md:py-1.5 rounded-full ${failed ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : `${CORES[stat.cor].fundo} ${CORES[stat.cor].texto}`}`}>
                {stat.chip}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              {/* O link cobre o cartão inteiro; o botão do olho fica por cima dele. */}
              <Link href={stat.href} className="text-gray-500 dark:text-gray-400 text-xs md:text-sm font-medium after:absolute after:inset-0 after:rounded-2xl">
                {stat.title}
              </Link>
              {stat.ocultavel && (
                <button
                  type="button"
                  onClick={alternarReceitaOculta}
                  aria-pressed={receitaOculta}
                  aria-label={receitaOculta ? "Mostrar a receita" : "Esconder a receita"}
                  className="relative z-10 p-2 -m-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  {receitaOculta ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
            <p className="text-xl md:text-3xl font-extrabold font-outfit text-gray-900 dark:text-white mt-0.5 md:mt-1 whitespace-nowrap">
              {isLoading ? <Loader2 className="w-5 h-5 md:w-6 md:h-6 animate-spin my-1 md:my-2" /> : stat.value}
            </p>
            {pronto && (
              <p data-apoio className={`mt-0.5 text-[11px] md:text-xs leading-tight truncate ${stat.vazio ? "font-semibold text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"}`}>
                {stat.vazio ? `${stat.vazio} →` : stat.apoio}
              </p>
            )}
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-6">
        <div className="lg:col-span-2">
          {faltamPassos ? (
            <div data-primeiros-passos className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl md:rounded-3xl px-4 py-3 md:p-6 shadow-sm">
              <div className="flex items-baseline justify-between gap-2 mb-2 md:mb-4">
                <h3 className="font-outfit font-bold text-base md:text-lg text-gray-900 dark:text-white">Primeiros passos</h3>
                <span className="text-xs text-gray-500">
                  {passos.filter((passo) => passo.feito).length} de {passos.length}
                </span>
              </div>
              <ol>
                {passos.map((passo) => (
                  <li key={passo.titulo} data-passo={passo.feito ? "feito" : "a-fazer"}>
                    <Link href={passo.href} className="flex items-center gap-2 py-1 md:py-1.5 text-sm">
                      {passo.feito ? (
                        <CheckCircle2 className="w-5 h-5 shrink-0 text-green-600" />
                      ) : (
                        <Circle className="w-5 h-5 shrink-0 text-gray-300 dark:text-gray-600" />
                      )}
                      <span className={passo.feito ? "text-gray-400 line-through" : "font-medium text-gray-800 dark:text-gray-200"}>{passo.titulo}</span>
                      {!passo.feito && <span className="ml-auto text-blue-600 dark:text-blue-400">→</span>}
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl md:rounded-3xl px-4 py-3 md:p-6 shadow-sm overflow-hidden relative">
              <h3 className="font-outfit font-bold text-base md:text-lg mb-2 md:mb-6 text-gray-900 dark:text-white">Entregas na semana</h3>

              {semEntregas ? (
                <div data-sem-entregas className="h-24 md:h-48 flex flex-col items-center justify-center text-center gap-2">
                  <PackageCheck className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                  <p className="text-sm text-gray-500">Ainda não há entregas nesta semana.</p>
                  <Link href="/dashboard/manifestos" className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    Ver as viagens →
                  </Link>
                </div>
              ) : (
                <div className="flex justify-between space-x-2 px-1 md:px-2" data-grafico="entregas-da-semana">
                  {DIAS.map((dia, idx) => {
                    const quantidade = failed ? 0 : entregas[idx] ?? 0;
                    return (
                      <div key={dia} className="flex-1 flex flex-col items-center" data-dia={dia}>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{failed || isLoading ? "—" : quantidade}</span>
                        <div className="mt-1 h-14 md:h-40 w-full bg-blue-50 dark:bg-blue-900/20 rounded-t-lg flex items-end">
                          <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: `${(quantidade / maiorDia) * 100}%` }}
                            transition={{ duration: 0.6, delay: idx * 0.05 }}
                            className="w-full bg-blue-600 rounded-t-lg"
                          ></motion.div>
                        </div>
                        <span className="mt-1 text-xs text-gray-500 font-medium">{dia}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Com os primeiros passos na tela, o celular dispensa as ações rápidas: os passos já são os atalhos. */}
        <div className={faltamPassos ? "hidden lg:block" : ""}>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl md:rounded-3xl px-4 py-3 md:p-6 shadow-sm">
            <h3 className="font-outfit font-bold text-base md:text-lg mb-2 md:mb-4 text-gray-900 dark:text-white">Ações Rápidas</h3>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 md:gap-3">
              {acoes.map((acao) => (
                <Link
                  key={acao.rotulo}
                  href={acao.href}
                  data-acao={acao.rotulo}
                  className="flex items-center gap-2 md:gap-3 min-h-11 px-2 py-1 md:p-3 rounded-2xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <div className={`w-8 h-8 md:w-10 md:h-10 shrink-0 rounded-xl flex items-center justify-center ${CORES[acao.cor].fundo}`}>
                    <acao.icone className={`w-4 h-4 md:w-5 md:h-5 ${CORES[acao.cor].texto}`} />
                  </div>
                  <span className="font-medium text-sm leading-tight text-gray-700 dark:text-gray-300">{acao.rotulo}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

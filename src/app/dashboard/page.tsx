"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { Users, Truck, Package, DollarSign, Loader2, AlertTriangle, LogIn, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatCurrency } from "@/lib/format";
import {
  alternarReceitaOculta,
  assinarReceitaOculta,
  loadStats,
  receitaEstaOculta,
  showFinance,
  type PainelState,
} from "./painel";

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

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

  const statCards = [
    ...(finance
      ? [{
          title: "Receita",
          value: value(receitaOculta ? "R$ ••••" : formatCurrency(stats?.receita || 0)),
          icon: DollarSign,
          trend: trend("Recebida"),
          trendUp: !failed,
          color: "green",
          ocultavel: true,
        }]
      : []),
    { title: "Coletas", value: value(stats?.coletas || 0), icon: Package, trend: trend("Ativas"), trendUp: !failed, color: "blue", ocultavel: false },
    { title: "Viagens (MDF-e)", value: value(stats?.manifestos || 0), icon: Truck, trend: trend("Em Rota"), trendUp: !failed, color: "purple", ocultavel: false },
    { title: "Clientes", value: value(stats?.clientes || 0), icon: Users, trend: trend("Registrados"), trendUp: !failed, color: "indigo", ocultavel: false },
  ];

  const entregas = stats?.entregasDaSemana ?? DIAS.map(() => 0);
  const maiorDia = Math.max(...entregas, 1);

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

      {/* KPI Cards: dois por linha no celular, para o painel caber numa tela só */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        {statCards.map((stat, i) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={i}
            data-cartao={stat.title}
            className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-3 md:p-6 rounded-2xl md:rounded-3xl shadow-lg shadow-gray-200/40 hover:shadow-xl transition-all group"
          >
            <div className="flex items-center justify-between mb-2 md:mb-4">
              <div className={`w-8 h-8 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-${stat.color}-50 dark:bg-${stat.color}-900/20 flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm`}>
                <stat.icon className={`w-4 h-4 md:w-6 md:h-6 text-${stat.color}-600 dark:text-${stat.color}-400`} />
              </div>
              <span className={`text-[10px] md:text-xs font-bold px-2 py-1 md:px-3 md:py-1.5 rounded-full ${
                stat.trendUp
                  ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}>
                {stat.trend}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-gray-500 dark:text-gray-400 text-xs md:text-sm font-medium">{stat.title}</h3>
              {stat.ocultavel && (
                <button
                  type="button"
                  onClick={alternarReceitaOculta}
                  aria-pressed={receitaOculta}
                  aria-label={receitaOculta ? "Mostrar a receita" : "Esconder a receita"}
                  className="p-1 -m-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  {receitaOculta ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
            <p className="text-lg md:text-3xl font-bold font-outfit text-gray-900 dark:text-white mt-0.5 md:mt-1 whitespace-nowrap">
              {isLoading ? <Loader2 className="w-5 h-5 md:w-6 md:h-6 animate-spin my-1 md:my-2" /> : stat.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-6">
        {/* Left Column (Wider) */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl md:rounded-3xl p-4 md:p-6 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 p-32 bg-blue-50 dark:bg-blue-900/10 rounded-full blur-3xl -z-10 opacity-50"></div>

            <h3 className="font-outfit font-bold text-base md:text-lg mb-3 md:mb-6 text-gray-900 dark:text-white">Entregas na semana</h3>

            <div className="flex justify-between space-x-2 px-1 md:px-2" data-grafico="entregas-da-semana">
              {DIAS.map((dia, idx) => {
                const quantidade = failed ? 0 : entregas[idx] ?? 0;
                return (
                  <div key={dia} className="flex-1 flex flex-col items-center" data-dia={dia}>
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{failed || isLoading ? "—" : quantidade}</span>
                    <div className="mt-1 h-20 md:h-40 w-full bg-blue-50 dark:bg-blue-900/20 rounded-t-lg flex items-end">
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
          </div>
        </div>

        {/* Right Column */}
        <div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl md:rounded-3xl p-4 md:p-6 shadow-sm">
            <h3 className="font-outfit font-bold text-base md:text-lg mb-3 md:mb-4 text-gray-900 dark:text-white">Ações Rápidas</h3>
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
              <Link href="/dashboard/coletas" className="flex items-center justify-between p-2 md:p-3 rounded-2xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                <div className="flex items-center space-x-2 md:space-x-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 shrink-0 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center">
                    <Package className="w-4 h-4 md:w-5 md:h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="font-medium text-sm text-gray-700 dark:text-gray-300">Emitir Minuta</span>
                </div>
                <div className="hidden md:flex w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 transition-colors">
                  <span className="text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">→</span>
                </div>
              </Link>

              {finance && (
                <Link href="/dashboard/financeiro" className="flex items-center justify-between p-2 md:p-3 rounded-2xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                  <div className="flex items-center space-x-2 md:space-x-3">
                    <div className="w-8 h-8 md:w-10 md:h-10 shrink-0 bg-green-50 dark:bg-green-900/20 rounded-xl flex items-center justify-center">
                      <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <span className="font-medium text-sm text-gray-700 dark:text-gray-300">Novo Lançamento</span>
                  </div>
                  <div className="hidden md:flex w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 items-center justify-center group-hover:bg-green-100 dark:group-hover:bg-green-900/50 transition-colors">
                    <span className="text-gray-400 group-hover:text-green-600 dark:group-hover:text-green-400">→</span>
                  </div>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

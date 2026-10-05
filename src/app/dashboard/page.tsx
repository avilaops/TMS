"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Truck, Package, Activity, DollarSign, Loader2, AlertTriangle, LogIn } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { loadStats, showFinance, type PainelState } from "./painel";

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
      ? [{ title: "Receita", value: value(`R$ ${(stats?.receita || 0).toFixed(2)}`), icon: DollarSign, trend: trend("+15%"), trendUp: !failed, color: "green" }]
      : []),
    { title: "Coletas", value: value(stats?.coletas || 0), icon: Package, trend: trend("Ativas"), trendUp: !failed, color: "blue" },
    { title: "Viagens (MDF-e)", value: value(stats?.manifestos || 0), icon: Truck, trend: trend("Em Rota"), trendUp: !failed, color: "purple" },
    { title: "Clientes", value: value(stats?.clientes || 0), icon: Users, trend: trend("Registrados"), trendUp: !failed, color: "indigo" },
  ];

  return (
    <div className="space-y-6">
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={i}
            className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-3xl shadow-lg shadow-gray-200/40 hover:shadow-xl transition-all group"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`w-12 h-12 rounded-2xl bg-${stat.color}-50 dark:bg-${stat.color}-900/20 flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm`}>
                <stat.icon className={`w-6 h-6 text-${stat.color}-600 dark:text-${stat.color}-400`} />
              </div>
              <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                stat.trendUp 
                  ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" 
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}>
                {stat.trend}
              </span>
            </div>
            <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium">{stat.title}</h3>
            <p className="text-3xl font-bold font-outfit text-gray-900 dark:text-white mt-1">
              {isLoading ? <Loader2 className="w-6 h-6 animate-spin my-2" /> : stat.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (Wider) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 p-32 bg-blue-50 dark:bg-blue-900/10 rounded-full blur-3xl -z-10 opacity-50"></div>
            
            <h3 className="font-outfit font-bold text-lg mb-6 text-gray-900 dark:text-white">Desempenho da Frota (Semanal)</h3>
            
            {/* Simulação de um gráfico simples com div bars */}
            <div className="h-48 flex items-end justify-between px-2 pb-4 space-x-2">
              {[40, 70, 45, 90, 65, 85, 30].map((h, idx) => (
                <div key={idx} className="w-full bg-blue-100 dark:bg-blue-900/30 rounded-t-lg relative group">
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: `${h}%` }}
                    transition={{ duration: 1, delay: idx * 0.1 }}
                    className="absolute bottom-0 w-full bg-blue-600 rounded-t-lg shadow-[0_0_15px_rgba(37,99,235,0.3)] group-hover:bg-blue-500 transition-colors"
                  ></motion.div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 font-medium px-2">
              <span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span><span>Dom</span>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-sm">
            <h3 className="font-outfit font-bold text-lg mb-4 text-gray-900 dark:text-white">Ações Rápidas</h3>
            <div className="space-y-3">
              <Link href="/dashboard/coletas" className="w-full flex items-center justify-between p-3 rounded-2xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center">
                    <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="font-medium text-sm text-gray-700 dark:text-gray-300">Emitir Minuta</span>
                </div>
                <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 transition-colors">
                  <span className="text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">→</span>
                </div>
              </Link>

              {finance && (
                <Link href="/dashboard/financeiro" className="w-full flex items-center justify-between p-3 rounded-2xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-green-50 dark:bg-green-900/20 rounded-xl flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <span className="font-medium text-sm text-gray-700 dark:text-gray-300">Novo Lançamento</span>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center group-hover:bg-green-100 dark:group-hover:bg-green-900/50 transition-colors">
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

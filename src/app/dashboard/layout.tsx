"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { sair } from "@/lib/sair";
import { SimboloDaEmpresa, useIdentidade } from "@/components/empresa/identidade";
import { Menu, X, LogOut } from "lucide-react";
import { motion } from "framer-motion";
import { Avisos, Sininho } from "@/components/notificacoes/Sininho";
import { secoesDoMenu } from "./menu";

// Enquanto o nome da empresa não chega (ou se a leitura falhar), o cabeçalho mostra o do sistema.
const NOME_PADRAO = "TMS";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const identidade = useIdentidade();

  const nome = identidade?.name ?? NOME_PADRAO;
  const logo = identidade?.logo ?? null;
  // O menu mostra só o que o perfil pode abrir (src/app/dashboard/menu.ts).
  const secoes = secoesDoMenu(session?.user?.role);

  return (
    <Avisos area="dashboard">
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        <div className="flex items-center space-x-2 min-w-0">
          <SimboloDaEmpresa logo={logo} />
          <span data-empresa className="font-outfit font-bold text-lg dark:text-white truncate">{nome}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Sininho className="p-2 text-gray-600 dark:text-gray-300" />
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2">
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -300 }}
        animate={{ x: isMobileMenuOpen ? 0 : 0 }}
        className={`fixed md:sticky top-[65px] md:top-0 left-0 h-[calc(100dvh-65px)] md:h-screen w-full md:w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col transition-transform z-40 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* No celular o nome e o símbolo já estão no cabeçalho, logo acima do menu. */}
        <div className="hidden md:flex p-6 items-center space-x-3">
          <SimboloDaEmpresa logo={logo} tamanho="grande" />
          <span className="font-outfit font-bold text-xl dark:text-white truncate">{nome}</span>
        </div>

        <nav className="flex-1 px-4 py-0 md:py-2 overflow-y-auto">
          {secoes.map((secao) => (
            <div key={secao.titulo ?? "inicio"} data-secao={secao.titulo ?? ""}>
              {secao.titulo && (
                <p className="px-3 md:px-4 pt-2 md:pt-3 pb-0.5 md:pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{secao.titulo}</p>
              )}
              {/* No celular os links vão dois por linha: o menu inteiro cabe numa tela. */}
              <div className="grid grid-cols-2 gap-x-1 md:block">
              {secao.links.map((link) => {
                // A seção fica marcada também nas telas de dentro (uma fatura, um comprovante).
                const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(`${link.href}/`));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center space-x-2 md:space-x-3 min-w-0 min-h-11 px-3 md:px-4 py-2 md:py-2.5 rounded-xl text-sm md:text-base transition-all ${
                      isActive
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                        : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    <link.icon className={`w-5 h-5 shrink-0 ${isActive ? "text-blue-600 dark:text-blue-400" : ""}`} />
                    <span className="truncate">{link.label}</span>
                  </Link>
                );
              })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-2 px-4 py-2 md:block md:p-4 border-t border-gray-200 dark:border-gray-800">
          <div className="flex flex-1 min-w-0 items-center space-x-3 md:mb-4 px-2">
            <div className="w-9 h-9 md:w-10 md:h-10 shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold">
              {session?.user?.name?.charAt(0) || "U"}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {session?.user?.name || "Usuário"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {session?.user?.email}
              </p>
            </div>
          </div>
          <button
            onClick={() => sair()}
            className="md:w-full shrink-0 flex items-center space-x-2 md:space-x-3 px-3 md:px-4 py-2.5 md:py-3 rounded-xl text-sm md:text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span className="md:hidden">Sair</span>
            <span className="hidden md:inline">Sair do sistema</span>
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:min-h-screen min-w-0 max-w-full">
        {/* Top Header */}
        <header className="hidden md:flex h-20 items-center justify-between px-8 bg-white/50 dark:bg-gray-950/50 backdrop-blur-md sticky top-0 z-30 border-b border-gray-200/50 dark:border-gray-800/50">
          <h2 className="text-xl font-bold font-outfit text-gray-800 dark:text-gray-100 capitalize">
            {pathname.split("/").pop() === "dashboard" ? "Visão Geral" : pathname.split("/").pop()}
          </h2>
          <div className="flex items-center space-x-4">
            <Sininho />
          </div>
        </header>

        <div className="p-3 md:p-8 flex-1 animate-fade-in">
          {children}
        </div>
      </main>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </div>
    </Avisos>
  );
}

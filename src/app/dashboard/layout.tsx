"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { sair } from "@/lib/sair";
import {
  LayoutDashboard,
  Users,
  CarFront,
  Truck,
  Menu,
  X,
  LogOut,
  Bell,
  Package,
  Route,
  FileText,
  DollarSign,
  UserPlus,
  UserCog,
  ClipboardCheck,
  Calculator,
  Receipt,
  Banknote,
  BarChart3
} from "lucide-react";
import { motion } from "framer-motion";

// `roles` restringe o link a esses perfis. É só o menu: quem decide o acesso é
// a API (`requireStaff`), que devolve 403 para o perfil errado.
const sidebarLinks: { href: string; icon: typeof Truck; label: string; roles?: string[] }[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Visão Geral" },
  { href: "/dashboard/crm", icon: UserPlus, label: "CRM" },
  { href: "/dashboard/clientes", icon: Users, label: "Clientes" },
  { href: "/dashboard/tabelas-frete", icon: Calculator, label: "Tabelas de frete" },
  { href: "/dashboard/coletas", icon: Package, label: "Minutas" },
  { href: "/dashboard/manifestos", icon: Route, label: "Manifestos" },
  { href: "/dashboard/comprovantes", icon: ClipboardCheck, label: "Comprovantes" },
  { href: "/dashboard/fiscal/cte", icon: FileText, label: "Emissão CT-e" },
  { href: "/dashboard/faturamento", icon: Receipt, label: "Faturamento", roles: ["ADMIN"] },
  { href: "/dashboard/cobranca", icon: Banknote, label: "Cobrança", roles: ["ADMIN"] },
  { href: "/dashboard/financeiro", icon: DollarSign, label: "Financeiro", roles: ["ADMIN"] },
  { href: "/dashboard/relatorios", icon: BarChart3, label: "Relatórios", roles: ["ADMIN"] },
  { href: "/dashboard/motoristas", icon: CarFront, label: "Motoristas" },
  { href: "/dashboard/veiculos", icon: Truck, label: "Veículos" },
  { href: "/dashboard/mensagens", icon: Bell, label: "Mensageria" },
  { href: "/dashboard/usuarios", icon: UserCog, label: "Usuários", roles: ["ADMIN"] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const role = session?.user?.role;
  const visibleLinks = sidebarLinks.filter((link) => !link.roles || (role && link.roles.includes(role)));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Truck className="text-white w-4 h-4" />
          </div>
          <span className="font-outfit font-bold text-lg dark:text-white">Mello</span>
        </div>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2">
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -300 }}
        animate={{ x: isMobileMenuOpen ? 0 : 0 }}
        className={`fixed md:sticky top-0 left-0 h-screen w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col transition-transform z-40 ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-6 flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Truck className="text-white w-5 h-5" />
          </div>
          <span className="font-outfit font-bold text-xl dark:text-white">Mello Gestão</span>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {visibleLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <link.icon className={`w-5 h-5 ${isActive ? "text-blue-600 dark:text-blue-400" : ""}`} />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center space-x-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold">
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
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span>Sair do sistema</span>
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen max-w-full">
        {/* Top Header */}
        <header className="hidden md:flex h-20 items-center justify-between px-8 bg-white/50 dark:bg-gray-950/50 backdrop-blur-md sticky top-0 z-30 border-b border-gray-200/50 dark:border-gray-800/50">
          <h2 className="text-xl font-bold font-outfit text-gray-800 dark:text-gray-100 capitalize">
            {pathname.split("/").pop() === "dashboard" ? "Visão Geral" : pathname.split("/").pop()}
          </h2>
          <div className="flex items-center space-x-4">
            <button className="w-10 h-10 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 flex items-center justify-center text-gray-500 hover:text-blue-600 transition-colors relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            </button>
          </div>
        </header>

        <div className="p-4 md:p-8 flex-1 animate-fade-in">
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
  );
}

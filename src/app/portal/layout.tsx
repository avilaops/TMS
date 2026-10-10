"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { sair } from "@/lib/sair";
import { SimboloDaEmpresa, useIdentidade } from "@/components/empresa/identidade";
import { LayoutDashboard, Package, Receipt, Headset, LogOut, Menu, X, Calculator, Users, TableProperties } from "lucide-react";
import { Avisos, Sininho } from "@/components/notificacoes/Sininho";

const links = [
  { href: "/portal", icon: LayoutDashboard, label: "Visão geral" },
  { href: "/portal/coletas", icon: Package, label: "Minhas coletas" },
  { href: "/portal/cotacao", icon: Calculator, label: "Cotação" },
  { href: "/portal/destinatarios", icon: Users, label: "Destinatários" },
  { href: "/portal/tabela-frete", icon: TableProperties, label: "Tabela de frete" },
  { href: "/portal/faturas", icon: Receipt, label: "Faturas" },
  { href: "/portal/atendimento", icon: Headset, label: "Atendimento" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const identidade = useIdentidade();
  const logo = identidade?.logo ?? null;

  return (
    <Avisos area="portal">
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Header mobile */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="flex items-center gap-2 min-w-0">
          <SimboloDaEmpresa logo={logo} />
          <span data-empresa className="font-outfit font-bold text-lg truncate">{identidade?.name ?? "Portal do cliente"}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Sininho className="p-2 text-gray-600" />
          <button onClick={() => setMenuOpen(!menuOpen)} className="p-2" aria-label="Abrir menu">
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      <aside
        className={`fixed md:sticky top-0 left-0 h-screen w-64 bg-white border-r border-gray-200 flex flex-col z-40 transition-transform ${
          menuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* No celular o cabeçalho fixo já mostra a marca; aqui ela só ocuparia o lugar dos links. */}
        <div className="hidden md:flex p-6 items-center gap-3">
          <SimboloDaEmpresa logo={logo} tamanho="grande" />
          <div className="min-w-0 flex-1">
            <p className="font-outfit font-bold text-lg leading-tight truncate">{identidade?.name ?? "Transportadora"}</p>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Portal do cliente</p>
          </div>
          {/* No computador não há cabeçalho: o sininho fica junto da marca. */}
          <Sininho className="shrink-0 p-2 rounded-full text-gray-500 hover:text-orange-600 hover:bg-orange-50 transition-colors" />
        </div>

        {/* No celular o menu abre abaixo do cabeçalho fixo e os links ficam mais baixos: os sete cabem numa tela. */}
        <nav className="flex-1 px-4 pt-20 pb-2 md:py-4 space-y-0.5 md:space-y-1 overflow-y-auto">
          {links.map((link) => {
            // "Visão geral" é prefixo de tudo: só marca na própria página.
            const isActive =
              pathname === link.href || (link.href !== "/portal" && pathname.startsWith(`${link.href}/`));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 min-h-11 px-4 py-2 md:py-3 rounded-xl transition-all ${
                  isActive
                    ? "bg-orange-50 text-orange-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <link.icon className="w-5 h-5" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-2 md:p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-1 md:mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 font-bold">
              {session?.user?.name?.charAt(0) ?? "C"}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-gray-900 truncate">
                {session?.user?.name ?? "Cliente"}
              </p>
              <p className="text-xs text-gray-500 truncate">{session?.user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => sair()}
            className="w-full flex items-center gap-3 min-h-11 px-4 py-2 md:py-3 rounded-xl text-red-600 hover:bg-red-50 transition-all"
          >
            <LogOut className="w-5 h-5" />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 max-w-full">{children}</main>

      {menuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </div>
    </Avisos>
  );
}

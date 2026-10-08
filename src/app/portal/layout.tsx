"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { sair } from "@/lib/sair";
import { LayoutDashboard, Package, Receipt, LogOut, Menu, X } from "lucide-react";

const links = [
  { href: "/portal", icon: LayoutDashboard, label: "Visão geral" },
  { href: "/portal/coletas", icon: Package, label: "Minhas coletas" },
  { href: "/portal/faturas", icon: Receipt, label: "Faturas" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Header mobile */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <Image src="/favicon-96x96.png" alt="Mello Transportes" width={32} height={32} />
          <span className="font-outfit font-bold text-lg">Portal do cliente</span>
        </div>
        <button onClick={() => setMenuOpen(!menuOpen)} className="p-2" aria-label="Abrir menu">
          {menuOpen ? <X /> : <Menu />}
        </button>
      </div>

      <aside
        className={`fixed md:sticky top-0 left-0 h-screen w-64 bg-white border-r border-gray-200 flex flex-col z-40 transition-transform ${
          menuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-6 flex items-center gap-3">
          <Image src="/favicon-96x96.png" alt="Mello Transportes" width={40} height={40} />
          <div>
            <p className="font-outfit font-bold text-lg leading-tight">Mello</p>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Portal do cliente</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {links.map((link) => {
            // "Visão geral" é prefixo de tudo: só marca na própria página.
            const isActive =
              pathname === link.href || (link.href !== "/portal" && pathname.startsWith(`${link.href}/`));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
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

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-4 px-2">
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
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-600 hover:bg-red-50 transition-all"
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
  );
}

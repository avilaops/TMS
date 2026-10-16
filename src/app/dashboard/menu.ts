import {
  LayoutDashboard,
  Users,
  CarFront,
  Truck,
  Bell,
  Package,
  Route,
  FileText,
  DollarSign,
  UserPlus,
  UserCog,
  Building2,
  ClipboardCheck,
  Calculator,
  Receipt,
  Banknote,
  BarChart3,
  Wrench,
  Headset,
  Warehouse,
  History,
  HardHat,
  Handshake,
} from "lucide-react";
import { pode, type Capacidade } from "@/lib/permissoes";

// Menu do painel, fora do componente para poder ser testado sem navegador
// (tests/perfis.test.ts).
//
// `pode` é a capacidade que a tela precisa para abrir: a mesma que a rota
// principal dela exige em `requireStaff`. É só o menu: quem decide o acesso é a
// API, que devolve 403 para o perfil errado.
export type LinkDoMenu = { href: string; icon: typeof Truck; label: string; pode: Capacidade };
export type SecaoDoMenu = { titulo: string | null; links: LinkDoMenu[] };

export const SECOES: SecaoDoMenu[] = [
  { titulo: null, links: [{ href: "/dashboard", icon: LayoutDashboard, label: "Visão Geral", pode: "painel" }] },
  {
    titulo: "Comercial",
    links: [
      { href: "/dashboard/clientes", icon: Users, label: "Clientes", pode: "clientesVer" },
      { href: "/dashboard/crm", icon: UserPlus, label: "Cotações", pode: "crm" },
      { href: "/dashboard/tabelas-frete", icon: Calculator, label: "Tabelas de frete", pode: "tabelasFreteVer" },
    ],
  },
  {
    titulo: "Operação",
    links: [
      { href: "/dashboard/coletas", icon: Package, label: "Minutas", pode: "coletasVer" },
      { href: "/dashboard/deposito", icon: Warehouse, label: "Depósito", pode: "deposito" },
      { href: "/dashboard/manifestos", icon: Route, label: "Manifestos", pode: "manifestosVer" },
      { href: "/dashboard/comprovantes", icon: ClipboardCheck, label: "Comprovantes", pode: "comprovantes" },
      { href: "/dashboard/ocorrencias", icon: Headset, label: "Ocorrências", pode: "ocorrencias" },
      { href: "/dashboard/fiscal", icon: FileText, label: "Notas fiscais", pode: "fiscalVer" },
    ],
  },
  {
    titulo: "Financeiro",
    links: [
      { href: "/dashboard/faturamento", icon: Receipt, label: "Faturamento", pode: "faturamentoVer" },
      { href: "/dashboard/cobranca", icon: Banknote, label: "Cobrança", pode: "cobranca" },
      { href: "/dashboard/financeiro", icon: DollarSign, label: "Financeiro", pode: "financeiroVer" },
    ],
  },
  {
    titulo: "Frota",
    links: [
      { href: "/dashboard/motoristas", icon: CarFront, label: "Motoristas", pode: "motoristasVer" },
      { href: "/dashboard/veiculos", icon: Truck, label: "Veículos", pode: "frotaVer" },
      { href: "/dashboard/parceiros", icon: Handshake, label: "Parceiros", pode: "parceirosVer" },
      { href: "/dashboard/equipe", icon: HardHat, label: "Equipe", pode: "equipeVer" },
      { href: "/dashboard/frota", icon: Wrench, label: "Alertas", pode: "frotaVer" },
    ],
  },
  {
    titulo: "Sistema",
    links: [
      { href: "/dashboard/relatorios", icon: BarChart3, label: "Relatórios", pode: "relatorios" },
      { href: "/dashboard/mensagens", icon: Bell, label: "Mensageria", pode: "mensageriaVer" },
      { href: "/dashboard/auditoria", icon: History, label: "Auditoria", pode: "auditoria" },
      { href: "/dashboard/usuarios", icon: UserCog, label: "Usuários", pode: "usuarios" },
      { href: "/dashboard/empresa", icon: Building2, label: "Empresa", pode: "empresa" },
    ],
  },
];

/**
 * O menu do perfil: só os links que ele pode abrir. Seção sem nenhum link para
 * o perfil (o Financeiro, para a operação) não aparece. Sem perfil (a sessão
 * ainda carregando) o menu vem vazio.
 */
export function secoesDoMenu(perfil: string | null | undefined): SecaoDoMenu[] {
  return SECOES.map((secao) => ({
    ...secao,
    links: secao.links.filter((link) => pode(perfil, link.pode)),
  })).filter((secao) => secao.links.length > 0);
}

/**
 * O título do cabeçalho: o rótulo do link do menu em que a tela está (a seção
 * vale também nas telas de dentro). Fora do menu, o último trecho da URL com a
 * inicial maiúscula, como era.
 */
export function tituloDaTela(pathname: string): string {
  const link = SECOES.flatMap((secao) => secao.links)
    .filter((l) => pathname === l.href || (l.href !== "/dashboard" && pathname.startsWith(`${l.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (link) return link.label;
  const trecho = pathname.split("/").filter(Boolean).pop() ?? "";
  return trecho ? trecho.charAt(0).toUpperCase() + trecho.slice(1) : "";
}

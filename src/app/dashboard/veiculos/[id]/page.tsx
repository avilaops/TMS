"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Loader2, LogIn, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pode } from "@/lib/permissoes";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { AbaAbastecimento, AbaChecklist, AbaDocumentos, AbaManutencao, AbaPneus, type PropsDaAba } from "./abas";
import { AbaCustos } from "./custos";

/**
 * Frota de um veículo: manutenção, abastecimento, documentos, pneus,
 * checklist e custos, uma aba de cada vez. As regras ficam em src/lib/frota.ts.
 *
 * A aba de custos só aparece para quem tem `frotaCustos`; quem decide o acesso é a
 * API, que responde 403 para os demais.
 */

type Veiculo = { id: string; plate: string; model: string };

type Carga = { denied: DeniedReason } | { denied: null; veiculo: Veiculo | null };

const ABAS = [
  ["manutencao", "Manutenção"],
  ["abastecimento", "Abastecimento"],
  ["documentos", "Documentos"],
  ["pneus", "Pneus"],
  ["checklist", "Checklist"],
  ["custos", "Custos"],
] as const;

type Aba = (typeof ABAS)[number][0];

const DE_REGISTRO: Record<Exclude<Aba, "custos">, (props: PropsDaAba) => React.ReactNode> = {
  manutencao: AbaManutencao,
  abastecimento: AbaAbastecimento,
  documentos: AbaDocumentos,
  pneus: AbaPneus,
  checklist: AbaChecklist,
};

/** A aba pedida no endereço (`#documentos`), que é como a tela de alertas aponta para cá. */
function abaDoEndereco(): Aba {
  const pedida = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return ABAS.find(([chave]) => chave === pedida)?.[0] ?? "manutencao";
}

async function carregar(id: string): Promise<Carga> {
  try {
    const res = await fetch(`/api/veiculos/${id}`);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    return { denied: null, veiculo: res.ok ? ((await res.json()) as Veiculo) : null };
  } catch {
    return { denied: null, veiculo: null };
  }
}

export default function FrotaDoVeiculoPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const admin = pode(session?.user?.role, "frotaCustos");

  const [carga, setCarga] = useState<Exclude<Carga, { denied: DeniedReason }> | null>(null);
  const [denied, setDenied] = useState<DeniedReason | null>(null);
  const [aba, setAba] = useState<Aba>(abaDoEndereco);
  const [formAberto, setFormAberto] = useState(false);

  useEffect(() => {
    let ativo = true;
    carregar(id).then((resultado) => {
      if (!ativo) return;
      if (resultado.denied !== null) return setDenied(resultado.denied);
      setCarga(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [id]);

  if (denied === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para ver a frota.{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">
              Ir para o login
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (denied === "forbidden") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Acesso negado
          </CardTitle>
          <CardDescription>Seu perfil não tem acesso a esta parte da frota.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!carga) {
    return (
      <div className="flex items-center justify-center h-[300px]" role="status" aria-label="Carregando">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!carga.veiculo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Veículo não encontrado</CardTitle>
          <CardDescription>
            <Link href="/dashboard/veiculos" className="font-medium text-blue-600 hover:underline">
              Voltar para os veículos
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { veiculo } = carga;
  const abas = ABAS.filter(([chave]) => chave !== "custos" || admin);
  // Quem não é administrador e chegou pelo endereço da aba de custos cai na primeira.
  const ativa: Aba = abas.some(([chave]) => chave === aba) ? aba : "manutencao";

  const trocarDeAba = (chave: Aba) => {
    setFormAberto(false);
    setAba(chave);
  };

  const Registro = ativa === "custos" ? null : DE_REGISTRO[ativa];

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Com o formulário aberto, o celular fica só com ele: é o que cabe numa tela. */}
      <div className={`${formAberto ? "hidden md:flex" : "flex"} items-center gap-3`}>
        <Link href="/dashboard/veiculos" aria-label="Voltar para os veículos" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div className="min-w-0">
          <h1 data-placa className="text-2xl font-bold font-outfit text-gray-900 dark:text-white truncate">{veiculo.plate}</h1>
          <p className="text-gray-500 text-xs md:text-sm truncate">{veiculo.model}</p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Seção"
        className={`${formAberto ? "hidden md:grid" : "grid"} grid-cols-3 md:grid-cols-6 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl`}
      >
        {abas.map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={ativa === chave}
            data-aba={chave}
            onClick={() => trocarDeAba(chave)}
            className={`min-w-0 py-1.5 rounded-lg text-xs md:text-sm font-semibold truncate ${ativa === chave ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {Registro ? (
        // `key`: trocar de aba começa a seguinte do zero, sem lista nem formulário da anterior.
        <Registro key={ativa} vehicleId={veiculo.id} formAberto={formAberto} setFormAberto={setFormAberto} onNegado={setDenied} />
      ) : (
        <AbaCustos vehicleId={veiculo.id} onNegado={setDenied} />
      )}
    </div>
  );
}

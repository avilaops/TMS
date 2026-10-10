"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Fuel, Loader2, LogIn, ShieldAlert, Wrench } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { prazoPorExtenso, type AlertaDeVencimento } from "@/lib/frota";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";

/**
 * Alertas da frota: documentos de veículo e CNHs vencidos ou a vencer em 30
 * dias, veículos em manutenção e, para o administrador, o custo do mês.
 * A tela só lê; tudo vem pronto de `/api/frota`.
 */

type Resposta = {
  resumo: { vencidos: number; aVencer: number; emManutencao: number };
  alertas: AlertaDeVencimento[];
  emManutencao: { id: string; plate: string; model: string; servico: string | null }[];
  /** Só vem para o administrador. */
  custoDoMes?: { mes: string; manutencao: number; abastecimento: number; total: number };
};

type Carga = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; frota: Resposta };

const FALHA = "Não foi possível carregar os alertas da frota.";

const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";

async function carregar(): Promise<Carga> {
  try {
    const res = await fetch("/api/frota");
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    const corpo = await res.json().catch(() => null);
    if (!res.ok) return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA };
    return { denied: null, erro: null, frota: corpo as Resposta };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

export default function FrotaPage() {
  const [carga, setCarga] = useState<Carga | null>(null);

  useEffect(() => {
    let ativo = true;
    carregar().then((resultado) => {
      if (ativo) setCarga(resultado);
    });
    return () => {
      ativo = false;
    };
  }, []);

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
              Entre de novo para ver a frota.{" "}
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
          <CardDescription>Os alertas da frota são restritos à equipe interna.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Frota</h1>
        <p className="hidden md:block text-gray-500 text-sm mt-1">Vencimentos, veículos em manutenção e custo do mês</p>
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

      {carga && carga.denied === null && carga.erro === null && <Conteudo frota={carga.frota} />}
    </div>
  );
}

const SECOES = ["Vencimentos", "Em manutenção"] as const;

function Conteudo({ frota }: { frota: Resposta }) {
  const { resumo, alertas, emManutencao, custoDoMes } = frota;
  // No celular aparece uma seção por vez, escolhida nas abas; no computador, as duas em sequência.
  const [secao, setSecao] = useState<(typeof SECOES)[number]>("Vencimentos");

  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:gap-4 lg:grid-cols-4">
        <Cartao rotulo="Vencidos" valor={String(resumo.vencidos)} alerta={resumo.vencidos > 0} icone={<AlertTriangle className="w-5 h-5 text-red-600" />} />
        <Cartao rotulo="Vencem em 30 dias" valor={String(resumo.aVencer)} icone={<CalendarClock className="w-5 h-5 text-amber-600" />} />
        <Cartao rotulo="Em manutenção" valor={String(resumo.emManutencao)} icone={<Wrench className="w-5 h-5 text-blue-600" />} />
        {custoDoMes && (
          <Cartao
            rotulo="Custo do mês"
            valor={formatCurrency(custoDoMes.total)}
            detalhe={`Manutenção ${formatCurrency(custoDoMes.manutencao)} · Combustível ${formatCurrency(custoDoMes.abastecimento)}`}
            icone={<Fuel className="w-5 h-5 text-blue-600" />}
          />
        )}
      </div>

      <div role="tablist" aria-label="Seção" className="md:hidden grid grid-cols-2 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
        {SECOES.map((nome) => (
          <button
            key={nome}
            type="button"
            role="tab"
            aria-selected={secao === nome}
            data-aba={nome}
            onClick={() => setSecao(nome)}
            className={`py-1.5 rounded-lg text-sm font-semibold ${secao === nome ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
          >
            {nome}
          </button>
        ))}
      </div>

      <Secao ativa={secao} titulo="Vencimentos" descricao="Documentos de veículo e CNHs vencidos ou a vencer em até 30 dias.">
        {alertas.length === 0 ? (
          <p className="px-3 pb-3 md:px-5 md:pb-6 text-sm text-gray-500">Nenhum documento ou CNH vencido ou a vencer.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800">
            {alertas.map((alerta) => (
              <li key={alerta.chave} data-alerta={alerta.chave} className="flex items-center justify-between gap-3 px-3 py-2.5 md:px-5 md:py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {alerta.rotulo} · {alerta.de}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatCalendarDate(`${alerta.vencimento}T00:00:00.000Z`)}
                    {alerta.numero ? ` · nº ${alerta.numero}` : ""}
                    {" · "}
                    <Link
                      href={alerta.vehicleId ? `/dashboard/veiculos/${alerta.vehicleId}#documentos` : "/dashboard/motoristas"}
                      className="text-blue-600 hover:underline"
                    >
                      {alerta.vehicleId ? "ver veículo" : "ver motoristas"}
                    </Link>
                  </p>
                </div>
                <span
                  data-situacao={alerta.situacao}
                  className={`shrink-0 text-xs px-2.5 py-1 rounded-full ${alerta.situacao === "vencido" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-800"}`}
                >
                  {prazoPorExtenso(alerta.dias)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao ativa={secao} titulo="Em manutenção" descricao="Veículos com a situação “Em manutenção” no cadastro.">
        {emManutencao.length === 0 ? (
          <p className="px-3 pb-3 md:px-5 md:pb-6 text-sm text-gray-500">Nenhum veículo em manutenção.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800">
            {emManutencao.map((veiculo) => (
              <li key={veiculo.id} data-veiculo={veiculo.id} className="flex items-center justify-between gap-3 px-3 py-2.5 md:px-5 md:py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {veiculo.plate} · {veiculo.model}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{veiculo.servico ?? "Sem serviço em aberto registrado"}</p>
                </div>
                <Link href={`/dashboard/veiculos/${veiculo.id}`} className="shrink-0 text-sm text-blue-600 hover:underline">
                  Abrir
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </>
  );
}

function Cartao({ rotulo, valor, icone, detalhe, alerta = false }: { rotulo: string; valor: string; icone: React.ReactNode; detalhe?: string; alerta?: boolean }) {
  return (
    <div className={`${CARD} p-3 md:p-5`} data-cartao={rotulo}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs md:text-sm leading-tight text-gray-500">{rotulo}</p>
        {icone}
      </div>
      <p className={`mt-1 md:mt-2 text-lg md:text-xl font-bold ${alerta ? "text-red-600" : "text-gray-900 dark:text-white"}`}>{valor}</p>
      {detalhe && <p className="hidden md:block mt-1 text-xs text-gray-500">{detalhe}</p>}
    </div>
  );
}

function Secao({ ativa, titulo, descricao, children }: { ativa: string; titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <section className={`${ativa === titulo ? "" : "hidden md:block "}${CARD} overflow-hidden`} aria-label={titulo}>
      <div className="px-3 py-3 md:px-5 md:py-5">
        <h2 className="hidden md:block text-lg font-semibold text-gray-900 dark:text-white">{titulo}</h2>
        <p className="md:mt-1 text-xs md:text-sm text-gray-500">{descricao}</p>
      </div>
      {children}
    </section>
  );
}

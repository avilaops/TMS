"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, Route, Truck, Package, ChevronRight, Clock, MapPin, Camera, Wallet } from "lucide-react";
import type { ComprovanteParaRefazer } from "@/lib/comprovantes";
import { formatCurrency } from "@/lib/format";
import type { RemuneracaoDoMotorista } from "@/lib/remuneracao";
import { buscarComprovantesDoMotorista } from "@/lib/comprovantes-motorista";

export default function DriverHome() {
  const [manifestos, setManifestos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Comprovantes que a conferência devolveu a este motorista. A mesma consulta
  // traz o perfil da empresa, que fica lembrado no aparelho para a baixa sem sinal.
  const [refazer, setRefazer] = useState<ComprovanteParaRefazer[]>([]);
  // O total do mês em aberto e quantas viagens finalizadas ele soma; nulo enquanto a empresa não liga.
  const [ganhos, setGanhos] = useState<{ total: number; viagens: number } | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    let ativo = true;
    void buscarComprovantesDoMotorista().then((resposta) => {
      if (ativo && resposta) setRefazer(resposta.refazer);
    });
    return () => {
      ativo = false;
    };
  }, []);

  // Os ganhos do mês só aparecem se a empresa ligou isso: desligado, a rota responde
  // `visivel: false` e o cartão não existe. Se a leitura falhar, a tela segue sem ele.
  useEffect(() => {
    let ativo = true;
    fetch("/api/driver/remuneracao")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: RemuneracaoDoMotorista | null) => {
        if (ativo && corpo?.visivel) setGanhos({ total: corpo.total, viagens: corpo.viagens.length });
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // /api/driver/manifestos devolve apenas as viagens deste motorista.
      const res = await fetch('/api/driver/manifestos');
      if (res.ok) {
        setManifestos(await res.json());
      }
    } catch (error) {
      console.error("Failed to fetch manifestos", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      
      <div className="bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 mt-4">
        <h2 className="text-xl font-bold font-outfit text-gray-900 mb-1">Olá, Motorista! 👋</h2>
        <p className="text-gray-500 text-sm">Bem-vindo à sua jornada de entregas de hoje.</p>
      </div>

      {/* Só quando a empresa ligou em Empresa: o que as viagens finalizadas do mês renderam. */}
      {ganhos && (
        <Link href="/driver/remuneracao" data-meus-ganhos className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100 active:scale-95 transition-transform">
          <Wallet className="w-5 h-5 text-blue-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500">Meus ganhos no mês</p>
            <p className="font-bold text-gray-900">{formatCurrency(ganhos.total)}</p>
          </div>
          <span className="text-xs text-gray-500 shrink-0">
            {ganhos.viagens} {ganhos.viagens === 1 ? "viagem" : "viagens"}
          </span>
          <ChevronRight className="w-5 h-5 text-blue-600 shrink-0" />
        </Link>
      )}

      {refazer.length > 0 && (
        <div data-comprovantes-para-refazer className="space-y-2">
          <h3 className="font-bold text-gray-900 px-1 flex items-center">
            <Camera className="w-5 h-5 mr-2 text-red-600" />
            Comprovantes para refazer ({refazer.length})
          </h3>
          {refazer.map((comprovante) => (
            <Link
              key={comprovante.collectionId}
              href={`/driver/entregas/${comprovante.collectionId}/refazer`}
              className="flex items-center gap-3 bg-white rounded-2xl p-4 shadow-sm border border-red-200 active:scale-95 transition-transform"
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold text-gray-900 truncate">{comprovante.receiver}</p>
                <p className="text-xs text-gray-500 truncate">{comprovante.destination}</p>
                <p className="text-sm text-red-700 break-words mt-1">{comprovante.reason}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-red-600 shrink-0" />
            </Link>
          ))}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="font-bold text-gray-900 px-1 flex items-center">
          <Route className="w-5 h-5 mr-2 text-blue-600" />
          Minhas Viagens
        </h3>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : manifestos.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
            <Truck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Nenhuma viagem atribuída a você no momento.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {manifestos.map(manifesto => (
              <Link 
                href={`/driver/viagem/${manifesto.id}`} 
                key={manifesto.id}
                className="block bg-white rounded-2xl p-5 shadow-sm active:scale-95 transition-transform border border-gray-100"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-md">
                    Viagem #{manifesto.id.substring(0,6).toUpperCase()}
                  </div>
                  <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-1 rounded-full flex items-center">
                    <Clock className="w-3 h-3 mr-1" /> Em andamento
                  </span>
                </div>

                <div className="space-y-3 mb-4">
                  <div className="flex items-center text-sm text-gray-600">
                    <Truck className="w-4 h-4 mr-2 text-gray-400" />
                    <span className="font-medium">{manifesto.vehicle?.plate}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600">
                    <Package className="w-4 h-4 mr-2 text-gray-400" />
                    <span>{manifesto.collections?.length || 0} Minutas (Entregas)</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 flex items-center justify-between text-blue-600">
                  <span className="text-sm font-medium">Acessar Viagem</span>
                  <ChevronRight className="w-5 h-5" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

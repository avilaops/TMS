"use client";

import { useState, useEffect } from "react";
import { Search, Loader2, FileText, CheckCircle2, AlertCircle, FileCheck, Truck } from "lucide-react";

interface Minuta {
  id: string;
  weight: number;
  invoiceValue: number | null;
  client: { companyName: string, tradeName: string };
  origin: string;
  destination: string;
  status: string; // PENDING, CONFIRMED, COLLECTED, ROUTE
  fiscalStatus?: string; // PENDING_FISCAL, EMITTED
}

export default function FiscalPage() {
  const [minutas, setMinutas] = useState<Minuta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [emittingId, setEmittingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/coletas');
      if (res.ok) {
        const data = await res.json();
        // Adiciona um mock fiscalStatus se não existir
        const mapped = data.map((m: any) => ({
          ...m,
          fiscalStatus: m.fiscalStatus || 'PENDING_FISCAL'
        }));
        setMinutas(mapped);
      }
    } catch (error) {
      console.error("Erro ao buscar dados", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmitir = async (id: string) => {
    setEmittingId(id);
    // Simula uma chamada de API para emissão fiscal
    setTimeout(() => {
      setMinutas(prev => prev.map(m => m.id === id ? { ...m, fiscalStatus: 'EMITTED' } : m));
      setEmittingId(null);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white flex items-center">
            <FileText className="w-6 h-6 mr-2 text-blue-600" />
            Emissão Fiscal (CT-e)
          </h1>
          <p className="text-gray-500 text-sm mt-1">Simulação de emissão de Conhecimento de Transporte Eletrônico</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : minutas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <FileCheck className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma minuta disponível para faturamento</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Cliente / Rota</th>
                  <th className="px-6 py-4">Valor da Carga</th>
                  <th className="px-6 py-4">Peso</th>
                  <th className="px-6 py-4">Status Fiscal</th>
                  <th className="px-6 py-4">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {minutas.map(minuta => (
                  <tr key={minuta.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {minuta.client?.tradeName || minuta.client?.companyName}
                        </p>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {minuta.origin.split('-')[0]} → {minuta.destination.split('-')[0]}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {minuta.invoiceValue ? `R$ ${minuta.invoiceValue.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {minuta.weight} kg
                    </td>
                    <td className="px-6 py-4">
                      {minuta.fiscalStatus === 'EMITTED' ? (
                        <span className="flex items-center text-green-600 dark:text-green-400 text-sm font-medium">
                          <CheckCircle2 className="w-4 h-4 mr-1.5" /> Emitido (CT-e)
                        </span>
                      ) : (
                        <span className="flex items-center text-yellow-600 dark:text-yellow-400 text-sm font-medium">
                          <AlertCircle className="w-4 h-4 mr-1.5" /> Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {minuta.fiscalStatus !== 'EMITTED' ? (
                        <button 
                          onClick={() => handleEmitir(minuta.id)}
                          disabled={emittingId === minuta.id}
                          className="bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-white text-white dark:text-gray-900 px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center disabled:opacity-50"
                        >
                          {emittingId === minuta.id ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Emitindo...</>
                          ) : (
                            'Emitir CT-e'
                          )}
                        </button>
                      ) : (
                        <button className="text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium flex items-center">
                          <FileText className="w-4 h-4 mr-1" /> Imprimir DACTE
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

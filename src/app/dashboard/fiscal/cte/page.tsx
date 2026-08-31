"use client";

import { useState, useEffect } from "react";
import { Loader2, FileText, CheckCircle, AlertCircle, Play } from "lucide-react";

export default function CtePage() {
  const [minutas, setMinutas] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [issuingId, setIssuingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/coletas');
      if (res.ok) {
        setMinutas(await res.json());
      }
    } catch (error) {
      console.error("Failed to fetch minutas", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmitCte = async (id: string) => {
    setIssuingId(id);
    try {
      const res = await fetch('/api/fiscal/cte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId: id })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        // Sucesso - recarrega dados para ver a chave
        await fetchData();
      } else {
        alert(data.error || 'Erro ao emitir CT-e');
      }
    } catch (error) {
      alert('Erro de conexão ao emitir CT-e');
    } finally {
      setIssuingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Emissão de CT-e</h1>
        <p className="text-gray-500 text-sm mt-1">Gerencie e emita Conhecimento de Transporte para as suas Minutas.</p>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : minutas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma minuta disponível</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Cliente / Rota</th>
                  <th className="px-6 py-4">Valor (NF)</th>
                  <th className="px-6 py-4">Status CT-e</th>
                  <th className="px-6 py-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {minutas.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white uppercase">{m.client?.companyName || 'S/N'}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{m.origin} ➔ {m.destination}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                      R$ {m.invoiceValue ? m.invoiceValue.toFixed(2) : '0.00'}
                    </td>
                    <td className="px-6 py-4">
                      {m.cteStatus === 'ISSUED' ? (
                        <div>
                          <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-medium inline-flex items-center">
                            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Emitido
                          </span>
                          <p className="text-[10px] text-gray-400 mt-1 uppercase font-mono tracking-wider">
                            {m.cteKey}
                          </p>
                        </div>
                      ) : (
                        <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-medium inline-flex items-center">
                          <AlertCircle className="w-3.5 h-3.5 mr-1" /> Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {m.cteStatus !== 'ISSUED' ? (
                        <button 
                          onClick={() => handleEmitCte(m.id)}
                          disabled={issuingId === m.id}
                          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/30 transition-all inline-flex items-center justify-center min-w-[120px]"
                        >
                          {issuingId === m.id ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando...
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-2" /> Emitir CT-e
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="text-sm text-gray-400 font-medium">CT-e #{m.cteNumber}</span>
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

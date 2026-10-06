"use client";

import { useState } from "react";
import { Search, MapPin, Truck, CheckCircle2, Box, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

type TrackingResult = { id: string; status: string; createdAt: string; origin: string; destination: string; manifest?: { driver?: { user?: { name?: string } } } };

export default function RastreioPage() {
  const [doc, setDoc] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [resultados, setResultados] = useState<TrackingResult[] | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc) return;
    
    setIsSearching(true);
    try {
      const res = await fetch(`/api/rastreio?doc=${encodeURIComponent(doc)}`);
      if (res.ok) {
        setResultados(await res.json());
      } else {
        setResultados([]);
      }
    } catch (error) {
      console.error("Erro na busca", error);
      setResultados([]);
    } finally {
      setIsSearching(false);
    }
  };

  const formatDoc = (value: string) => {
    // Apenas aplica uma máscara simples se quiser
    return value.replace(/\D/g, "");
  };

  return (
    <div className="min-h-[65vh] bg-gray-50 flex flex-col items-center pt-16 px-4">
      <div className="w-full max-w-2xl text-center mb-10">
        <div className="w-16 h-16 bg-[#f28a00] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-orange-600/20">
          <Truck className="w-8 h-8 text-gray-950" />
        </div>
        <h1 className="text-3xl font-bold font-outfit text-gray-900 mb-3">Rastreamento de Cargas</h1>
        <p className="text-gray-500">Acompanhe sua entrega pelas atualizações registradas informando o seu CNPJ ou CPF.</p>
      </div>

      <div className="w-full max-w-2xl bg-white p-6 rounded-3xl shadow-xl shadow-gray-200/50 mb-8 border border-gray-100">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label htmlFor="tracking-document" className="sr-only">CNPJ ou CPF</label>
            <input
              id="tracking-document"
              inputMode="numeric"
              maxLength={14}
              type="text"
              value={doc}
              onChange={(e) => setDoc(formatDoc(e.target.value))}
              placeholder="CPF ou CNPJ (somente números)"
              className="w-full px-5 py-4 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none text-gray-900"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching || !doc}
            className="bg-[#f28a00] hover:bg-orange-700 disabled:bg-orange-400 text-gray-950 px-8 py-4 rounded-xl font-medium shadow-lg shadow-orange-500/30 transition-all flex items-center justify-center"
          >
            {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Search className="w-5 h-5 mr-2" /> Buscar</>}
          </button>
        </form>
      </div>

      {resultados !== null && (
        <div className="w-full max-w-2xl space-y-6">
          {resultados.length === 0 ? (
            <div className="text-center p-8 bg-white rounded-3xl border border-gray-100 shadow-sm">
              <Box className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">Nenhuma carga encontrada para este documento.</p>
            </div>
          ) : (
            resultados.map((minuta) => (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                key={minuta.id} 
                className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm relative overflow-hidden"
              >
                {/* Linha Lateral Status */}
                <div className={`absolute left-0 top-0 w-1.5 h-full ${
                  minuta.status === 'DELIVERED' ? 'bg-green-500' :
                  minuta.status === 'ROUTE' ? 'bg-orange-500' : 'bg-yellow-500'
                }`} />

                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg mb-1">Carga #{minuta.id.substring(0,8).toUpperCase()}</h3>
                    <p className="text-sm text-gray-500">
                      Emitido em: {new Date(minuta.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${
                    minuta.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                    minuta.status === 'ROUTE' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {minuta.status === 'DELIVERED' ? 'ENTREGUE' :
                     minuta.status === 'ROUTE' ? 'EM ROTA' : 'AGUARDANDO EMBARQUE'}
                  </span>
                </div>

                <div className="flex items-center space-x-3 mb-8 p-4 bg-gray-50 rounded-2xl">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 mb-1">Origem</p>
                    <p className="font-medium text-gray-900 text-sm flex items-center">
                      <MapPin className="w-4 h-4 mr-1 text-gray-400" />
                      {minuta.origin}
                    </p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-300" />
                  <div className="flex-1 text-right">
                    <p className="text-xs text-gray-500 mb-1">Destino</p>
                    <p className="font-medium text-gray-900 text-sm flex items-center justify-end">
                      <MapPin className="w-4 h-4 mr-1 text-orange-500" />
                      {minuta.destination}
                    </p>
                  </div>
                </div>

                <div className="relative pl-6 space-y-6">
                  {/* Linha conectora */}
                  <div className="absolute left-7 top-2 w-0.5 h-[calc(100%-24px)] bg-gray-100 -z-10" />

                  {/* Step 1: Mercadoria Recebida */}
                  <div className="flex items-start space-x-4">
                    <div className="w-6 h-6 rounded-full bg-orange-100 border-2 border-white flex items-center justify-center flex-shrink-0 z-10 mt-0.5 shadow-sm text-orange-600">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">Mercadoria Recebida</p>
                      <p className="text-xs text-gray-500 mt-1">Carga deu entrada na transportadora.</p>
                    </div>
                  </div>

                  {/* Step 2: Em Viagem */}
                  <div className="flex items-start space-x-4">
                    <div className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center flex-shrink-0 z-10 mt-0.5 shadow-sm ${
                      ['ROUTE', 'DELIVERED'].includes(minuta.status) ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-300'
                    }`}>
                      <Truck className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <p className={`font-semibold text-sm ${['ROUTE', 'DELIVERED'].includes(minuta.status) ? 'text-gray-900' : 'text-gray-400'}`}>
                        Em Viagem
                      </p>
                      {['ROUTE', 'DELIVERED'].includes(minuta.status) && (
                        <p className="text-xs text-gray-500 mt-1">
                          Sua carga saiu para entrega com {minuta.manifest?.driver?.user?.name || 'Motorista'}.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Step 3: Entregue */}
                  <div className="flex items-start space-x-4">
                    <div className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center flex-shrink-0 z-10 mt-0.5 shadow-sm ${
                      minuta.status === 'DELIVERED' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-300'
                    }`}>
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className={`font-semibold text-sm ${minuta.status === 'DELIVERED' ? 'text-green-600' : 'text-gray-400'}`}>
                        Carga Entregue
                      </p>
                      {minuta.status === 'DELIVERED' && (
                        <p className="text-xs text-green-700/70 mt-1">
                          A entrega foi finalizada no destino.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Search, MapPin, Truck, CheckCircle2, Box, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { takeTrackingCodeDigits } from "@/lib/tracking";

/** O que a rota publica devolve. Nada alem disto sai do servidor. */
type MinutaPublica = {
  id: string;
  trackingCode: string | null;
  status: string;
  origin: string;
  destination: string;
  createdAt: string;
  manifest: { driver: { user: { name: string } } | null } | null;
};

export default function RastreioPage() {
  const [doc, setDoc] = useState("");
  const [codigo, setCodigo] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [resultados, setResultados] = useState<MinutaPublica[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc || !codigo) return;

    setIsSearching(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ cnpj: doc, codigo });
      const res = await fetch(`/api/rastreio?${params}`);
      if (res.ok) {
        setResultados(await res.json());
      } else if (res.status === 429) {
        // Unica mensagem diferente da generica, e ela nao fala de dado nenhum:
        // e sobre o volume de tentativas, nao sobre o que existe no banco.
        setResultados(null);
        setErro("Muitas consultas seguidas. Aguarde alguns minutos e tente de novo.");
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

  const somenteDigitos = (value: string) => value.replace(/\D/g, "");


  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center pt-16 px-4">
      <div className="w-full max-w-2xl text-center mb-10">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-600/20">
          <Truck className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold font-outfit text-gray-900 mb-3">Rastreamento de Cargas</h1>
        <p className="text-gray-500">Informe o CNPJ ou CPF do contratante e o código de rastreio da carga.</p>
      </div>

      <div className="w-full max-w-2xl bg-white p-6 rounded-3xl shadow-xl shadow-gray-200/50 mb-8 border border-gray-100">
        <form onSubmit={handleSearch} className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label htmlFor="rastreio-doc" className="block text-sm font-medium text-gray-700 mb-1.5">
                CNPJ ou CPF do contratante
              </label>
              {/* inputMode numérico abre o teclado de números no celular; sem
                  máscara, para o cliente poder colar o documento como vier. */}
              <input
                id="rastreio-doc"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={doc}
                onChange={(e) => setDoc(somenteDigitos(e.target.value))}
                placeholder="Somente números"
                className="w-full px-5 py-4 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="rastreio-codigo" className="block text-sm font-medium text-gray-700 mb-1.5">
                Código de rastreio
              </label>
              <input
                id="rastreio-codigo"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={codigo}
                onChange={(e) => setCodigo(takeTrackingCodeDigits(e.target.value))}
                placeholder="10 números"
                aria-describedby="rastreio-ajuda"
                className="w-full px-5 py-4 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 font-mono tracking-wider"
              />
            </div>
          </div>
          <p id="rastreio-ajuda" className="text-xs text-gray-500">
            O código de 10 números está na minuta da coleta. Se não tiver em mãos, peça à
            equipe da Mello pelo WhatsApp ou pelo telefone do rodapé.
          </p>
          <button
            type="submit"
            disabled={isSearching || !doc || !codigo}
            className="w-full sm:w-auto sm:self-end bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-8 py-4 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center"
          >
            {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Search className="w-5 h-5 mr-2" /> Buscar</>}
          </button>
        </form>
      </div>

      {erro && (
        <div className="w-full max-w-2xl mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm text-center">
          {erro}
        </div>
      )}

      {resultados !== null && (
        <div className="w-full max-w-2xl space-y-6">
          {resultados.length === 0 ? (
            <div className="text-center p-8 bg-white rounded-3xl border border-gray-100 shadow-sm">
              <Box className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">
                Não foi possível localizar uma carga com os dados informados.
              </p>
              <p className="text-gray-400 text-sm mt-2">
                Confira o documento e o código de rastreio e tente novamente.
              </p>
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
                  minuta.status === 'ROUTE' ? 'bg-blue-500' : 'bg-yellow-500'
                }`} />

                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg mb-1 font-mono">Carga {minuta.trackingCode}</h3>
                    <p className="text-sm text-gray-500">
                      Emitido em: {new Date(minuta.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <span className={`px-3 py-1 text-xs font-bold rounded-full ${
                    minuta.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                    minuta.status === 'ROUTE' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
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
                      <MapPin className="w-4 h-4 mr-1 text-blue-500" />
                      {minuta.destination}
                    </p>
                  </div>
                </div>

                <div className="relative pl-6 space-y-6">
                  {/* Linha conectora */}
                  <div className="absolute left-7 top-2 w-0.5 h-[calc(100%-24px)] bg-gray-100 -z-10" />

                  {/* Step 1: Mercadoria Recebida */}
                  <div className="flex items-start space-x-4">
                    <div className="w-6 h-6 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center flex-shrink-0 z-10 mt-0.5 shadow-sm text-blue-600">
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
                      ['ROUTE', 'DELIVERED'].includes(minuta.status) ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-300'
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

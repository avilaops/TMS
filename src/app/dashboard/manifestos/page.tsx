"use client";

import { useState, useEffect } from "react";
import { Plus, Search, Loader2, Route, Truck, Package, MapPin, User, ArrowRight } from "lucide-react";

interface Cliente {
  tradeName: string;
  companyName: string;
}

interface Minuta {
  id: string;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  client: Cliente;
  status: string;
  manifestId?: string | null;
}

interface Motorista {
  id: string;
  user: { name: string };
  cpf: string;
}

interface Veiculo {
  id: string;
  plate: string;
  model: string;
  type: string;
}

interface Manifesto {
  id: string;
  status: string;
  createdAt: string;
  driver: Motorista;
  vehicle: Veiculo;
  collections: Minuta[];
}

export default function ManifestosPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [manifestos, setManifestos] = useState<Manifesto[]>([]);
  const [minutas, setMinutas] = useState<Minuta[]>([]);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [formData, setFormData] = useState({
    driverId: "",
    vehicleId: "",
    collectionIds: [] as string[],
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [manRes, minRes, motRes, veicRes] = await Promise.all([
        fetch('/api/manifestos'),
        fetch('/api/coletas'),
        fetch('/api/motoristas'),
        fetch('/api/veiculos')
      ]);
      
      if (manRes.ok) setManifestos(await manRes.json());
      if (motRes.ok) setMotoristas(await motRes.json());
      if (veicRes.ok) setVeiculos(await veicRes.json());
      if (minRes.ok) {
        const allMinutas = await minRes.json();
        // Filtra minutas que ainda NÃO estão em um manifesto
        setMinutas(allMinutas.filter((m: Minuta) => !m.manifestId));
      }
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMinuta = (id: string) => {
    setFormData(prev => ({
      ...prev,
      collectionIds: prev.collectionIds.includes(id) 
        ? prev.collectionIds.filter(i => i !== id)
        : [...prev.collectionIds, id]
    }));
  };

  const handleSave = async () => {
    if (!formData.driverId || !formData.vehicleId || formData.collectionIds.length === 0) {
      alert("Por favor, selecione um motorista, um veículo e pelo menos uma minuta para a viagem.");
      return;
    }
    
    setIsSaving(true);
    try {
      const res = await fetch('/api/manifestos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      if (res.ok) {
        setIsModalOpen(false);
        setFormData({ driverId: "", vehicleId: "", collectionIds: [] });
        fetchData();
      } else {
        const errData = await res.json();
        alert(errData.error || "Erro ao criar manifesto.");
      }
    } catch (error) {
      alert("Erro ao criar manifesto.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Manifestos Operacionais</h1>
          <p className="text-gray-500 text-sm mt-1">Gerencie viagens e roteiros de entrega</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Montar Viagem</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : manifestos.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl flex flex-col items-center justify-center h-[400px] text-center shadow-sm">
            <Route className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhum manifesto de viagem criado</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {manifestos.map(manifesto => (
              <div key={manifesto.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-2">
                    <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold px-2 py-1 rounded-md">
                      MDF-e #{manifesto.id.substring(0,6).toUpperCase()}
                    </span>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                    Em Rota
                  </span>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center space-x-3 text-sm text-gray-600 dark:text-gray-300">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="font-medium text-gray-900 dark:text-white">{manifesto.driver?.user?.name}</span>
                  </div>
                  
                  <div className="flex items-center space-x-3 text-sm text-gray-600 dark:text-gray-300">
                    <Truck className="w-4 h-4 text-gray-400" />
                    <span>
                      {manifesto.vehicle?.plate} <span className="text-xs text-gray-500">({manifesto.vehicle?.model})</span>
                    </span>
                  </div>
                </div>

                <div className="mt-6 border-t border-gray-100 dark:border-gray-800 pt-4">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 flex items-center">
                    <Package className="w-4 h-4 mr-1.5" /> 
                    {manifesto.collections?.length || 0} Entregas na Rota
                  </h4>
                  
                  <div className="space-y-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                    {manifesto.collections?.map(col => (
                      <div key={col.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-sm">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{col.client?.tradeName || col.client?.companyName}</p>
                        <div className="flex items-center text-xs text-gray-500 mt-1 space-x-1">
                          <span>{col.origin.split('-')[0]}</span>
                          <ArrowRight className="w-3 h-3" />
                          <span>{col.destination.split('-')[0]}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-white dark:bg-gray-900 z-10">
              <h2 className="text-xl font-bold font-outfit text-gray-900 dark:text-white">Montar Manifesto de Viagem</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>
            
            <div className="p-6 flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Esquerda: Seleção de Veículo e Motorista */}
              <div className="space-y-6 lg:border-r lg:border-gray-100 dark:lg:border-gray-800 lg:pr-6">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white mb-3">1. Equipe e Transporte</h3>
                  
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Motorista</label>
                      <select 
                        value={formData.driverId}
                        onChange={(e) => setFormData({...formData, driverId: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      >
                        <option value="">Selecione um motorista...</option>
                        {motoristas.map(m => (
                          <option key={m.id} value={m.id}>{m.user?.name} - CPF: {m.cpf}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Veículo</label>
                      <select 
                        value={formData.vehicleId}
                        onChange={(e) => setFormData({...formData, vehicleId: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white uppercase"
                      >
                        <option value="">Selecione um veículo...</option>
                        {veiculos.map(v => (
                          <option key={v.id} value={v.id}>{v.plate} ({v.type})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800/30">
                  <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-400 mb-2">Resumo da Rota</h4>
                  <div className="space-y-2 text-sm text-blue-700 dark:text-blue-300">
                    <p>Entregas: <span className="font-bold">{formData.collectionIds.length}</span></p>
                    <p>Peso Total: <span className="font-bold">
                      {minutas.filter(m => formData.collectionIds.includes(m.id)).reduce((acc, curr) => acc + curr.weight, 0)} kg
                    </span></p>
                  </div>
                </div>
              </div>

              {/* Direita: Seleção de Minutas */}
              <div className="lg:col-span-2 flex flex-col h-full">
                <h3 className="font-medium text-gray-900 dark:text-white mb-3">2. Selecione as Minutas (Cargas Livres)</h3>
                
                {minutas.length === 0 ? (
                  <div className="flex-1 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl flex flex-col items-center justify-center text-center p-6">
                    <Package className="w-10 h-10 text-gray-300 mb-2" />
                    <p className="text-gray-500 font-medium">Não há minutas pendentes para embarque.</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {minutas.map(minuta => {
                      const isSelected = formData.collectionIds.includes(minuta.id);
                      return (
                        <div 
                          key={minuta.id}
                          onClick={() => toggleMinuta(minuta.id)}
                          className={`cursor-pointer border p-4 rounded-xl transition-all ${
                            isSelected 
                              ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 dark:border-blue-500' 
                              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-3">
                              <div className={`w-5 h-5 rounded border flex items-center justify-center mt-0.5 ${
                                isSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                              }`}>
                                {isSelected && <span className="text-white text-xs">✓</span>}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 dark:text-white text-sm">
                                  {minuta.client?.tradeName || minuta.client?.companyName}
                                </p>
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className="text-xs text-gray-500 flex items-center"><MapPin className="w-3 h-3 mr-1" /> {minuta.origin.split('-')[0]}</span>
                                  <ArrowRight className="w-3 h-3 text-gray-400" />
                                  <span className="text-xs text-gray-500">{minuta.destination.split('-')[0]}</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{minuta.weight} kg</p>
                              <p className="text-xs text-gray-500">{minuta.volumes} vol</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex justify-end space-x-3">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={isSaving || formData.collectionIds.length === 0}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all flex items-center space-x-2"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Emitir Manifesto ({formData.collectionIds.length})</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

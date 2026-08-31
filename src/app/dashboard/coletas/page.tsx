"use client";

import { useState, useEffect } from "react";
import { Plus, Search, Loader2, Package, MapPin, Truck } from "lucide-react";

interface Cliente {
  id: string;
  tradeName: string;
  companyName: string;
}

interface Motorista {
  id: string;
  user: { name: string };
}

interface Coleta {
  id: string;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  status: string;
  invoiceValue: number | null;
  client: Cliente;
  driver?: Motorista | null;
}

export default function ColetasPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [coletas, setColetas] = useState<Coleta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [formData, setFormData] = useState({
    clientId: "",
    sender: "",
    receiver: "",
    origin: "",
    destination: "",
    volumes: "",
    weight: "",
    invoiceKey: "",
    invoiceValue: "",
    driverId: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [coletasRes, clientesRes, motoristasRes] = await Promise.all([
        fetch('/api/coletas'),
        fetch('/api/clientes'),
        fetch('/api/motoristas')
      ]);
      
      if (coletasRes.ok) setColetas(await coletasRes.json());
      if (clientesRes.ok) setClientes(await clientesRes.json());
      if (motoristasRes.ok) setMotoristas(await motoristasRes.json());
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.clientId || !formData.sender || !formData.receiver || !formData.origin || !formData.destination) {
      alert("Por favor, preencha todos os campos obrigatórios.");
      return;
    }
    
    setIsSaving(true);
    try {
      const res = await fetch('/api/coletas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      if (res.ok) {
        setIsModalOpen(false);
        setFormData({ 
          clientId: "", sender: "", receiver: "", origin: "", destination: "", 
          volumes: "", weight: "", invoiceKey: "", invoiceValue: "", driverId: "" 
        });
        fetchData();
      } else {
        const errData = await res.json();
        alert(errData.error || "Erro ao criar minuta.");
      }
    } catch (error) {
      alert("Erro ao criar minuta.");
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'CONFIRMED': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'COLLECTED': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
    }
  };

  const getStatusText = (status: string) => {
    switch(status) {
      case 'PENDING': return 'Pendente';
      case 'CONFIRMED': return 'Confirmada';
      case 'COLLECTED': return 'Coletada';
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Minutas (Coletas)</h1>
          <p className="text-gray-500 text-sm mt-1">Gestão de emissões não-fiscais e ordens de coleta</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Minuta</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : coletas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <Package className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma minuta registrada</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Cliente / Rota</th>
                  <th className="px-6 py-4">Volumes / Peso</th>
                  <th className="px-6 py-4">Valor NF</th>
                  <th className="px-6 py-4">Motorista</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {coletas.map(coleta => (
                  <tr key={coleta.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-start space-x-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 mt-1">
                          <Package className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {coleta.client?.tradeName || coleta.client?.companyName}
                          </p>
                          <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-1 space-x-1">
                            <MapPin className="w-3 h-3" />
                            <span>{coleta.origin.split('-')[0]}</span>
                            <span>→</span>
                            <span>{coleta.destination.split('-')[0]}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      <div>{coleta.volumes} vols</div>
                      <div className="text-xs text-gray-500">{coleta.weight} kg</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {coleta.invoiceValue ? `R$ ${coleta.invoiceValue.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {coleta.driver ? (
                        <div className="flex items-center space-x-1">
                          <Truck className="w-4 h-4 text-gray-400" />
                          <span>{coleta.driver.user?.name}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs italic">Não alocado</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${getStatusColor(coleta.status)}`}>
                        {getStatusText(coleta.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="sticky top-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center z-10">
              <h2 className="text-xl font-bold font-outfit text-gray-900 dark:text-white">Emitir Nova Minuta</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Cliente */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Cliente (Pagador) *</label>
                <select 
                  value={formData.clientId}
                  onChange={(e) => setFormData({...formData, clientId: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                >
                  <option value="">Selecione um cliente...</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.tradeName || c.companyName}</option>
                  ))}
                </select>
              </div>

              {/* Remetente & Destinatário */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4 p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
                  <h3 className="font-medium text-sm text-gray-900 dark:text-white flex items-center">
                    <MapPin className="w-4 h-4 mr-2 text-blue-500" /> Origem
                  </h3>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Remetente *</label>
                      <input
                        type="text"
                        value={formData.sender}
                        onChange={(e) => setFormData({...formData, sender: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Cidade - UF *</label>
                      <input
                        type="text"
                        value={formData.origin}
                        onChange={(e) => setFormData({...formData, origin: e.target.value})}
                        placeholder="Ex: São Paulo - SP"
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
                  <h3 className="font-medium text-sm text-gray-900 dark:text-white flex items-center">
                    <MapPin className="w-4 h-4 mr-2 text-purple-500" /> Destino
                  </h3>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Destinatário *</label>
                      <input
                        type="text"
                        value={formData.receiver}
                        onChange={(e) => setFormData({...formData, receiver: e.target.value})}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Cidade - UF *</label>
                      <input
                        type="text"
                        value={formData.destination}
                        onChange={(e) => setFormData({...formData, destination: e.target.value})}
                        placeholder="Ex: Rio de Janeiro - RJ"
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Mercadoria & Notas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Volumes *</label>
                  <input
                    type="number"
                    value={formData.volumes}
                    onChange={(e) => setFormData({...formData, volumes: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Peso Total (KG) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.weight}
                    onChange={(e) => setFormData({...formData, weight: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Chave da NF (Opcional)</label>
                  <input
                    type="text"
                    value={formData.invoiceKey}
                    onChange={(e) => setFormData({...formData, invoiceKey: e.target.value})}
                    placeholder="44 dígitos"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Valor da NF (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.invoiceValue}
                    onChange={(e) => setFormData({...formData, invoiceValue: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
              </div>

              {/* Motorista Alocado */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Alocar Motorista (Opcional)</label>
                <select 
                  value={formData.driverId}
                  onChange={(e) => setFormData({...formData, driverId: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                >
                  <option value="">Deixar pendente / Sem motorista...</option>
                  {motoristas.map(m => (
                    <option key={m.id} value={m.id}>{m.user?.name}</option>
                  ))}
                </select>
              </div>

            </div>
            
            <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex justify-end space-x-3 sticky bottom-0">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all flex items-center space-x-2"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Salvar Minuta</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

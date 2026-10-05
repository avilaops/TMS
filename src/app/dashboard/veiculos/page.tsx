"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2, Truck } from "lucide-react";

interface Motorista {
  id: string;
  user: { name: string };
}

interface Veiculo {
  id: string;
  plate: string;
  model: string;
  type: string;
  // Nomes conforme o retorno de GET /api/veiculos (modelo Vehicle do Prisma).
  // O formulário usa capacityKg/defaultDriverId, que a API traduz na escrita.
  capacity: number | null;
  maxWeight: number | null;
  year: number | null;
  driverId: string | null;
  status: string;
  driver?: { user: { name: string } } | null;
}

const STATUS = [
  { value: "AVAILABLE", label: "Disponível" },
  { value: "ON_ROUTE", label: "Em rota" },
  { value: "MAINTENANCE", label: "Manutenção" },
];

const FORM_VAZIO = {
  plate: "",
  model: "",
  type: "VAN",
  capacityKg: "",
  maxWeight: "",
  year: "",
  defaultDriverId: "",
};

export default function VeiculosPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // `null` = cadastro novo; com id, o modal edita aquele veículo.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [formData, setFormData] = useState(FORM_VAZIO);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [veiculosRes, motoristasRes] = await Promise.all([
        fetch('/api/veiculos'),
        fetch('/api/motoristas')
      ]);
      
      if (veiculosRes.ok) {
        setVeiculos(await veiculosRes.json());
      }
      if (motoristasRes.ok) {
        setMotoristas(await motoristasRes.json());
      }
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setIsLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData(FORM_VAZIO);
    setIsModalOpen(true);
  };

  const openEdit = (veiculo: Veiculo) => {
    setEditingId(veiculo.id);
    setFormData({
      plate: veiculo.plate,
      model: veiculo.model,
      type: veiculo.type,
      capacityKg: veiculo.capacity == null ? "" : String(veiculo.capacity),
      maxWeight: veiculo.maxWeight == null ? "" : String(veiculo.maxWeight),
      year: veiculo.year == null ? "" : String(veiculo.year),
      defaultDriverId: veiculo.driverId ?? "",
    });
    setIsModalOpen(true);
  };

  const handleStatusChange = async (veiculo: Veiculo, status: string) => {
    setChangingStatusId(veiculo.id);
    try {
      const res = await fetch(`/api/veiculos/${veiculo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (res.ok) {
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || "Erro ao alterar o status.");
      }
    } catch {
      alert("Erro ao alterar o status.");
    } finally {
      setChangingStatusId(null);
    }
  };

  const handleSave = async () => {
    if (!formData.plate || !formData.model) {
      alert("Placa e Modelo são obrigatórios.");
      return;
    }
    
    setIsSaving(true);
    try {
      // Na edição a placa não muda: é a chave do veículo.
      const { plate, ...resto } = formData;
      const res = await fetch(editingId ? `/api/veiculos/${editingId}` : '/api/veiculos', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? resto : { ...resto, plate }),
      });
      
      if (res.ok) {
        setIsModalOpen(false);
        setFormData(FORM_VAZIO);
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || "Erro ao salvar veículo.");
      }
    } catch {
      alert("Erro ao salvar veículo.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Veículos</h1>
          <p className="text-gray-500 text-sm mt-1">Gerencie a frota de veículos</p>
        </div>
        <button 
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Veículo</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : veiculos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <Truck className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhum veículo cadastrado</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Placa / Modelo</th>
                  <th className="px-6 py-4">Tipo</th>
                  <th className="px-6 py-4">Capacidade (KG)</th>
                  <th className="px-6 py-4">Motorista Padrão</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {veiculos.map(veiculo => (
                  <tr key={veiculo.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                          <Truck className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white uppercase">{veiculo.plate}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{veiculo.model} {veiculo.year ? `(${veiculo.year})` : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{veiculo.type}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{veiculo.capacity || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{veiculo.driver?.user?.name || '-'}</td>
                    <td className="px-6 py-4">
                      <select
                        aria-label={`Status do veículo ${veiculo.plate}`}
                        value={veiculo.status}
                        disabled={changingStatusId === veiculo.id}
                        onChange={(e) => handleStatusChange(veiculo, e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {/* Status antigo fora da lista aparece para ser corrigido. */}
                        {!STATUS.some((s) => s.value === veiculo.status) && (
                          <option value={veiculo.status}>{veiculo.status}</option>
                        )}
                        {STATUS.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap space-x-4">
                      <button onClick={() => openEdit(veiculo)} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                        Editar
                      </button>
                      <a href={`/dashboard/veiculos/${veiculo.id}/manutencao`} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                        Ver Histórico
                      </a>
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
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h2 className="text-xl font-bold font-outfit text-gray-900 dark:text-white">
                {editingId ? "Editar Veículo" : "Cadastrar Veículo"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Placa</label>
                  <input
                    type="text"
                    value={formData.plate}
                    onChange={(e) => setFormData({...formData, plate: e.target.value})}
                    placeholder="ABC-1234"
                    disabled={Boolean(editingId)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white uppercase disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Modelo</label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({...formData, model: e.target.value})}
                    placeholder="Ex: Mercedes Accelo 1016"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                  <select 
                    value={formData.type}
                    onChange={(e) => setFormData({...formData, type: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  >
                    <option value="VAN">Van/Utilitário</option>
                    <option value="VUC">VUC</option>
                    <option value="TOCO">Caminhão Toco</option>
                    <option value="TRUCK">Caminhão Truck</option>
                    <option value="CARRETA">Carreta</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Capacidade (KG)</label>
                  <input
                    type="number"
                    value={formData.capacityKg}
                    onChange={(e) => setFormData({...formData, capacityKg: e.target.value})}
                    placeholder="Ex: 5000"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Peso Máximo (KG)</label>
                  <input
                    type="number"
                    value={formData.maxWeight}
                    onChange={(e) => setFormData({...formData, maxWeight: e.target.value})}
                    placeholder="Ex: 8000"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Ano</label>
                  <input
                    type="number"
                    value={formData.year}
                    onChange={(e) => setFormData({...formData, year: e.target.value})}
                    placeholder="2022"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Motorista Padrão (Opcional)</label>
                <select 
                  value={formData.defaultDriverId}
                  onChange={(e) => setFormData({...formData, defaultDriverId: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                >
                  <option value="">Selecione um motorista...</option>
                  {motoristas.map(m => (
                    <option key={m.id} value={m.id}>{m.user?.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">Isso vinculará este veículo automaticamente a este motorista.</p>
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
                disabled={isSaving}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all flex items-center space-x-2"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Salvar Veículo</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

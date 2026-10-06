"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2, Route, Truck, Package, MapPin, User, ArrowRight, X } from "lucide-react";
import { COLLECTION_STATUS, MANIFEST_STATUS, statusBadge } from "@/lib/format";
import { isLoadable, isManifestEditable } from "@/lib/manifestos";

interface Cliente {
  tradeName: string | null;
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
  active?: boolean;
}

interface Veiculo {
  id: string;
  plate: string;
  model: string;
  type: string;
  status?: string;
}

interface Manifesto {
  id: string;
  status: string;
  createdAt: string;
  driver: Motorista;
  vehicle: Veiculo;
  collections: Minuta[];
}

// O que o operador pode pedir em cada etapa. A API confere de novo.
const ACOES: Record<string, { status: string; label: string; confirm: string; perigo?: boolean }[]> = {
  ASSEMBLING: [
    {
      status: "ROUTE",
      label: "Liberar saída",
      confirm: "Liberar a saída desta viagem? As cargas passam para \"em rota\" e a viagem não pode mais ser alterada.",
    },
    {
      status: "CANCELLED",
      label: "Cancelar",
      confirm: "Cancelar esta viagem? As cargas voltam a ficar livres para outra viagem.",
      perigo: true,
    },
  ],
  ROUTE: [
    {
      status: "FINISHED",
      label: "Encerrar viagem",
      confirm: "Encerrar esta viagem? O que não foi entregue volta ao depósito, livre para outra viagem.",
    },
  ],
};

const FAIXA: Record<string, string> = {
  ASSEMBLING: "bg-amber-500",
  ROUTE: "bg-violet-500",
  FINISHED: "bg-emerald-500",
  CANCELLED: "bg-gray-300",
};

const FORM_VAZIO = { driverId: "", vehicleId: "", collectionIds: [] as string[] };

export default function ManifestosPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Viagem em montagem aberta no modal para alteração; nulo quando é viagem nova.
  const [editing, setEditing] = useState<Manifesto | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manifestos, setManifestos] = useState<Manifesto[]>([]);
  const [minutas, setMinutas] = useState<Minuta[]>([]);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [formData, setFormData] = useState(FORM_VAZIO);

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
        // Só carga já coletada e fora de outra viagem pode ser embarcada.
        setMinutas(allMinutas.filter(isLoadable));
      }
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setIsLoading(false);
    }
  };

  const abrirNovo = () => {
    setEditing(null);
    setFormData(FORM_VAZIO);
    setIsModalOpen(true);
  };

  const abrirEdicao = (manifesto: Manifesto) => {
    setEditing(manifesto);
    setFormData({ driverId: manifesto.driver.id, vehicleId: manifesto.vehicle.id, collectionIds: [] });
    setIsModalOpen(true);
  };

  const fecharModal = () => {
    setIsModalOpen(false);
    setEditing(null);
  };

  const toggleMinuta = (id: string) => {
    setFormData(prev => ({
      ...prev,
      collectionIds: prev.collectionIds.includes(id)
        ? prev.collectionIds.filter(i => i !== id)
        : [...prev.collectionIds, id]
    }));
  };

  // Chamada que altera um manifesto: em erro, mostra a mensagem da API.
  const enviar = async (url: string, method: string, body: unknown, fallback: string) => {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      const errData = await res.json().catch(() => null);
      alert(errData?.error || fallback);
    } catch (error) {
      console.error(fallback, error);
      alert(fallback);
    }
    return false;
  };

  const handleSave = async () => {
    if (!formData.driverId || !formData.vehicleId || (!editing && formData.collectionIds.length === 0)) {
      alert("Por favor, selecione um motorista, um veículo e pelo menos uma carga para a viagem.");
      return;
    }

    setIsSaving(true);
    const ok = editing
      ? await enviar(
          `/api/manifestos/${editing.id}`,
          'PATCH',
          { driverId: formData.driverId, vehicleId: formData.vehicleId, addCollectionIds: formData.collectionIds },
          "Erro ao alterar a viagem."
        )
      : await enviar('/api/manifestos', 'POST', formData, "Erro ao montar a viagem.");
    setIsSaving(false);

    // Em erro a lista também é recarregada: a recusa costuma ser carga que
    // deixou de estar disponível enquanto o modal estava aberto.
    if (ok) fecharModal();
    setFormData(prev => ({ ...prev, collectionIds: [] }));
    fetchData();
  };

  const mudarStatus = async (manifesto: Manifesto, acao: { status: string; confirm: string }) => {
    if (!window.confirm(acao.confirm)) return;
    setBusyId(manifesto.id);
    await enviar(`/api/manifestos/${manifesto.id}/status`, 'POST', { status: acao.status }, "Erro ao atualizar a viagem.");
    setBusyId(null);
    fetchData();
  };

  const retirarCarga = async (manifesto: Manifesto, minuta: Minuta) => {
    if (!window.confirm("Retirar esta carga da viagem? Ela volta a ficar livre para outra viagem.")) return;
    setBusyId(manifesto.id);
    await enviar(`/api/manifestos/${manifesto.id}`, 'PATCH', { removeCollectionIds: [minuta.id] }, "Erro ao retirar a carga.");
    setBusyId(null);
    fetchData();
  };

  // Motorista inativo e veículo em manutenção não saem; ficam fora da escolha,
  // a não ser que já sejam os da viagem aberta.
  const motoristasDisponiveis = motoristas.filter(m => m.active !== false || m.id === formData.driverId);
  const veiculosDisponiveis = veiculos.filter(v => v.status !== "MAINTENANCE" || v.id === formData.vehicleId);

  const pesoSelecionado = minutas
    .filter(m => formData.collectionIds.includes(m.id))
    .reduce((acc, curr) => acc + curr.weight, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Manifestos Operacionais</h1>
          <p className="text-gray-500 text-sm mt-1">Monte as viagens, libere a saída e encerre no retorno</p>
        </div>
        <button
          onClick={abrirNovo}
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
            {manifestos.map(manifesto => {
              const badge = statusBadge(MANIFEST_STATUS, manifesto.status);
              const editavel = isManifestEditable(manifesto);
              const ocupado = busyId === manifesto.id;
              const total = manifesto.collections?.length || 0;
              const entregues = manifesto.collections?.filter(c => c.status === "DELIVERED").length || 0;

              return (
                <div key={manifesto.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden flex flex-col">
                  <div className={`absolute top-0 left-0 w-1 h-full ${FAIXA[manifesto.status] ?? "bg-gray-300"}`}></div>

                  <div className="flex justify-between items-start mb-4">
                    <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold px-2 py-1 rounded-md">
                      Manifesto #{manifesto.id.substring(0,6).toUpperCase()}
                    </span>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${badge.className}`}>
                      {badge.label}
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

                  <div className="mt-6 border-t border-gray-100 dark:border-gray-800 pt-4 flex-1">
                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 flex items-center">
                      <Package className="w-4 h-4 mr-1.5" />
                      {editavel
                        ? `${total} ${total === 1 ? "carga reservada" : "cargas reservadas"}`
                        : `${entregues} de ${total} ${total === 1 ? "entrega feita" : "entregas feitas"}`}
                    </h4>

                    <div className="space-y-3 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                      {manifesto.collections?.map(col => (
                        <div key={col.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-sm flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 dark:text-white truncate">{col.client?.tradeName || col.client?.companyName}</p>
                            <div className="flex items-center text-xs text-gray-500 mt-1 space-x-1">
                              <span>{col.origin.split('-')[0]}</span>
                              <ArrowRight className="w-3 h-3" />
                              <span>{col.destination.split('-')[0]}</span>
                            </div>
                            {!editavel && (
                              <p className="text-xs text-gray-500 mt-1">{statusBadge(COLLECTION_STATUS, col.status).label}</p>
                            )}
                          </div>
                          {editavel && (
                            <button
                              onClick={() => retirarCarga(manifesto, col)}
                              disabled={ocupado}
                              title="Retirar carga da viagem"
                              aria-label="Retirar carga da viagem"
                              className="text-gray-400 hover:text-red-600 disabled:opacity-50 shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {(ACOES[manifesto.status] || editavel) && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-2">
                      {ACOES[manifesto.status]?.filter(acao => !acao.perigo).map(acao => (
                        <button
                          key={acao.status}
                          onClick={() => mudarStatus(manifesto, acao)}
                          disabled={ocupado}
                          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm px-3 py-2 rounded-lg font-medium flex items-center space-x-2"
                        >
                          {ocupado && <Loader2 className="w-3 h-3 animate-spin" />}
                          <span>{acao.label}</span>
                        </button>
                      ))}
                      {editavel && (
                        <button
                          onClick={() => abrirEdicao(manifesto)}
                          disabled={ocupado}
                          className="border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 text-sm px-3 py-2 rounded-lg font-medium"
                        >
                          Alterar
                        </button>
                      )}
                      {ACOES[manifesto.status]?.filter(acao => acao.perigo).map(acao => (
                        <button
                          key={acao.status}
                          onClick={() => mudarStatus(manifesto, acao)}
                          disabled={ocupado}
                          className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 text-sm px-3 py-2 rounded-lg font-medium ml-auto"
                        >
                          {acao.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-white dark:bg-gray-900 z-10">
              <h2 className="text-xl font-bold font-outfit text-gray-900 dark:text-white">
                {editing ? `Alterar Viagem #${editing.id.substring(0,6).toUpperCase()}` : "Montar Manifesto de Viagem"}
              </h2>
              <button onClick={fecharModal} aria-label="Fechar" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
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
                        {motoristasDisponiveis.map(m => (
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
                        {veiculosDisponiveis.map(v => (
                          <option key={v.id} value={v.id}>{v.plate} ({v.type})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800/30">
                  <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-400 mb-2">Resumo da Rota</h4>
                  <div className="space-y-2 text-sm text-blue-700 dark:text-blue-300">
                    {editing && <p>Já na viagem: <span className="font-bold">{editing.collections.length}</span></p>}
                    <p>{editing ? "A acrescentar" : "Cargas"}: <span className="font-bold">{formData.collectionIds.length}</span></p>
                    <p>Peso {editing ? "a acrescentar" : "total"}: <span className="font-bold">{pesoSelecionado.toLocaleString("pt-BR")} kg</span></p>
                  </div>
                </div>

                <p className="text-xs text-gray-500">
                  A viagem nasce em montagem. As cargas só passam para &quot;em rota&quot; quando você liberar a saída.
                </p>
              </div>

              {/* Direita: Seleção de Minutas */}
              <div className="lg:col-span-2 flex flex-col h-full">
                <h3 className="font-medium text-gray-900 dark:text-white mb-3">
                  2. {editing ? "Acrescente cargas" : "Selecione as cargas"} (coletadas e livres)
                </h3>

                {minutas.length === 0 ? (
                  <div className="flex-1 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl flex flex-col items-center justify-center text-center p-6">
                    <Package className="w-10 h-10 text-gray-300 mb-2" />
                    <p className="text-gray-500 font-medium">Não há carga coletada aguardando embarque.</p>
                    <p className="text-gray-400 text-sm mt-1">Uma coleta entra aqui depois de marcada como coletada.</p>
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
                onClick={fecharModal}
                className="px-6 py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || (!editing && formData.collectionIds.length === 0)}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all flex items-center space-x-2"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{editing ? "Salvar alterações" : `Montar viagem (${formData.collectionIds.length})`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

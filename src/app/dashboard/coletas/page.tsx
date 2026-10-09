"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Search, Loader2, Package, MapPin, Truck, Copy, Check, Pencil, Inbox } from "lucide-react";
import { COLLECTION_STATUSES, allowedTransitions, changedFields, isEditable, type CollectionStatus } from "@/lib/coletas";
import { COLLECTION_STATUS, statusBadge } from "@/lib/format";

interface Cliente {
  id: string;
  tradeName: string;
  companyName: string;
  active?: boolean;
}

interface Motorista {
  id: string;
  active?: boolean;
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
  manifestId: string | null;
  invoiceKey: string | null;
  invoiceValue: number | null;
  // Frete calculado pela tabela, ou informado à mão (`freightManual`). Nulo = a cotar.
  freightValue: number | null;
  freightManual: boolean;
  trackingCode: string | null;
  // Comprovante registrado pelo motorista na baixa; nulo na baixa feita pelo painel.
  proof?: { id: string; status: string } | null;
  client: Cliente;
  driver?: Motorista | null;
}

/**
 * Codigo de rastreio na listagem: e por aqui que o operador le e repassa o
 * numero ao cliente. Sem isto, o rastreio publico exigiria um dado que ninguem
 * na operacao conseguiria informar.
 */
function TrackingCodeCell({ code }: { code: string | null }) {
  const [copiado, setCopiado] = useState(false);

  if (!code) {
    return <span className="text-gray-400 text-xs italic">Sem código</span>;
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Area de transferencia bloqueada (http, permissao): o numero segue
      // visivel na tela para o operador ler ou selecionar.
    }
  };

  return (
    <button
      type="button"
      onClick={copiar}
      title="Copiar código de rastreio"
      className="group flex items-center space-x-1.5 font-mono text-sm text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
    >
      <span>{code}</span>
      {copiado
        ? <Check className="w-3.5 h-3.5 text-green-600" />
        : <Copy className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-600" />}
    </button>
  );
}

const EMPTY_FORM = {
  clientId: "",
  sender: "",
  receiver: "",
  origin: "",
  destination: "",
  volumes: "",
  weight: "",
  invoiceKey: "",
  invoiceValue: "",
  freightValue: "",
  driverId: "",
};

// A coleta como o formulário de edição a mostra, sem o cliente (que não muda).
const toEditForm = (coleta: Coleta) => ({
  sender: coleta.sender,
  receiver: coleta.receiver,
  origin: coleta.origin,
  destination: coleta.destination,
  volumes: String(coleta.volumes),
  weight: String(coleta.weight),
  invoiceKey: coleta.invoiceKey ?? "",
  invoiceValue: coleta.invoiceValue === null ? "" : String(coleta.invoiceValue),
  // Só o valor fixado à mão aparece no campo: em branco quer dizer "pela tabela".
  freightValue: coleta.freightManual && coleta.freightValue !== null ? String(coleta.freightValue) : "",
  driverId: coleta.driver?.id ?? "",
});

// Como cada troca de status aparece na linha. As que não têm volta pedem confirmação.
const STATUS_ACTIONS: Partial<Record<CollectionStatus, { label: string; confirm?: string; className: string }>> = {
  CONFIRMED: { label: "Confirmar", className: "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20" },
  COLLECTED: { label: "Marcar coletada", className: "text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20" },
  DELIVERED: { label: "Dar baixa", className: "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20" },
  REJECTED: { label: "Recusar", confirm: "Recusar esta solicitação de coleta?", className: "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20" },
  CANCELLED: { label: "Cancelar", confirm: "Cancelar esta coleta?", className: "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20" },
};

export default function ColetasPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Id da coleta em edição; `null` quando o modal está criando uma nova.
  const [editingId, setEditingId] = useState<string | null>(null);
  // O formulário como o modal de edição abriu: é contra ele que se vê o que mudou.
  const [editOriginal, setEditOriginal] = useState<ReturnType<typeof toEditForm> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [coletas, setColetas] = useState<Coleta[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [formData, setFormData] = useState(EMPTY_FORM);

  // A tela já nasce com `isLoading` ligado: a primeira carga só busca.
  const loadData = () =>
    Promise.all([
      fetch('/api/coletas'),
      fetch('/api/clientes'),
      fetch('/api/motoristas')
    ])
      .then(async ([coletasRes, clientesRes, motoristasRes]) => {
        if (coletasRes.ok) setColetas(await coletasRes.json());
        if (clientesRes.ok) setClientes(await clientesRes.json());
        if (motoristasRes.ok) setMotoristas(await motoristasRes.json());
      })
      .catch((error) => console.error("Failed to fetch data", error))
      .finally(() => setIsLoading(false));

  const fetchData = async () => {
    setIsLoading(true);
    await loadData();
  };

  useEffect(() => {
    loadData();
  }, []);

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setEditOriginal(null);
    setFormData(EMPTY_FORM);
  };

  const openEdit = (coleta: Coleta) => {
    const original = toEditForm(coleta);
    setEditingId(coleta.id);
    setEditOriginal(original);
    setFormData({ clientId: coleta.client?.id ?? "", ...original });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.clientId || !formData.sender || !formData.receiver || !formData.origin || !formData.destination) {
      alert("Por favor, preencha todos os campos obrigatórios.");
      return;
    }

    const fallback = editingId ? "Erro ao salvar minuta." : "Erro ao criar minuta.";
    // O cliente não muda na edição: a rota nem aceita o campo.
    const { clientId, ...editable } = formData;

    // Na edição vai só o que mudou: coleta antiga com chave de NF fora do
    // padrão continua editável nos outros campos.
    let changes: Partial<typeof editable> = editable;
    if (editingId && editOriginal) {
      changes = changedFields(editOriginal, editable);
      if (Object.keys(changes).length === 0) {
        closeModal();
        return;
      }
    }

    setIsSaving(true);
    try {
      const res = editingId
        ? await fetch(`/api/coletas/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(changes),
          })
        : await fetch('/api/coletas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, ...editable }),
          });

      if (res.ok) {
        closeModal();
        fetchData();
      } else {
        const errData = await res.json().catch(() => null);
        alert(errData?.error || fallback);
        // 409: a coleta mudou por baixo (entrou em manifesto, foi entregue).
        if (res.status === 409) fetchData();
      }
    } catch {
      alert(fallback);
    } finally {
      setIsSaving(false);
    }
  };

  const changeStatus = async (coleta: Coleta, status: CollectionStatus) => {
    const action = STATUS_ACTIONS[status];
    let receiverName: string | undefined;

    if (status === "DELIVERED") {
      // O nome de quem recebeu é a confirmação da baixa: sem ele, nada é enviado.
      const answer = window.prompt("Dar baixa na entrega. Nome de quem recebeu:");
      if (answer === null) return;
      receiverName = answer.trim();
      if (receiverName.length < 2) {
        alert("Informe o nome de quem recebeu.");
        return;
      }
    } else if (action?.confirm && !window.confirm(action.confirm)) {
      return;
    }

    setBusyId(coleta.id);
    try {
      const res = await fetch(`/api/dashboard/coletas/${coleta.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, receiverName }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        alert(errData?.error || "Erro ao atualizar a coleta.");
      }
      // Recarrega também quando falha: a recusa costuma ser lista desatualizada.
      await fetchData();
    } catch {
      alert("Erro ao atualizar a coleta.");
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = coletas.filter(c => c.status === 'PENDING').length;

  const term = search.trim().toLowerCase();
  const visibleColetas = coletas.filter(c => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (!term) return true;
    return [c.client?.tradeName, c.client?.companyName, c.origin, c.destination, c.trackingCode]
      .some(value => value?.toLowerCase().includes(term));
  });

  // Cadastro inativo não entra em coleta nova; o que já está na coleta em
  // edição continua na lista para o formulário não trocar o valor sozinho.
  const clientOptions = clientes.filter(c => c.active !== false || c.id === formData.clientId);
  const driverOptions = motoristas.filter(m => m.active !== false || m.id === formData.driverId);

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Minutas (Coletas)</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Gestão de emissões não-fiscais e ordens de coleta</p>
        </div>
        <div className="flex items-center gap-2 md:gap-3 text-sm md:text-base">
          <Link
            href="/dashboard/coletas/pendentes"
            className="px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center space-x-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
          >
            <Inbox className="w-4 h-4" />
            <span className="md:hidden">Pendentes</span>
            <span className="hidden md:inline">Solicitações pendentes</span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${pendingCount > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
              {pendingCount}
            </span>
          </Link>
          <button 
            onClick={() => { setEditingId(null); setFormData(EMPTY_FORM); setIsModalOpen(true); }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Minuta</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente, origem, destino ou código de rastreio"
            aria-label="Buscar coletas"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filtrar por status"
          className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
        >
          <option value="">Todos os status</option>
          {COLLECTION_STATUSES.map(status => (
            <option key={status} value={status}>{statusBadge(COLLECTION_STATUS, status).label}</option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden md:min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px] md:h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : coletas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] md:h-[400px] text-center">
            <Package className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma minuta registrada</h3>
          </div>
        ) : visibleColetas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] md:h-[400px] text-center">
            <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma minuta com este filtro</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="block md:table w-full text-left">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Cliente / Rota</th>
                  <th className="px-6 py-4">Cód. rastreio</th>
                  <th className="px-6 py-4">Volumes / Peso</th>
                  <th className="px-6 py-4">Valor NF / Frete</th>
                  <th className="px-6 py-4">Motorista</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {visibleColetas.map(coleta => (
                  <tr key={coleta.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 md:table-row hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-4">
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
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4">
                      <TrackingCodeCell code={coleta.trackingCode} />
                    </td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4 text-sm text-gray-600 dark:text-gray-300">
                      <div>{coleta.volumes} vols</div>
                      <div className="text-xs text-gray-500">{coleta.weight} kg</div>
                    </td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4 text-sm text-gray-600 dark:text-gray-300">
                      <div>{coleta.invoiceValue ? `R$ ${coleta.invoiceValue.toFixed(2)}` : '-'}</div>
                      <div className="text-xs text-gray-500">
                        {coleta.freightValue === null
                          ? 'Frete a cotar'
                          : `Frete R$ ${coleta.freightValue.toFixed(2)}${coleta.freightManual ? ' (manual)' : ''}`}
                      </div>
                    </td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4 text-sm text-gray-600 dark:text-gray-300">
                      {coleta.driver ? (
                        <div className="flex items-center space-x-1">
                          <Truck className="w-4 h-4 text-gray-400" />
                          <span>{coleta.driver.user?.name}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs italic">Não alocado</span>
                      )}
                    </td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full border whitespace-nowrap ${statusBadge(COLLECTION_STATUS, coleta.status).className}`}>
                        {statusBadge(COLLECTION_STATUS, coleta.status).label}
                      </span>
                    </td>
                    <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-4">
                      <div className="flex flex-wrap items-center gap-1">
                        {allowedTransitions(coleta.status).map(status => {
                          const action = STATUS_ACTIONS[status];
                          if (!action) return null;
                          return (
                            <button
                              key={status}
                              type="button"
                              disabled={busyId === coleta.id}
                              onClick={() => changeStatus(coleta, status)}
                              className={`px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap transition-colors disabled:opacity-50 ${action.className}`}
                            >
                              {action.label}
                            </button>
                          );
                        })}
                        {coleta.proof && (
                          <Link
                            href={`/dashboard/entregas/${coleta.id}/comprovante`}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            Comprovante
                          </Link>
                        )}
                        {isEditable(coleta) && (
                          <button
                            type="button"
                            disabled={busyId === coleta.id}
                            onClick={() => openEdit(coleta)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg flex items-center space-x-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Editar</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 md:rounded-2xl w-full max-w-4xl md:max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="sticky top-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md p-3 md:p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center z-10">
              <h2 className="text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white">{editingId ? "Editar Minuta" : "Emitir Nova Minuta"}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>
            
            <div className="p-3 md:p-6 space-y-2 md:space-y-6">
              {/* Cliente */}
              <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                <label className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Cliente (Pagador) *</label>
                <select 
                  value={formData.clientId}
                  onChange={(e) => setFormData({...formData, clientId: e.target.value})}
                  disabled={editingId !== null}
                  className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white disabled:bg-gray-100 disabled:text-gray-500 dark:disabled:bg-gray-800"
                >
                  <option value="">Selecione um cliente...</option>
                  {clientOptions.map(c => (
                    <option key={c.id} value={c.id}>{c.tradeName || c.companyName}</option>
                  ))}
                </select>
                {editingId && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">O cliente não pode ser trocado depois de a minuta ser emitida.</p>
                )}
              </div>

              {/* Remetente & Destinatário */}
              <div className="grid grid-cols-2 gap-2 md:gap-6">
                <div className="min-w-0 space-y-1.5 md:space-y-4 p-2 md:p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
                  <h3 className="font-medium text-sm text-gray-900 dark:text-white flex items-center">
                    <MapPin className="w-4 h-4 mr-2 text-blue-500" /> Origem
                  </h3>
                  <div className="space-y-1.5 md:space-y-3">
                    <div className="space-y-0.5 md:space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Remetente *</label>
                      <input
                        type="text"
                        value={formData.sender}
                        onChange={(e) => setFormData({...formData, sender: e.target.value})}
                        className="block w-full min-w-0 px-3 py-1.5 md:py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Cidade - UF *</label>
                      <input
                        type="text"
                        value={formData.origin}
                        onChange={(e) => setFormData({...formData, origin: e.target.value})}
                        placeholder="Ex: São Paulo - SP"
                        className="block w-full min-w-0 px-3 py-1.5 md:py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="min-w-0 space-y-1.5 md:space-y-4 p-2 md:p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
                  <h3 className="font-medium text-sm text-gray-900 dark:text-white flex items-center">
                    <MapPin className="w-4 h-4 mr-2 text-purple-500" /> Destino
                  </h3>
                  <div className="space-y-1.5 md:space-y-3">
                    <div className="space-y-0.5 md:space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Destinatário *</label>
                      <input
                        type="text"
                        value={formData.receiver}
                        onChange={(e) => setFormData({...formData, receiver: e.target.value})}
                        className="block w-full min-w-0 px-3 py-1.5 md:py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Cidade - UF *</label>
                      <input
                        type="text"
                        value={formData.destination}
                        onChange={(e) => setFormData({...formData, destination: e.target.value})}
                        placeholder="Ex: Rio de Janeiro - RJ"
                        className="block w-full min-w-0 px-3 py-1.5 md:py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Mercadoria & Notas */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2 md:gap-4">
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Volumes *</label>
                  <input
                    type="number"
                    value={formData.volumes}
                    onChange={(e) => setFormData({...formData, volumes: e.target.value})}
                    className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Peso Total (KG) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.weight}
                    onChange={(e) => setFormData({...formData, weight: e.target.value})}
                    className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Chave da NF (Opcional)</label>
                  <input
                    type="text"
                    value={formData.invoiceKey}
                    onChange={(e) => setFormData({...formData, invoiceKey: e.target.value})}
                    placeholder="44 dígitos"
                    className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white text-xs"
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Valor da NF (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.invoiceValue}
                    onChange={(e) => setFormData({...formData, invoiceValue: e.target.value})}
                    className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
              </div>

              {/* Frete: só na edição. Na criação ele sai da tabela de frete. */}
              {editingId && (
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label htmlFor="coleta-frete" className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Frete (R$)</label>
                  <input
                    id="coleta-frete"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.freightValue}
                    onChange={(e) => setFormData({...formData, freightValue: e.target.value})}
                    placeholder="Em branco = calcular pela tabela de frete"
                    className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
              )}

              {/* Motorista Alocado */}
              <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                <label className="text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">Alocar Motorista (Opcional)</label>
                <select 
                  value={formData.driverId}
                  onChange={(e) => setFormData({...formData, driverId: e.target.value})}
                  className="block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                >
                  <option value="">Deixar pendente / Sem motorista...</option>
                  {driverOptions.map(m => (
                    <option key={m.id} value={m.id}>{m.user?.name}{m.active === false ? " (inativo)" : ""}</option>
                  ))}
                </select>
              </div>

            </div>
            
            <div className="p-3 md:p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex justify-end space-x-3 sticky bottom-0">
              <button 
                onClick={closeModal}
                className="px-4 py-2 md:px-6 md:py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 md:px-6 md:py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all flex items-center space-x-2"
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

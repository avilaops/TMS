"use client";

import { useState, useEffect } from "react";
import { Plus, Search, Loader2, Users } from "lucide-react";
import { getCompanyByCnpj } from "@/lib/brasilApi";

interface Cliente {
  id: string;
  cnpj: string;
  companyName: string;
  tradeName: string | null;
  ie: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentCondition: string | null;
  creditLimit: number | null;
  freightTableId: string | null;
  active: boolean;
}

const FORM_VAZIO = {
  cnpj: "",
  companyName: "",
  tradeName: "",
  ie: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  paymentCondition: "",
  creditLimit: "",
  freightTableId: "",
};

type Form = typeof FORM_VAZIO;

const toForm = (cliente: Cliente): Form => ({
  cnpj: cliente.cnpj,
  companyName: cliente.companyName,
  tradeName: cliente.tradeName ?? "",
  ie: cliente.ie ?? "",
  contactName: cliente.contactName ?? "",
  email: cliente.email ?? "",
  phone: cliente.phone ?? "",
  address: cliente.address ?? "",
  paymentCondition: cliente.paymentCondition ?? "",
  creditLimit: cliente.creditLimit == null ? "" : String(cliente.creditLimit),
  freightTableId: cliente.freightTableId ?? "",
});

const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white";
const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";

export default function ClientesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // `null` = cadastro novo; com id, o modal edita aquele cliente.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [formData, setFormData] = useState(FORM_VAZIO);
  // Tabelas de frete para o seletor do formulário.
  const [tabelas, setTabelas] = useState<{ id: string; name: string; isDefault: boolean; active: boolean }[]>([]);

  useEffect(() => {
    fetchClientes();
    fetch('/api/tabelas-frete')
      .then((res) => (res.ok ? res.json() : []))
      .then(setTabelas)
      .catch(() => setTabelas([]));
  }, []);

  const fetchClientes = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/clientes');
      if (res.ok) {
        const data = await res.json();
        setClientes(data);
      }
    } catch (error) {
      console.error("Failed to fetch clientes", error);
    } finally {
      setIsLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData(FORM_VAZIO);
    setIsModalOpen(true);
  };

  const openEdit = (cliente: Cliente) => {
    setEditingId(cliente.id);
    setFormData(toForm(cliente));
    setIsModalOpen(true);
  };

  const handleCnpjSearch = async () => {
    const digitos = formData.cnpj.replace(/\D/g, "");
    if (digitos.length !== 14) {
      alert("Informe os 14 dígitos do CNPJ para buscar.");
      return;
    }
    setLoadingCnpj(true);
    try {
      const data = await getCompanyByCnpj(digitos);
      if (data) {
        setFormData((atual) => ({
          ...atual,
          cnpj: data.cnpj,
          companyName: data.razao_social,
          tradeName: data.nome_fantasia || "",
          email: data.email || "",
          phone: data.ddd_telefone_1 || "",
          address: `${data.logradouro}, ${data.numero} - ${data.bairro}, ${data.municipio} - ${data.uf}`,
        }));
      } else {
        alert("CNPJ não encontrado");
      }
    } catch {
      alert("Erro ao buscar CNPJ");
    } finally {
      setLoadingCnpj(false);
    }
  };

  const handleSave = async () => {
    if (!formData.cnpj || !formData.companyName) {
      alert("CNPJ e Razão Social são obrigatórios.");
      return;
    }

    // Na edição vai só o que mudou: cadastro antigo com CNPJ ou e-mail fora do
    // padrão continua editável nos outros campos.
    let corpo: Partial<Form> = formData;
    if (editingId) {
      const atual = clientes.find((c) => c.id === editingId);
      const original = atual ? toForm(atual) : null;
      if (original) {
        corpo = Object.fromEntries(
          (Object.keys(formData) as (keyof Form)[])
            .filter((campo) => formData[campo] !== original[campo])
            .map((campo) => [campo, formData[campo]]),
        );
        if (Object.keys(corpo).length === 0) {
          setIsModalOpen(false);
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      const res = await fetch(editingId ? `/api/clientes/${editingId}` : '/api/clientes', {
        method: editingId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
      });

      if (res.ok) {
        setIsModalOpen(false);
        setFormData(FORM_VAZIO);
        fetchClientes();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || "Erro ao salvar cliente.");
      }
    } catch {
      alert("Erro ao salvar cliente.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (cliente: Cliente) => {
    if (cliente.active && !confirm(`Desativar ${cliente.tradeName || cliente.companyName}?`)) return;

    setTogglingId(cliente.id);
    try {
      const res = await fetch(`/api/clientes/${cliente.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !cliente.active }),
      });

      if (res.ok) {
        fetchClientes();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || "Erro ao alterar cliente.");
      }
    } catch {
      alert("Erro ao alterar cliente.");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Clientes</h1>
          <p className="text-gray-500 text-sm mt-1">Gerencie a carteira de clientes</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Cliente</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden md:min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px] md:h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : clientes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] md:h-[400px] text-center">
            <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhum cliente cadastrado</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="block md:table w-full text-left">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Empresa</th>
                  <th className="px-6 py-4">CNPJ</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Telefone</th>
                  <th className="px-6 py-4">Situação</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {clientes.map(cliente => (
                  <tr key={cliente.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 md:table-row hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                          <Users className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{cliente.tradeName || cliente.companyName}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{cliente.companyName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4 text-sm text-gray-600 dark:text-gray-300">{cliente.cnpj}</td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4 text-sm text-gray-600 dark:text-gray-300">{cliente.email || '-'}</td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4 text-sm text-gray-600 dark:text-gray-300">{cliente.phone || '-'}</td>
                    <td className="min-w-0 md:table-cell md:px-6 md:py-4">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                          cliente.active
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {cliente.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-4 md:text-right whitespace-nowrap space-x-4">
                      <button onClick={() => openEdit(cliente)} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                        Editar
                      </button>
                      <button
                        onClick={() => handleToggleActive(cliente)}
                        disabled={togglingId === cliente.id}
                        className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white text-sm font-medium disabled:opacity-50"
                      >
                        {cliente.active ? "Desativar" : "Reativar"}
                      </button>
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
          <div className="bg-white dark:bg-gray-900 md:rounded-2xl w-full max-w-2xl md:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="p-3 md:p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h2 className="text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white">
                {editingId ? "Editar Cliente" : "Cadastrar Cliente"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>

            <div className="p-3 md:p-6 space-y-2 md:space-y-4 overflow-y-auto">
              <div className="flex space-x-2">
                <div className="flex-1 space-y-1.5">
                  <label className={LABEL}>CNPJ / CPF</label>
                  <input
                    type="text"
                    value={formData.cnpj}
                    onChange={(e) => setFormData({...formData, cnpj: e.target.value})}
                    placeholder="00.000.000/0000-00"
                    className={INPUT}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleCnpjSearch}
                    disabled={loadingCnpj}
                    className="h-[34px] md:h-[46px] px-4 md:px-6 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-medium transition-colors flex items-center justify-center"
                  >
                    {loadingCnpj ? <Loader2 className="w-5 h-5 animate-spin" /> : "Buscar"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 mt-4">
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className={LABEL}>Razão Social</label>
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={(e) => setFormData({...formData, companyName: e.target.value})}
                    className={INPUT}
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className={LABEL}>Nome Fantasia</label>
                  <input
                    type="text"
                    value={formData.tradeName}
                    onChange={(e) => setFormData({...formData, tradeName: e.target.value})}
                    className={INPUT}
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className={LABEL}>Inscrição Estadual</label>
                  <input
                    type="text"
                    value={formData.ie}
                    onChange={(e) => setFormData({...formData, ie: e.target.value})}
                    className={INPUT}
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className={LABEL}>Contato</label>
                  <input
                    type="text"
                    value={formData.contactName}
                    onChange={(e) => setFormData({...formData, contactName: e.target.value})}
                    placeholder="Nome de quem atende"
                    className={INPUT}
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className={LABEL}>E-mail</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className={INPUT}
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className={LABEL}>Telefone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    className={INPUT}
                  />
                </div>
              </div>

              <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                <label className={LABEL}>Endereço Completo</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                  className={INPUT}
                />
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className={LABEL}>Condição de Pagamento</label>
                  <input
                    type="text"
                    value={formData.paymentCondition}
                    onChange={(e) => setFormData({...formData, paymentCondition: e.target.value})}
                    placeholder="Ex: 28 dias, boleto"
                    className={INPUT}
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label className={LABEL}>Limite de Crédito (R$)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.creditLimit}
                    onChange={(e) => setFormData({...formData, creditLimit: e.target.value})}
                    className={INPUT}
                  />
                </div>
                <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                  <label htmlFor="cliente-tabela-frete" className={LABEL}>Tabela de frete</label>
                  <select
                    id="cliente-tabela-frete"
                    value={formData.freightTableId}
                    onChange={(e) => setFormData({...formData, freightTableId: e.target.value})}
                    className={INPUT}
                  >
                    <option value="">Padrão da transportadora</option>
                    {tabelas
                      .filter((tabela) => tabela.active || tabela.id === formData.freightTableId)
                      .map((tabela) => (
                        <option key={tabela.id} value={tabela.id}>
                          {tabela.name}
                          {tabela.active ? "" : " (inativa)"}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

            </div>

            <div className="p-3 md:p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex justify-end space-x-3">
              <button
                onClick={() => setIsModalOpen(false)}
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
                <span>Salvar Cliente</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

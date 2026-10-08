"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2, CarFront, User } from "lucide-react";
import { AvisoDeAcesso, type Acesso } from "@/components/AvisoDeAcesso";

interface Motorista {
  id: string;
  user: { name: string; email: string };
  cpf: string;
  phone: string | null;
  category: string;
  cnh: string;
  cnhExpiry: string;
  active: boolean;
}

const CATEGORIAS = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"];

const FORM_VAZIO = {
  name: "",
  cpf: "",
  email: "",
  phone: "",
  cnh: "",
  category: "B",
  cnhExpiry: "",
};

const INPUT =
  "w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500";
const LABEL = "text-sm font-medium text-gray-700 dark:text-gray-300";

// A validade é só o dia: lida em UTC para não voltar um dia no fuso do Brasil.
const diaDaValidade = (iso: string) => iso.slice(0, 10);

function formatarValidade(iso: string) {
  const [ano, mes, dia] = diaDaValidade(iso).split("-");
  return `${dia}/${mes}/${ano}`;
}

function cnhVencida(iso: string) {
  const hoje = new Date();
  const hojeTexto = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  return diaDaValidade(iso) < hojeTexto;
}

export default function MotoristasPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  // `null` = cadastro novo; com id, o modal edita aquele motorista.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Resultado da liberação no login único do último motorista salvo.
  const [acesso, setAcesso] = useState<{ nome: string; acesso: Acesso } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [formData, setFormData] = useState(FORM_VAZIO);

  useEffect(() => {
    fetchMotoristas();
  }, []);

  const fetchMotoristas = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/motoristas');
      if (res.ok) {
        const data = await res.json();
        setMotoristas(data);
      }
    } catch (error) {
      console.error("Failed to fetch motoristas", error);
    } finally {
      setIsLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormData(FORM_VAZIO);
    setIsModalOpen(true);
  };

  const openEdit = (motorista: Motorista) => {
    setEditingId(motorista.id);
    setFormData({
      name: motorista.user?.name ?? "",
      cpf: motorista.cpf,
      email: motorista.user?.email ?? "",
          phone: motorista.phone ?? "",
      cnh: motorista.cnh,
      category: motorista.category,
      cnhExpiry: diaDaValidade(motorista.cnhExpiry),
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.cpf || !formData.email || !formData.cnh || !formData.cnhExpiry) {
      alert("Nome, CPF, e-mail, CNH e validade da CNH são obrigatórios.");
      return;
    }

    setIsSaving(true);
    try {
      // Na edição o CPF não muda.
      const { cpf, ...resto } = formData;
      const body = editingId ? resto : { ...resto, cpf };

      const res = await fetch(editingId ? `/api/motoristas/${editingId}` : '/api/motoristas', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const salvo = (await res.json().catch(() => ({}))) as { acesso?: Acesso };
        if (salvo.acesso) setAcesso({ nome: formData.name, acesso: salvo.acesso });
        setIsModalOpen(false);
        setFormData(FORM_VAZIO);
        fetchMotoristas();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || "Erro ao salvar motorista.");
      }
    } catch {
      alert("Erro ao salvar motorista.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (motorista: Motorista) => {
    if (
      motorista.active &&
      !confirm(`Desativar ${motorista.user?.name}? Ele deixa de conseguir usar o aplicativo.`)
    ) {
      return;
    }

    setTogglingId(motorista.id);
    try {
      const res = await fetch(`/api/motoristas/${motorista.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !motorista.active }),
      });

      if (res.ok) {
        fetchMotoristas();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || "Erro ao alterar motorista.");
      }
    } catch {
      alert("Erro ao alterar motorista.");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Motoristas</h1>
          <p className="text-gray-500 text-sm mt-1">Gerencie a equipe de motoristas</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Motorista</span>
        </button>
      </div>

      {acesso && <AvisoDeAcesso nome={acesso.nome} acesso={acesso.acesso} onFechar={() => setAcesso(null)} />}

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : motoristas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <CarFront className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhum motorista cadastrado</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Nome</th>
                  <th className="px-6 py-4">CPF</th>
                  <th className="px-6 py-4">CNH (Categoria)</th>
                  <th className="px-6 py-4">Validade da CNH</th>
                  <th className="px-6 py-4">Telefone</th>
                  <th className="px-6 py-4">Situação</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {motoristas.map(motorista => {
                  const vencida = cnhVencida(motorista.cnhExpiry);
                  return (
                    <tr key={motorista.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                            <User className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{motorista.user?.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{motorista.user?.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{motorista.cpf}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {motorista.cnh || '-'} <span className="font-semibold">({motorista.category})</span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {vencida ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            {formatarValidade(motorista.cnhExpiry)} · vencida
                          </span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-300">{formatarValidade(motorista.cnhExpiry)}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{motorista.phone || '-'}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                            motorista.active
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {motorista.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap space-x-4">
                        <button onClick={() => openEdit(motorista)} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                          Editar
                        </button>
                        <button
                          onClick={() => handleToggleActive(motorista)}
                          disabled={togglingId === motorista.id}
                          className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white text-sm font-medium disabled:opacity-50"
                        >
                          {motorista.active ? "Desativar" : "Reativar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h2 className="text-xl font-bold font-outfit text-gray-900 dark:text-white">
                {editingId ? "Editar Motorista" : "Cadastrar Motorista"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="space-y-1.5">
                <label className={LABEL}>Nome Completo</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="Nome do Motorista"
                  className={INPUT}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={LABEL}>CPF</label>
                  <input
                    type="text"
                    value={formData.cpf}
                    onChange={(e) => setFormData({...formData, cpf: e.target.value})}
                    placeholder="000.000.000-00"
                    disabled={Boolean(editingId)}
                    className={INPUT}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL}>Telefone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    placeholder="(00) 00000-0000"
                    className={INPUT}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={LABEL}>E-mail de acesso</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    placeholder="motorista@exemplo.com.br"
                    autoComplete="off"
                    className={INPUT}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">O motorista entra no aplicativo com a conta Ávila Ops deste e-mail (ou do CPF). Se ele ainda não tem conta, você recebe um link para enviar a ele.</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className={LABEL}>CNH</label>
                  <input
                    type="text"
                    value={formData.cnh}
                    onChange={(e) => setFormData({...formData, cnh: e.target.value})}
                    placeholder="Número da CNH"
                    className={INPUT}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL}>Categoria</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  >
                    {/* Cadastro antigo pode ter categoria fora da lista: aparece para ser corrigida. */}
                    {!CATEGORIAS.includes(formData.category) && (
                      <option value={formData.category}>{formData.category}</option>
                    )}
                    {CATEGORIAS.map((categoria) => (
                      <option key={categoria} value={categoria}>{categoria}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL}>Validade da CNH</label>
                  <input
                    type="date"
                    value={formData.cnhExpiry}
                    onChange={(e) => setFormData({...formData, cnhExpiry: e.target.value})}
                    className={INPUT}
                  />
                </div>
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
                <span>Salvar Motorista</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Plus, ArrowUpRight, ArrowDownRight, Loader2, DollarSign, Wallet, ShieldAlert, LogIn } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deniedReason, loadTransactions, type DeniedReason } from "./carregar";

export default function FinanceiroPage() {
  const [activeTab, setActiveTab] = useState<'RECEIVABLE' | 'PAYABLE'>('RECEIVABLE');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [denied, setDenied] = useState<DeniedReason | null>(null);

  const [formData, setFormData] = useState({
    type: 'INCOME',
    amount: '',
    description: '',
    dueDate: '',
    status: 'PENDING'
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const result = await loadTransactions(() => fetch('/api/financeiro'));
      if (result.denied) {
        setDenied(result.denied);
      } else {
        setTransactions(result.transactions);
      }
    } catch (error) {
      console.error("Erro ao buscar transações", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.amount || !formData.description) return alert("Preencha valor e descrição.");
    
    setIsSaving(true);
    try {
      const res = await fetch('/api/financeiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      if (res.ok) {
        setIsModalOpen(false);
        setFormData({ type: 'INCOME', amount: '', description: '', dueDate: '', status: 'PENDING' });
        fetchData();
      } else if (deniedReason(res.status)) {
        setIsModalOpen(false);
        setDenied(deniedReason(res.status));
      } else {
        alert("Erro ao salvar transação.");
      }
    } catch (error) {
      alert("Erro ao salvar transação.");
    } finally {
      setIsSaving(false);
    }
  };

  const incomes = transactions.filter(t => t.type === 'INCOME');
  const expenses = transactions.filter(t => t.type === 'EXPENSE');

  const totalIncome = incomes.reduce((acc, t) => acc + t.amount, 0);
  const totalExpense = expenses.reduce((acc, t) => acc + t.amount, 0);
  const balance = totalIncome - totalExpense;

  const currentList = activeTab === 'RECEIVABLE' ? incomes : expenses;

  if (denied === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-amber-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Sua sessão terminou. Entre novamente para ver o financeiro.
          </CardDescription>
          <Link
            href="/login"
            className="mt-2 inline-flex w-fit items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Entrar novamente
          </Link>
        </CardHeader>
      </Card>
    );
  }

  if (denied === "forbidden") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Acesso negado
          </CardTitle>
          <CardDescription>
            O financeiro é restrito ao perfil Administrador.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white flex items-center">
            <Wallet className="w-6 h-6 mr-2 text-green-600" />
            Financeiro
          </h1>
          <p className="text-gray-500 text-sm mt-1">Gestão de Contas a Pagar e Receber</p>
        </div>
        <button 
          onClick={() => {
            setFormData(prev => ({ ...prev, type: activeTab === 'RECEIVABLE' ? 'INCOME' : 'EXPENSE' }));
            setIsModalOpen(true);
          }}
          className="bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-white text-white dark:text-gray-900 px-4 py-2.5 rounded-xl flex items-center space-x-2 transition-all font-medium"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Lançamento</span>
        </button>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-3xl shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium">Contas a Receber</h3>
            <div className="w-8 h-8 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <p className="text-3xl font-bold font-outfit text-gray-900 dark:text-white">R$ {totalIncome.toFixed(2)}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 rounded-3xl shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium">Contas a Pagar</h3>
            <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
              <ArrowDownRight className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
          </div>
          <p className="text-3xl font-bold font-outfit text-gray-900 dark:text-white">R$ {totalExpense.toFixed(2)}</p>
        </div>
        <div className="bg-gray-900 dark:bg-blue-600 p-6 rounded-3xl shadow-xl shadow-gray-900/20 dark:shadow-blue-600/20 relative overflow-hidden text-white">
          <div className="absolute top-0 right-0 p-16 bg-white/10 rounded-full blur-2xl -z-0"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-300 dark:text-blue-200 text-sm font-medium">Saldo Previsto</h3>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
            </div>
            <p className="text-3xl font-bold font-outfit">R$ {balance.toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl shadow-sm overflow-hidden min-h-[400px]">
        
        {/* Abas */}
        <div className="flex border-b border-gray-100 dark:border-gray-800">
          <button 
            onClick={() => setActiveTab('RECEIVABLE')}
            className={`flex-1 py-4 text-sm font-medium transition-colors relative ${activeTab === 'RECEIVABLE' ? 'text-green-600 dark:text-green-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
          >
            A Receber (Faturamento)
            {activeTab === 'RECEIVABLE' && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 w-full h-0.5 bg-green-600 dark:bg-green-400" />
            )}
          </button>
          <button 
            onClick={() => setActiveTab('PAYABLE')}
            className={`flex-1 py-4 text-sm font-medium transition-colors relative ${activeTab === 'PAYABLE' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
          >
            A Pagar (Despesas)
            {activeTab === 'PAYABLE' && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 w-full h-0.5 bg-red-600 dark:bg-red-400" />
            )}
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-[300px]">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : currentList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[300px] text-center">
            <DollarSign className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma transação {activeTab === 'RECEIVABLE' ? 'a receber' : 'a pagar'}</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Descrição</th>
                  <th className="px-6 py-4">Vencimento</th>
                  <th className="px-6 py-4">Valor</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {currentList.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{t.description}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                      {t.dueDate ? new Date(t.dueDate).toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-sm font-bold ${activeTab === 'RECEIVABLE' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {activeTab === 'RECEIVABLE' ? '+' : '-'} R$ {t.amount.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                        t.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }`}>
                        {t.status === 'PAID' ? 'Pago' : 'Pendente'}
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
          <div className="bg-white dark:bg-gray-900 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h2 className="text-xl font-bold font-outfit text-gray-900 dark:text-white">Novo Lançamento</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
                  <button 
                    onClick={() => setFormData({...formData, type: 'INCOME'})}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${formData.type === 'INCOME' ? 'bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 shadow-sm' : 'text-gray-500'}`}
                  >
                    Receita
                  </button>
                  <button 
                    onClick={() => setFormData({...formData, type: 'EXPENSE'})}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${formData.type === 'EXPENSE' ? 'bg-white dark:bg-gray-700 text-red-600 dark:text-red-400 shadow-sm' : 'text-gray-500'}`}
                  >
                    Despesa
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Descrição</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="Ex: Frete Rota 001"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Valor (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({...formData, amount: e.target.value})}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Vencimento</label>
                  <input
                    type="date"
                    value={formData.dueDate}
                    onChange={(e) => setFormData({...formData, dueDate: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
              </div>
              
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({...formData, status: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                >
                  <option value="PENDING">Pendente</option>
                  <option value="PAID">Pago / Recebido</option>
                </select>
              </div>

            </div>
            
            <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex justify-end space-x-3">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 text-gray-600 font-medium">Cancelar</button>
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-white text-white dark:text-gray-900 px-6 py-2.5 rounded-xl font-medium transition-all flex items-center"
              >
                {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Salvar Transação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

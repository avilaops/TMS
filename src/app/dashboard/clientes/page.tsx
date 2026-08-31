"use client";

import { useState, useEffect } from "react";
import { Plus, Search, Loader2, Users } from "lucide-react";
import { getCompanyByCnpj } from "@/lib/brasilApi";

interface Cliente {
  id: string;
  cnpj: string;
  companyName: string;
  tradeName: string;
  email: string;
  phone: string;
  address: string;
}

export default function ClientesPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cnpjBusca, setCnpjBusca] = useState("");
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [formData, setFormData] = useState({
    cnpj: "",
    companyName: "",
    tradeName: "",
    email: "",
    phone: "",
    address: "",
  });

  useEffect(() => {
    fetchClientes();
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

  const handleCnpjSearch = async () => {
    if (cnpjBusca.length < 14) return;
    setLoadingCnpj(true);
    try {
      const data = await getCompanyByCnpj(cnpjBusca);
      if (data) {
        setFormData({
          cnpj: data.cnpj,
          companyName: data.razao_social,
          tradeName: data.nome_fantasia || "",
          email: data.email || "",
          phone: data.ddd_telefone_1 || "",
          address: `${data.logradouro}, ${data.numero} - ${data.bairro}, ${data.municipio} - ${data.uf}`,
        });
      } else {
        alert("CNPJ não encontrado");
      }
    } catch (err) {
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
    
    setIsSaving(true);
    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cnpj: formData.cnpj,
          companyName: formData.companyName,
          tradeName: formData.tradeName,
          email: formData.email,
          phone: formData.phone,
          address: formData.address,
        }),
      });
      
      if (res.ok) {
        setIsModalOpen(false);
        setFormData({ cnpj: "", companyName: "", tradeName: "", email: "", phone: "", address: "" });
        setCnpjBusca("");
        fetchClientes();
      } else {
        const errData = await res.json();
        alert(errData.error || "Erro ao salvar cliente.");
      }
    } catch (error) {
      alert("Erro ao salvar cliente.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Clientes</h1>
          <p className="text-gray-500 text-sm mt-1">Gerencie a carteira de clientes</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Cliente</span>
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[400px]">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : clientes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[400px] text-center">
            <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhum cliente cadastrado</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-6 py-4">Empresa</th>
                  <th className="px-6 py-4">CNPJ</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Telefone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {clientes.map(cliente => (
                  <tr key={cliente.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-6 py-4">
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
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{cliente.cnpj}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{cliente.email || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{cliente.phone || '-'}</td>
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
              <h2 className="text-xl font-bold font-outfit text-gray-900 dark:text-white">Cadastrar Cliente</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="flex space-x-2">
                <div className="flex-1 space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">CNPJ</label>
                  <input
                    type="text"
                    value={cnpjBusca}
                    onChange={(e) => setCnpjBusca(e.target.value)}
                    placeholder="Somente números"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="flex items-end">
                  <button 
                    onClick={handleCnpjSearch}
                    disabled={loadingCnpj}
                    className="h-[46px] px-6 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-medium transition-colors flex items-center justify-center"
                  >
                    {loadingCnpj ? <Loader2 className="w-5 h-5 animate-spin" /> : "Buscar"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Razão Social</label>
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={(e) => setFormData({...formData, companyName: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Nome Fantasia</label>
                  <input
                    type="text"
                    value={formData.tradeName}
                    onChange={(e) => setFormData({...formData, tradeName: e.target.value})}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Endereço Completo</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white"
                />
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
                <span>Salvar Cliente</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

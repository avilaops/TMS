"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Handshake, Loader2, Plus, Search } from "lucide-react";
import { AcessoRestrito } from "@/components/AcessoRestrito";
import { formatCurrency, formatDocument } from "@/lib/format";
import { CALC_BASE_LABEL, CALC_MODES, CALC_MODE_LABEL, rotuloDaForma, type FormaDeCalculo } from "@/lib/frete-contratado";
import { CARRIER_TYPES, CARRIER_TYPE_LABEL, UFS_DO_PARCEIRO, rotuloDoTipo } from "@/lib/parceiros";
import { pode } from "@/lib/permissoes";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";
import { FechamentoDoParceiro } from "./fechamento";

/**
 * Parceiros de transporte: o agregado, o autônomo e a transportadora donos de
 * veículo que roda para a empresa. A lista mostra os veículos e os motoristas
 * de cada um e, para quem lê o frete contratado, o total em aberto a pagar e o
 * fechamento por período. O cadastro é em partes no celular, para caber na tela.
 *
 * Só para mostrar os botões: quem decide o acesso é a API.
 */

interface Parceiro {
  id: string;
  type: string;
  name: string;
  taxId: string;
  rntrc: string | null;
  ie: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  pixKey: string | null;
  bankInfo: string | null;
  notes: string | null;
  active: boolean;
  vehicles: { id: string; plate: string; model: string }[];
  drivers: { id: string; active: boolean; user: { name: string } }[];
  // Só vêm para quem lê o frete contratado.
  defaultCalcMode?: string | null;
  defaultCalcBase?: number | null;
  emAberto?: number;
}

const FORM_VAZIO = {
  type: "TAC_AGREGADO",
  taxId: "",
  name: "",
  rntrc: "",
  ie: "",
  state: "",
  phone: "",
  email: "",
  pixKey: "",
  bankInfo: "",
  notes: "",
  defaultCalcMode: "",
  defaultCalcBase: "",
};

type Form = typeof FORM_VAZIO;
const CAMPOS_DA_CONTRATACAO = ["defaultCalcMode", "defaultCalcBase"] as const;

const toForm = (parceiro: Parceiro): Form => ({
  type: parceiro.type,
  taxId: parceiro.taxId,
  name: parceiro.name,
  rntrc: parceiro.rntrc ?? "",
  ie: parceiro.ie ?? "",
  state: parceiro.state ?? "",
  phone: parceiro.phone ?? "",
  email: parceiro.email ?? "",
  pixKey: parceiro.pixKey ?? "",
  bankInfo: parceiro.bankInfo ?? "",
  notes: parceiro.notes ?? "",
  defaultCalcMode: parceiro.defaultCalcMode ?? "",
  defaultCalcBase: parceiro.defaultCalcBase == null ? "" : String(parceiro.defaultCalcBase).replace(".", ","),
});

const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none dark:text-white text-sm disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500";
const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
const ROTULADO = "min-w-0 md:table-cell md:px-6 md:py-4 text-sm text-gray-600 dark:text-gray-300 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:text-gray-500 md:before:content-none";

const PARTES = ["Cadastro", "Pagamento", "Vínculos"] as const;
type ParteDoCadastro = (typeof PARTES)[number];

async function mensagemDeErro(res: Response, padrao: string): Promise<string> {
  const corpo = await res.json().catch(() => null);
  return typeof corpo?.error === "string" ? corpo.error : padrao;
}

const json = (method: string, corpo: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

export default function ParceirosPage() {
  const { data: session } = useSession();
  const altera = pode(session?.user?.role, "parceiros");
  const veValores = pode(session?.user?.role, "freteContratadoVer");
  const alteraValores = pode(session?.user?.role, "freteContratado");

  const [parceiros, setParceiros] = useState<Parceiro[]>([]);
  const [negado, setNegado] = useState<DeniedReason | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // `null` = cadastro novo; com id, o modal edita aquele parceiro.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(FORM_VAZIO);
  const [parte, setParte] = useState<ParteDoCadastro>("Cadastro");
  const [isSaving, setIsSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [fechamento, setFechamento] = useState<Parceiro | null>(null);

  const ler = useCallback(async () => {
    try {
      const res = await fetch("/api/parceiros");
      const motivo = deniedReason(res.status);
      if (motivo) setNegado(motivo);
      else if (res.ok) setParceiros(await res.json());
    } catch (error) {
      console.error("Falha ao carregar os parceiros", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let ativo = true;
    fetch("/api/parceiros")
      .then(async (res) => {
        if (!ativo) return;
        const motivo = deniedReason(res.status);
        if (motivo) setNegado(motivo);
        else if (res.ok) setParceiros(await res.json());
      })
      .catch((error) => console.error("Falha ao carregar os parceiros", error))
      .finally(() => {
        if (ativo) setIsLoading(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  if (negado) return <AcessoRestrito motivo={negado} oQue="os parceiros" />;

  const emEdicao = editingId ? parceiros.find((parceiro) => parceiro.id === editingId) : undefined;

  const openCreate = () => {
    setEditingId(null);
    setFormData(FORM_VAZIO);
    setParte("Cadastro");
    setErro("");
    setIsModalOpen(true);
  };

  const openEdit = (parceiro: Parceiro) => {
    setEditingId(parceiro.id);
    setFormData(toForm(parceiro));
    setParte("Cadastro");
    setErro("");
    setIsModalOpen(true);
  };

  const mudar = (campo: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setErro("");
    setFormData((atual) => ({ ...atual, [campo]: e.target.value }));
  };

  const handleSave = async () => {
    if (!formData.taxId.trim() || !formData.name.trim()) {
      setParte("Cadastro");
      setErro("CPF ou CNPJ e nome são obrigatórios.");
      return;
    }

    setIsSaving(true);
    setErro("");
    try {
      const { defaultCalcMode, defaultCalcBase, taxId, ...cadastro } = formData;
      const contratacao = { defaultCalcMode, defaultCalcBase };

      if (!editingId) {
        // A contratação padrão só vai junto quando quem cadastra pode gravá-la.
        const res = await fetch("/api/parceiros", json("POST", { ...cadastro, taxId, ...(alteraValores && contratacao) }));
        if (!res.ok) {
          setErro(await mensagemDeErro(res, "Erro ao salvar o parceiro."));
          return;
        }
      } else {
        // Na edição vai só o que mudou; o documento não muda. Cadastro e contratação têm rotas (e permissões) separadas.
        const original = emEdicao ? toForm(emEdicao) : null;
        const mudou = (campo: keyof Form) => !original || formData[campo] !== original[campo];
        const camposDoCadastro = (Object.keys(cadastro) as (keyof typeof cadastro)[]).filter(mudou);
        if (altera && camposDoCadastro.length > 0) {
          const res = await fetch(`/api/parceiros/${editingId}`, json("PATCH", Object.fromEntries(camposDoCadastro.map((campo) => [campo, formData[campo]]))));
          if (!res.ok) {
            setErro(await mensagemDeErro(res, "Erro ao salvar o parceiro."));
            return;
          }
        }
        if (alteraValores && CAMPOS_DA_CONTRATACAO.some(mudou)) {
          const res = await fetch(`/api/parceiros/${editingId}/contratacao`, json("PUT", contratacao));
          if (!res.ok) {
            setParte("Pagamento");
            setErro(await mensagemDeErro(res, "Erro ao salvar a contratação padrão."));
            // O cadastro já foi gravado: a lista é lida de novo mesmo com a contratação recusada.
            await ler();
            return;
          }
        }
      }

      setIsModalOpen(false);
      setFormData(FORM_VAZIO);
      await ler();
    } catch {
      setErro("Erro ao salvar o parceiro.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (parceiro: Parceiro) => {
    if (parceiro.active && !confirm(`Desativar ${parceiro.name}? Os veículos e os motoristas dele continuam ligados; só deixa de nascer contrato novo.`)) return;
    setTogglingId(parceiro.id);
    try {
      const res = await fetch(`/api/parceiros/${parceiro.id}`, json("PATCH", { active: !parceiro.active }));
      if (res.ok) await ler();
      else alert(await mensagemDeErro(res, "Erro ao alterar o parceiro."));
    } catch {
      alert("Erro ao alterar o parceiro.");
    } finally {
      setTogglingId(null);
    }
  };

  const totalEmAberto = parceiros.reduce((soma, parceiro) => soma + (parceiro.emAberto ?? 0), 0);
  // No celular, uma parte por vez; no computador, todas abertas.
  const visivel = (nome: ParteDoCadastro, noComputador: "md:grid" | "md:block" = "md:grid") => (parte === nome ? "" : `hidden ${noComputador}`);
  const forma = formData.defaultCalcMode as FormaDeCalculo | "";

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex justify-between items-center gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Parceiros</h1>
          <p className="text-gray-500 text-sm mt-1 truncate">
            {veValores ? (
              <span data-total-em-aberto>
                Em aberto a pagar: <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(totalEmAberto)}</span>
              </span>
            ) : (
              "Agregados, autônomos e transportadoras"
            )}
          </p>
        </div>
        {altera && (
          <button onClick={openCreate} className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all">
            <Plus className="w-4 h-4" />
            <span>Novo parceiro</span>
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden md:min-h-[400px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px] md:h-[400px]" role="status" aria-label="Carregando">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : parceiros.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] md:h-[400px] text-center">
            <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-gray-500 dark:text-gray-400 font-medium">Nenhum parceiro cadastrado</h3>
          </div>
        ) : (
          <table className="block md:table w-full text-left">
            <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm font-medium border-b border-gray-100 dark:border-gray-800">
              <tr>
                <th className="px-6 py-4">Parceiro</th>
                <th className="px-6 py-4">Veículos</th>
                <th className="px-6 py-4">Motoristas</th>
                {veValores && <th className="px-6 py-4">Em aberto</th>}
                <th className="px-6 py-4">Situação</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
              {parceiros.map((parceiro) => (
                <tr key={parceiro.id} data-parceiro={parceiro.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 md:table-row hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-4">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0 w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                        <Handshake className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{parceiro.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {rotuloDoTipo(parceiro.type)} · {formatDocument(parceiro.taxId)}
                        </p>
                      </div>
                      {/* No celular o selo vai ao lado do nome, para o cartão ficar curto. */}
                      <span className={`md:hidden shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${parceiro.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {parceiro.active ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                  </td>
                  <td data-rotulo="Veículos" className={ROTULADO}>
                    <span className="block truncate">{parceiro.vehicles.length === 0 ? "-" : parceiro.vehicles.map((veiculo) => veiculo.plate).join(", ")}</span>
                  </td>
                  <td data-rotulo="Motoristas" className={ROTULADO}>
                    <span className="block truncate">{parceiro.drivers.length === 0 ? "-" : parceiro.drivers.map((motorista) => motorista.user.name).join(", ")}</span>
                  </td>
                  {veValores && (
                    <td data-rotulo="Em aberto a pagar" data-em-aberto className={`${ROTULADO} col-span-2 md:col-span-1`}>
                      <span className={`font-semibold ${(parceiro.emAberto ?? 0) > 0 ? "text-amber-700" : "text-gray-900 dark:text-white"}`}>{formatCurrency(parceiro.emAberto ?? 0)}</span>
                    </td>
                  )}
                  <td className="hidden md:table-cell md:px-6 md:py-4">
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                        parceiro.active ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {parceiro.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-4 md:text-right whitespace-nowrap space-x-4">
                    <button onClick={() => openEdit(parceiro)} className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                      {altera || alteraValores ? "Editar" : "Ver"}
                    </button>
                    {veValores && (
                      <button onClick={() => setFechamento(parceiro)} data-abrir-fechamento className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                        Fechamento
                      </button>
                    )}
                    {altera && (
                      <button
                        onClick={() => handleToggleActive(parceiro)}
                        disabled={togglingId === parceiro.id}
                        className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white text-sm font-medium disabled:opacity-50"
                      >
                        {parceiro.active ? "Desativar" : "Reativar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {fechamento && <FechamentoDoParceiro parceiro={fechamento} onClose={() => setFechamento(null)} />}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div role="dialog" aria-label={editingId ? "Parceiro" : "Novo parceiro"} className="bg-white dark:bg-gray-900 md:rounded-2xl w-full max-w-2xl md:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-gray-100 dark:border-gray-800">
            <div className="px-3 py-2 md:p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
              <h2 className="text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white truncate">{editingId ? emEdicao?.name ?? "Parceiro" : "Novo parceiro"}</h2>
              <button onClick={() => setIsModalOpen(false)} aria-label="Fechar" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>

            <div role="tablist" aria-label="Parte do cadastro" className="md:hidden grid grid-cols-3 gap-1 p-1 mx-3 mt-2 bg-gray-100 dark:bg-gray-800 rounded-xl">
              {PARTES.map((nome) => (
                <button
                  key={nome}
                  type="button"
                  role="tab"
                  aria-selected={parte === nome}
                  data-parte={nome}
                  onClick={() => setParte(nome)}
                  className={`py-1.5 rounded-lg text-sm font-semibold ${parte === nome ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
                >
                  {nome}
                </button>
              ))}
            </div>

            <div className="flex-1 p-3 md:p-6 space-y-2 md:space-y-4 overflow-y-auto">
              <fieldset disabled={!altera} data-secao="Cadastro" className={`${visivel("Cadastro")} grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4`}>
                <label className="block min-w-0 space-y-0.5">
                  <span className={LABEL}>Tipo</span>
                  <select name="type" value={formData.type} onChange={mudar("type")} className={INPUT}>
                    {CARRIER_TYPES.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {CARRIER_TYPE_LABEL[tipo]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0 space-y-0.5">
                  <span className={LABEL}>CPF ou CNPJ</span>
                  <input name="taxId" value={formData.taxId} onChange={mudar("taxId")} disabled={Boolean(editingId)} className={INPUT} />
                </label>
                <label className="col-span-2 block min-w-0 space-y-0.5">
                  <span className={LABEL}>Nome ou razão social</span>
                  <input name="name" value={formData.name} onChange={mudar("name")} maxLength={60} className={INPUT} />
                </label>
                <label className="block min-w-0 space-y-0.5">
                  <span className={LABEL}>RNTRC (8 dígitos)</span>
                  <input name="rntrc" inputMode="numeric" value={formData.rntrc} onChange={mudar("rntrc")} className={INPUT} />
                </label>
                <label className="block min-w-0 space-y-0.5">
                  <span className={LABEL}>UF</span>
                  <select name="state" value={formData.state} onChange={mudar("state")} className={INPUT}>
                    <option value="">Não informada</option>
                    {UFS_DO_PARCEIRO.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0 space-y-0.5">
                  <span className={LABEL}>Inscrição estadual</span>
                  <input name="ie" value={formData.ie} onChange={mudar("ie")} className={INPUT} />
                </label>
                <label className="block min-w-0 space-y-0.5">
                  <span className={LABEL}>Telefone</span>
                  <input name="phone" value={formData.phone} onChange={mudar("phone")} className={INPUT} />
                </label>
                <label className="col-span-2 block min-w-0 space-y-0.5">
                  <span className={LABEL}>E-mail</span>
                  <input name="email" type="email" value={formData.email} onChange={mudar("email")} className={INPUT} />
                </label>
                <p className="col-span-2 text-[11px] leading-tight text-gray-500">O MDF-e de viagem em veículo deste parceiro leva estes dados como proprietário: nome, CPF ou CNPJ, RNTRC, IE, UF e tipo.</p>
              </fieldset>

              <div data-secao="Pagamento" className={`${visivel("Pagamento")} grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4`}>
                <fieldset disabled={!altera} className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
                  <label className="col-span-2 block min-w-0 space-y-0.5">
                    <span className={LABEL}>Chave Pix</span>
                    <input name="pixKey" value={formData.pixKey} onChange={mudar("pixKey")} className={INPUT} />
                  </label>
                  <label className="col-span-2 block min-w-0 space-y-0.5">
                    <span className={LABEL}>Dados bancários</span>
                    <input name="bankInfo" value={formData.bankInfo} onChange={mudar("bankInfo")} placeholder="Banco, agência e conta" className={INPUT} />
                  </label>
                  <label className="col-span-2 block min-w-0 space-y-0.5">
                    <span className={LABEL}>Observação</span>
                    <input name="notes" value={formData.notes} onChange={mudar("notes")} maxLength={1000} className={INPUT} />
                  </label>
                </fieldset>
                {/* A contratação padrão é dinheiro: só aparece para quem lê o frete contratado, e só quem o altera edita. */}
                {veValores && (
                  <fieldset disabled={!alteraValores} data-contratacao-padrao className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
                    <label className="block min-w-0 space-y-0.5">
                      <span className={LABEL}>Contratação padrão</span>
                      <select name="defaultCalcMode" value={formData.defaultCalcMode} onChange={mudar("defaultCalcMode")} className={INPUT}>
                        <option value="">Sem padrão</option>
                        {CALC_MODES.map((modo) => (
                          <option key={modo} value={modo}>
                            {CALC_MODE_LABEL[modo]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block min-w-0 space-y-0.5">
                      <span className={LABEL}>{forma ? CALC_BASE_LABEL[forma] : "Valor padrão"}</span>
                      <input name="defaultCalcBase" inputMode="decimal" value={formData.defaultCalcBase} onChange={mudar("defaultCalcBase")} disabled={!forma} className={INPUT} />
                    </label>
                    <p className="col-span-2 text-[11px] leading-tight text-gray-500">
                      Vale para os contratos de frete que nascerem depois: a viagem montada em veículo deste parceiro já vem com {forma ? rotuloDaForma(forma).toLowerCase() : "a forma escolhida"}.
                    </p>
                  </fieldset>
                )}
              </div>

              <div data-secao="Vínculos" className={`${visivel("Vínculos", "md:block")} space-y-2`}>
                {!editingId ? (
                  <p className="text-sm text-gray-500">Depois de salvar, ligue os veículos e os motoristas a este parceiro no cadastro de cada um (Veículos e Motoristas).</p>
                ) : (
                  <>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Veículos</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300" data-veiculos-do-parceiro>
                        {emEdicao && emEdicao.vehicles.length > 0 ? emEdicao.vehicles.map((veiculo) => `${veiculo.plate} (${veiculo.model})`).join(" · ") : "Nenhum veículo ligado."}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Motoristas</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300" data-motoristas-do-parceiro>
                        {emEdicao && emEdicao.drivers.length > 0
                          ? emEdicao.drivers.map((motorista) => `${motorista.user.name}${motorista.active ? "" : " (inativo)"}`).join(" · ")
                          : "Nenhum motorista ligado."}
                      </p>
                    </div>
                    <p className="text-[11px] leading-tight text-gray-500">A ligação é feita no cadastro do veículo (campo Dono do veículo) e no do motorista (campo Parceiro).</p>
                  </>
                )}
              </div>

              {erro && (
                <p role="alert" className="text-sm text-red-600">
                  {erro}
                </p>
              )}
            </div>

            <div className="p-3 md:p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex justify-end space-x-3">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 md:px-6 md:py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium">
                {altera || alteraValores ? "Cancelar" : "Fechar"}
              </button>
              {(altera || (alteraValores && editingId)) && (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 md:px-6 md:py-2.5 rounded-xl font-medium shadow-lg shadow-blue-500/30 transition-all flex items-center space-x-2"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Salvar parceiro</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

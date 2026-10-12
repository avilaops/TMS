"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Search, Loader2, Package, MapPin, Truck, Copy, Check, Pencil, Inbox } from "lucide-react";
import {
  COLLECTION_STATUSES,
  PRIORIDADES,
  PRIORIDADE_LABEL,
  allowedTransitions,
  changedFields,
  isEditable,
  janelaDaColeta,
  type CollectionStatus,
} from "@/lib/coletas";
import { COLLECTION_STATUS, statusBadge } from "@/lib/format";
import { cepFormatado } from "@/lib/endereco";
import { EXIGENCIA_DO_SERVICO, QUEM_DECIDE_O_SERVICO, ROTULO_DO_SERVICO, TIPOS_DE_SERVICO, tipoDeServico, type RedespachoDaCarga } from "@/lib/redespacho";
import { textoDasTentativas } from "@/lib/comprovantes";

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

// Redespacho e subcontratação (src/lib/redespacho.ts): o tipo de serviço, o CT-e anterior, o expedidor e o recebedor. Tudo opcional.
interface Coleta extends Partial<RedespachoDaCarga> {
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
  // Pedido de coleta: janela de horário, prioridade, cubagem e observação. Tudo opcional.
  pickupDate: string | null;
  pickupFrom: string | null;
  pickupTo: string | null;
  priority: string;
  cubicMeters: number | null;
  pickupNotes: string | null;
  // Endereço da entrega, além da cidade. Tudo opcional (src/lib/endereco.ts).
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryDistrict: string | null;
  deliveryZip: string | null;
  // Comprovante registrado pelo motorista na baixa; nulo na baixa feita pelo painel.
  proof?: { id: string; status: string; exceptionType?: string | null } | null;
  // Tentativas de entrega sem sucesso registradas pelo motorista.
  _count?: { deliveryAttempts: number };
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
  pickupDate: "",
  pickupFrom: "",
  pickupTo: "",
  priority: "NORMAL",
  cubicMeters: "",
  pickupNotes: "",
  deliveryStreet: "",
  deliveryNumber: "",
  deliveryDistrict: "",
  deliveryZip: "",
  serviceType: "NORMAL",
  previousCteKey: "",
  shipperName: "",
  shipperDocument: "",
  shipperIe: "",
  shipperStreet: "",
  shipperNumber: "",
  shipperDistrict: "",
  shipperCity: "",
  shipperZip: "",
  consigneeName: "",
  consigneeDocument: "",
  consigneeIe: "",
  consigneeStreet: "",
  consigneeNumber: "",
  consigneeDistrict: "",
  consigneeCity: "",
  consigneeZip: "",
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
  // Dia do calendário: os dez primeiros caracteres, sem passar pelo fuso.
  pickupDate: coleta.pickupDate ? coleta.pickupDate.slice(0, 10) : "",
  pickupFrom: coleta.pickupFrom ?? "",
  pickupTo: coleta.pickupTo ?? "",
  priority: coleta.priority || "NORMAL",
  cubicMeters: coleta.cubicMeters === null ? "" : String(coleta.cubicMeters),
  pickupNotes: coleta.pickupNotes ?? "",
  deliveryStreet: coleta.deliveryStreet ?? "",
  deliveryNumber: coleta.deliveryNumber ?? "",
  deliveryDistrict: coleta.deliveryDistrict ?? "",
  deliveryZip: cepFormatado(coleta.deliveryZip),
  serviceType: tipoDeServico(coleta.serviceType),
  previousCteKey: coleta.previousCteKey ?? "",
  shipperName: coleta.shipperName ?? "",
  shipperDocument: coleta.shipperDocument ?? "",
  shipperIe: coleta.shipperIe ?? "",
  shipperStreet: coleta.shipperStreet ?? "",
  shipperNumber: coleta.shipperNumber ?? "",
  shipperDistrict: coleta.shipperDistrict ?? "",
  shipperCity: coleta.shipperCity ?? "",
  shipperZip: cepFormatado(coleta.shipperZip),
  consigneeName: coleta.consigneeName ?? "",
  consigneeDocument: coleta.consigneeDocument ?? "",
  consigneeIe: coleta.consigneeIe ?? "",
  consigneeStreet: coleta.consigneeStreet ?? "",
  consigneeNumber: coleta.consigneeNumber ?? "",
  consigneeDistrict: coleta.consigneeDistrict ?? "",
  consigneeCity: coleta.consigneeCity ?? "",
  consigneeZip: cepFormatado(coleta.consigneeZip),
});

// As duas partes do bloco de redespacho e os campos de cada uma (as colunas são `shipper*` e `consignee*`).
const PARTES_DO_REDESPACHO = [
  { prefixo: "shipper", rotulo: "Expedidor", explicacao: "Quem entrega a carga a você." },
  { prefixo: "consignee", rotulo: "Recebedor", explicacao: "Quem recebe a carga de você." },
] as const;
type PrefixoDaParte = (typeof PARTES_DO_REDESPACHO)[number]["prefixo"];

const CAMPOS_DA_PARTE = [
  { sufixo: "Name", rotulo: "Nome / razão social", maximo: 60 },
  { sufixo: "Document", rotulo: "CNPJ / CPF", maximo: 18 },
  { sufixo: "Ie", rotulo: "Inscrição estadual", maximo: 20, exemplo: "ou ISENTO" },
  { sufixo: "City", rotulo: "Cidade - UF", maximo: 100, exemplo: "Ex: Santos - SP" },
  { sufixo: "Street", rotulo: "Logradouro", maximo: 200 },
  { sufixo: "Number", rotulo: "Número", maximo: 20 },
  { sufixo: "District", rotulo: "Bairro", maximo: 100 },
  { sufixo: "Zip", rotulo: "CEP", maximo: 9, exemplo: "00000-000" },
] as const;

// O formulário tem algum dado de redespacho? É o que abre o bloco ao editar.
const temRedespachoNoFormulario = (form: typeof EMPTY_FORM) =>
  form.serviceType !== "NORMAL" || Boolean(form.previousCteKey) || PARTES_DO_REDESPACHO.some(({ prefixo }) => CAMPOS_DA_PARTE.some(({ sufixo }) => Boolean(form[`${prefixo}${sufixo}`])));

// O formulário tem algum dado do endereço de entrega? É o que abre a seção ao editar.
const temEndereco = (form: typeof EMPTY_FORM) => Boolean(form.deliveryStreet || form.deliveryNumber || form.deliveryDistrict || form.deliveryZip);

// O formulário tem algum dado do pedido? É o que abre a seção ao editar.
const temPedido = (form: typeof EMPTY_FORM) =>
  Boolean(form.pickupDate || form.pickupFrom || form.pickupTo || form.cubicMeters || form.pickupNotes) || form.priority !== "NORMAL";

// Os blocos opcionais do formulário. No celular cada um abre como uma etapa própria, em tela cheia.
const TITULO_DA_ETAPA = { pedido: "Janela, prioridade e cubagem", endereco: "Endereço da entrega", redespacho: "Redespacho / subcontratação" } as const;
type Etapa = keyof typeof TITULO_DA_ETAPA;

/** A tela é de celular? Sem `matchMedia` (testes, navegador antigo) vale o desenho do computador. */
const noCelular = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;

const CAMPO_DO_PEDIDO =
  "block w-full min-w-0 px-3 py-1.5 md:px-4 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:text-white";
const ROTULO_DO_PEDIDO = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";

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
  // Os dados do pedido (janela, prioridade, cubagem) ficam recolhidos: são
  // opcionais, e o formulário principal precisa caber na tela do celular.
  const [pedidoAberto, setPedidoAberto] = useState(false);
  const [enderecoAberto, setEnderecoAberto] = useState(false);
  // Redespacho e subcontratação: fechado por padrão. No celular, expedidor e recebedor são abas (uma parte por vez).
  const [redespachoAberto, setRedespachoAberto] = useState(false);
  const [parteAberta, setParteAberta] = useState<PrefixoDaParte>("shipper");
  // No celular, o bloco aberto vira uma etapa em tela cheia: o resto do formulário sai da frente até "Concluir".
  // No computador a etapa não muda nada (as classes `md:` mostram tudo) e o bloco abre e fecha no lugar.
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const alternarBloco = (nome: Etapa, aberto: boolean, abrir: (aberto: boolean) => void) => {
    if (noCelular()) {
      abrir(true);
      setEtapa(nome);
    } else {
      abrir(!aberto);
    }
  };
  // Fora da etapa aberta, o que é do formulário principal some no celular.
  const foraDaEtapa = etapa ? "hidden md:block" : "";
  const blocoDaEtapa = (nome: Etapa) => (etapa && etapa !== nome ? "hidden md:block" : "");
  const botaoDoBloco = (nome: Etapa) => `${etapa === nome ? "hidden md:flex" : "flex"} w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300`;

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
    setPedidoAberto(false);
    setEnderecoAberto(false);
    setRedespachoAberto(false);
    setParteAberta("shipper");
    setEtapa(null);
  };

  const openEdit = (coleta: Coleta) => {
    const original = toEditForm(coleta);
    setEditingId(coleta.id);
    setEditOriginal(original);
    setFormData({ clientId: coleta.client?.id ?? "", ...original });
    setPedidoAberto(temPedido({ clientId: "", ...original }));
    setEnderecoAberto(temEndereco({ clientId: "", ...original }));
    setRedespachoAberto(temRedespachoNoFormulario({ clientId: "", ...original }));
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
                          <PedidoDaColeta coleta={coleta} />
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
                            {coleta.proof.exceptionType ? 'Comprovante (com ressalva)' : 'Comprovante'}
                          </Link>
                        )}
                        {(coleta._count?.deliveryAttempts ?? 0) > 0 && (
                          <Link
                            href={`/dashboard/entregas/${coleta.id}/tentativas`}
                            data-tentativas={coleta.id}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 transition-colors"
                          >
                            {textoDasTentativas(coleta._count?.deliveryAttempts ?? 0)}
                          </Link>
                        )}
                        {/* Minuta de despacho para imprimir: toda carga tem. Não é documento fiscal. */}
                        <Link
                          href={`/dashboard/coletas/${coleta.id}/minuta`}
                          data-minuta-de={coleta.id}
                          className="px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
                        >
                          Minuta
                        </Link>
                        {/* Etiquetas dos volumes: da coleta confirmada até a carga sair do depósito. */}
                        {(coleta.status === 'CONFIRMED' || coleta.status === 'COLLECTED') && coleta.trackingCode && (
                          <Link
                            href={`/dashboard/deposito/etiquetas/${coleta.id}`}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg whitespace-nowrap text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 transition-colors"
                          >
                            Etiquetas
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
              <h2 data-titulo-do-formulario className="text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white">
                {/* No celular, com um bloco aberto, o título é o da etapa. */}
                {etapa && <span className="md:hidden">{TITULO_DA_ETAPA[etapa]}</span>}
                <span className={etapa ? "hidden md:inline" : ""}>{editingId ? "Editar Minuta" : "Emitir Nova Minuta"}</span>
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>
            
            <div className="p-3 md:p-6 space-y-2 md:space-y-6">
              {/* Cliente */}
              <div className={`space-y-0.5 md:space-y-1.5 min-w-0 ${foraDaEtapa}`}>
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
              <div className={`${etapa ? "hidden md:grid" : "grid"} grid-cols-2 gap-2 md:gap-6`}>
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
              <div className={`${etapa ? "hidden md:grid" : "grid"} grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2 md:gap-4`}>
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
                <div className={`space-y-0.5 md:space-y-1.5 min-w-0 ${foraDaEtapa}`}>
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

              {/* Pedido de coleta: opcional e recolhido, para o formulário caber na tela do celular (lá, aberto, é uma etapa em tela cheia). */}
              <div data-bloco="pedido" className={`rounded-xl border border-gray-100 dark:border-gray-800 ${blocoDaEtapa("pedido")}`}>
                <button
                  type="button"
                  aria-expanded={pedidoAberto}
                  data-secao="pedido"
                  onClick={() => alternarBloco("pedido", pedidoAberto, setPedidoAberto)}
                  className={botaoDoBloco("pedido")}
                >
                  <span>Janela, prioridade e cubagem (opcional)</span>
                  <span aria-hidden className="hidden md:inline text-gray-400">{pedidoAberto ? "−" : "+"}</span>
                  <span aria-hidden className="md:hidden text-gray-400">{pedidoAberto ? "editar ›" : "›"}</span>
                </button>
                {pedidoAberto && (
                  <div data-conteudo-do-bloco="pedido" className={`${etapa === "pedido" ? "grid pt-3 md:pt-0" : "hidden md:grid"} grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2 md:gap-4 px-3 pb-3`}>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-data" className={ROTULO_DO_PEDIDO}>Data da coleta</label>
                      <input id="coleta-data" type="date" value={formData.pickupDate} onChange={(e) => setFormData({...formData, pickupDate: e.target.value})} className={CAMPO_DO_PEDIDO} />
                    </div>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-prioridade" className={ROTULO_DO_PEDIDO}>Prioridade</label>
                      <select id="coleta-prioridade" value={formData.priority} onChange={(e) => setFormData({...formData, priority: e.target.value})} className={CAMPO_DO_PEDIDO}>
                        {PRIORIDADES.map((prioridade) => (
                          <option key={prioridade} value={prioridade}>{PRIORIDADE_LABEL[prioridade]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-de" className={ROTULO_DO_PEDIDO}>Janela: das</label>
                      <input id="coleta-de" type="time" value={formData.pickupFrom} onChange={(e) => setFormData({...formData, pickupFrom: e.target.value})} className={CAMPO_DO_PEDIDO} />
                    </div>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-ate" className={ROTULO_DO_PEDIDO}>até</label>
                      <input id="coleta-ate" type="time" value={formData.pickupTo} onChange={(e) => setFormData({...formData, pickupTo: e.target.value})} className={CAMPO_DO_PEDIDO} />
                    </div>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-cubagem" className={ROTULO_DO_PEDIDO}>Cubagem (m³)</label>
                      <input id="coleta-cubagem" type="number" min="0" step="0.001" value={formData.cubicMeters} onChange={(e) => setFormData({...formData, cubicMeters: e.target.value})} className={CAMPO_DO_PEDIDO} />
                    </div>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0 lg:col-span-3">
                      <label htmlFor="coleta-observacao" className={ROTULO_DO_PEDIDO}>Observação</label>
                      <input id="coleta-observacao" type="text" maxLength={500} value={formData.pickupNotes} onChange={(e) => setFormData({...formData, pickupNotes: e.target.value})} placeholder="Ex.: procurar o João na doca 2" className={CAMPO_DO_PEDIDO} />
                    </div>
                  </div>
                )}
              </div>

              {/* Endereço da entrega: opcional e recolhido. Com ele a ordem das entregas e o mapa usam o ponto do endereço, não o centro da cidade. */}
              <div data-bloco="endereco" className={`rounded-xl border border-gray-100 dark:border-gray-800 ${blocoDaEtapa("endereco")}`}>
                <button
                  type="button"
                  aria-expanded={enderecoAberto}
                  data-secao="endereco"
                  onClick={() => alternarBloco("endereco", enderecoAberto, setEnderecoAberto)}
                  className={botaoDoBloco("endereco")}
                >
                  <span>Endereço da entrega (opcional)</span>
                  <span aria-hidden className="hidden md:inline text-gray-400">{enderecoAberto ? "−" : "+"}</span>
                  <span aria-hidden className="md:hidden text-gray-400">{enderecoAberto ? "editar ›" : "›"}</span>
                </button>
                {enderecoAberto && (
                  <div data-conteudo-do-bloco="endereco" className={`${etapa === "endereco" ? "grid pt-3 md:pt-0" : "hidden md:grid"} grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2 md:gap-4 px-3 pb-3`}>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-rua" className={ROTULO_DO_PEDIDO}>Logradouro</label>
                      <input id="coleta-rua" type="text" maxLength={200} value={formData.deliveryStreet} onChange={(e) => setFormData({...formData, deliveryStreet: e.target.value})} placeholder="Rua das Flores" className={CAMPO_DO_PEDIDO} />
                    </div>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-numero" className={ROTULO_DO_PEDIDO}>Número</label>
                      <input id="coleta-numero" type="text" maxLength={20} value={formData.deliveryNumber} onChange={(e) => setFormData({...formData, deliveryNumber: e.target.value})} className={CAMPO_DO_PEDIDO} />
                    </div>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-bairro" className={ROTULO_DO_PEDIDO}>Bairro</label>
                      <input id="coleta-bairro" type="text" maxLength={100} value={formData.deliveryDistrict} onChange={(e) => setFormData({...formData, deliveryDistrict: e.target.value})} className={CAMPO_DO_PEDIDO} />
                    </div>
                    <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                      <label htmlFor="coleta-cep" className={ROTULO_DO_PEDIDO}>CEP</label>
                      <input id="coleta-cep" type="text" inputMode="numeric" maxLength={9} value={formData.deliveryZip} onChange={(e) => setFormData({...formData, deliveryZip: e.target.value})} placeholder="00000-000" className={CAMPO_DO_PEDIDO} />
                    </div>
                  </div>
                )}
              </div>

              {/* Redespacho e subcontratação: opcional e recolhido. O que cada tipo exige é cobrado na conferência do CT-e. */}
              <div data-bloco="redespacho" className={`rounded-xl border border-gray-100 dark:border-gray-800 ${blocoDaEtapa("redespacho")}`}>
                <button
                  type="button"
                  aria-expanded={redespachoAberto}
                  data-secao="redespacho"
                  onClick={() => alternarBloco("redespacho", redespachoAberto, setRedespachoAberto)}
                  className={botaoDoBloco("redespacho")}
                >
                  <span>Redespacho / subcontratação{formData.serviceType !== "NORMAL" ? `: ${ROTULO_DO_SERVICO[tipoDeServico(formData.serviceType)]}` : " (opcional)"}</span>
                  <span aria-hidden className="hidden md:inline text-gray-400">{redespachoAberto ? "−" : "+"}</span>
                  <span aria-hidden className="md:hidden text-gray-400">{redespachoAberto ? "editar ›" : "›"}</span>
                </button>
                {redespachoAberto && (
                  <div data-conteudo-do-bloco="redespacho" className={`${etapa === "redespacho" ? "pt-3 md:pt-0" : "hidden md:block"} px-3 pb-3 space-y-2`}>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
                      <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                        <label htmlFor="coleta-servico" className={ROTULO_DO_PEDIDO}>Tipo de serviço</label>
                        <select id="coleta-servico" value={formData.serviceType} onChange={(e) => setFormData({...formData, serviceType: tipoDeServico(e.target.value)})} className={CAMPO_DO_PEDIDO}>
                          {TIPOS_DE_SERVICO.map((tipo) => (
                            <option key={tipo} value={tipo}>{ROTULO_DO_SERVICO[tipo]}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-0.5 md:space-y-1.5 min-w-0">
                        <label htmlFor="coleta-cte-anterior" className={ROTULO_DO_PEDIDO}>Chave do CT-e anterior</label>
                        <input id="coleta-cte-anterior" type="text" maxLength={60} value={formData.previousCteKey} onChange={(e) => setFormData({...formData, previousCteKey: e.target.value})} placeholder="44 dígitos" className={`${CAMPO_DO_PEDIDO} text-xs`} />
                      </div>
                    </div>
                    <p data-exigencia className="text-[11px] leading-tight md:text-xs text-gray-500 dark:text-gray-400">
                      {EXIGENCIA_DO_SERVICO[tipoDeServico(formData.serviceType)]} {QUEM_DECIDE_O_SERVICO}
                    </p>

                    {/* No celular, uma parte por vez; no computador, as duas lado a lado. */}
                    <div role="tablist" className="md:hidden grid grid-cols-2 gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
                      {PARTES_DO_REDESPACHO.map(({ prefixo, rotulo }) => (
                        <button
                          key={prefixo}
                          type="button"
                          role="tab"
                          aria-selected={parteAberta === prefixo}
                          data-aba={prefixo}
                          onClick={() => setParteAberta(prefixo)}
                          className={`px-2 py-1 rounded-lg text-xs font-medium ${parteAberta === prefixo ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400"}`}
                        >
                          {rotulo}
                        </button>
                      ))}
                    </div>
                    <div className="md:grid md:grid-cols-2 md:gap-4">
                      {PARTES_DO_REDESPACHO.map(({ prefixo, rotulo, explicacao }) => (
                        <fieldset key={prefixo} data-parte={prefixo} className={`${parteAberta === prefixo ? "" : "hidden"} md:block min-w-0`}>
                          <legend className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                            <span className="hidden md:inline font-medium text-gray-700 dark:text-gray-300">{rotulo}. </span>
                            {explicacao}
                          </legend>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                            {CAMPOS_DA_PARTE.map((campo) => {
                              const nome = `${prefixo}${campo.sufixo}` as const;
                              return (
                                <div key={nome} className="space-y-0.5 min-w-0">
                                  <label htmlFor={`coleta-${nome}`} className={ROTULO_DO_PEDIDO}>{campo.rotulo}</label>
                                  <input
                                    id={`coleta-${nome}`}
                                    type="text"
                                    maxLength={campo.maximo}
                                    value={formData[nome]}
                                    onChange={(e) => setFormData({...formData, [nome]: e.target.value})}
                                    placeholder={"exemplo" in campo ? campo.exemplo : undefined}
                                    className={CAMPO_DO_PEDIDO}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </fieldset>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Motorista Alocado */}
              <div className={`space-y-0.5 md:space-y-1.5 min-w-0 ${foraDaEtapa}`}>
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
            
            {/* Só no celular, dentro de uma etapa: volta ao formulário com o que foi digitado guardado. Salvar é lá. */}
            {etapa && (
              <div className="md:hidden p-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 flex justify-end sticky bottom-0">
                <button type="button" data-concluir-etapa onClick={() => setEtapa(null)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-medium">
                  Concluir
                </button>
              </div>
            )}
            <div className={`${etapa ? "hidden md:flex" : "flex"} p-3 md:p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 justify-end space-x-3 sticky bottom-0`}>
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

/** O que foi pedido para a coleta, numa linha: urgência, janela, cubagem e observação. Sem nada, não aparece. */
function PedidoDaColeta({ coleta }: { coleta: Coleta }) {
  const janela = janelaDaColeta(coleta);
  const urgente = coleta.priority === "URGENT";
  if (!urgente && !janela && coleta.cubicMeters === null && !coleta.pickupNotes) return null;

  return (
    <div data-pedido={coleta.id} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
      {urgente && <span className="px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 font-semibold">Urgente</span>}
      {janela && <span>Coletar {janela}</span>}
      {coleta.cubicMeters !== null && <span>{coleta.cubicMeters.toLocaleString("pt-BR")} m³</span>}
      {coleta.pickupNotes && <span className="italic break-words">{coleta.pickupNotes}</span>}
    </div>
  );
}

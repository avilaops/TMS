import { findServiceArea } from "../data/serviceAreas";

export type VolumeLine = { quantity: string; length: string; width: string; height: string; weight: string };
export type CollectionMode = "new" | "recurring" | "quote" | "city" | "change" | "cancel" | "track" | "document" | "receipt" | "attendant";
export type LocalStatus = "Rascunho" | "Pronto para enviar" | "WhatsApp aberto" | "Marcado pelo cliente como enviado" | "Aguardando retorno" | "Marcado pelo cliente como confirmado" | "Finalizado" | "Cancelado";

export type CollectionDraft = {
  protocol?: string;
  requesterName: string;
  companyName: string;
  taxId: string;
  requesterPhone: string;
  email: string;
  saveProfile: boolean;
  originZip: string;
  originCity: string;
  originState: string;
  originStreet: string;
  originNumber: string;
  originComplement: string;
  originDistrict: string;
  originReference: string;
  originResponsible: string;
  originPhone: string;
  date: string;
  period: string;
  deadlineTime: string;
  driverNotes: string;
  destinationZip: string;
  destinationCity: string;
  destinationState: string;
  destinationStreet: string;
  destinationNumber: string;
  destinationComplement: string;
  destinationDistrict: string;
  destinationReference: string;
  recipient: string;
  recipientPhone: string;
  deliveryNotes: string;
  goodsType: string;
  goodsDescription: string;
  totalVolumes: string;
  totalWeight: string;
  declaredValue: string;
  dimensions: string;
  packaging: string;
  fragile: boolean;
  stackable: boolean;
  helper: boolean;
  specificVehicle: string;
  hasInvoice: boolean;
  invoiceCount: string;
  invoiceKey: string;
  goodsNotes: string;
  volumes: VolumeLine[];
  serviceType: string;
  vehicle: string;
  documents: string[];
  reviewed: boolean;
  aware: boolean;
  consent: boolean;
};

export type SavedCollection = {
  protocol: string;
  createdAt: string;
  originCity: string;
  destinationCity: string;
  totalVolumes: string;
  status: LocalStatus;
  message: string;
  lastContact: string;
  draft: CollectionDraft;
};

const draftKey = "mello-central-draft";
const historyKey = "mello-collection-history";
const profileKey = "mello-requester-profile";

export const emptyDraft: CollectionDraft = {
  requesterName: "", companyName: "", taxId: "", requesterPhone: "", email: "", saveProfile: false,
  originZip: "", originCity: "", originState: "SP", originStreet: "", originNumber: "", originComplement: "", originDistrict: "", originReference: "", originResponsible: "", originPhone: "", date: "", period: "", deadlineTime: "", driverNotes: "",
  destinationZip: "", destinationCity: "", destinationState: "SP", destinationStreet: "", destinationNumber: "", destinationComplement: "", destinationDistrict: "", destinationReference: "", recipient: "", recipientPhone: "", deliveryNotes: "",
  goodsType: "", goodsDescription: "", totalVolumes: "", totalWeight: "", declaredValue: "", dimensions: "", packaging: "", fragile: false, stackable: false, helper: false, specificVehicle: "", hasInvoice: false, invoiceCount: "", invoiceKey: "", goodsNotes: "",
  volumes: [{ quantity: "", length: "", width: "", height: "", weight: "" }],
  serviceType: "Coleta normal", vehicle: "Veículo a confirmar", documents: [], reviewed: false, aware: false, consent: false,
};

function clean(value: string | undefined) {
  return value?.trim() || "";
}

function line(label: string, value: string | number | boolean | undefined) {
  if (value === undefined || value === "" || value === false) return "";
  return `${label}: ${value === true ? "Sim" : value}`;
}

function section(title: string, lines: string[]) {
  const filled = lines.filter(Boolean);
  return filled.length ? `${title}\n${filled.join("\n")}` : "";
}

export function generateProtocol(date = new Date()) {
  const stamp = date.toISOString().replace(/\D/g, "");
  const day = stamp.slice(0, 8);
  const time = stamp.slice(8, 12);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MEL-${day}-${time}-${suffix}`;
}

export function formatCep(value: string) {
  return value.replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
}

export function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").replace(/-$/, "");
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").replace(/-$/, "");
}

export function formatTaxId(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, "$1.$2.$3-$4").replace(/[-.]$/, "");
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, "$1.$2.$3/$4-$5").replace(/[-/.]$/, "");
}

export function calculateTotals(volumes: VolumeLine[]) {
  const quantity = volumes.reduce((sum, item) => sum + (Number(item.quantity.replace(",", ".")) || 0), 0);
  const weight = volumes.reduce((sum, item) => sum + (Number(item.weight.replace(",", ".")) || 0), 0);
  const cubic = volumes.reduce((sum, item) => {
    const q = Number(item.quantity.replace(",", ".")) || 1;
    const l = Number(item.length.replace(",", ".")) || 0;
    const w = Number(item.width.replace(",", ".")) || 0;
    const h = Number(item.height.replace(",", ".")) || 0;
    return sum + q * l * w * h;
  }, 0);
  return { quantity, weight, cubic };
}

export function buildCollectionMessage(draft: CollectionDraft) {
  const protocol = draft.protocol || generateProtocol();
  const route = findServiceArea(draft.destinationCity);
  const totals = calculateTotals(draft.volumes);
  const cubage = totals.cubic > 0 ? `${totals.cubic.toFixed(3).replace(".", ",")} m³` : "";
  const message = [
    "🚚 *NOVA SOLICITAÇÃO DE COLETA*",
    `Protocolo: ${protocol}`,
    "",
    section("👤 *SOLICITANTE*", [
      line("Nome", draft.requesterName), line("Empresa", draft.companyName), line("CNPJ/CPF", draft.taxId), line("WhatsApp", draft.requesterPhone), line("E-mail", draft.email),
    ]),
    section("📍 *LOCAL DA COLETA*", [
      line("Endereço", [draft.originStreet, draft.originNumber, draft.originComplement, draft.originDistrict].filter(Boolean).join(", ")),
      line("Cidade/UF", [draft.originCity, draft.originState].filter(Boolean).join("/")),
      line("CEP", draft.originZip), line("Referência", draft.originReference), line("Responsável", draft.originResponsible), line("Telefone", draft.originPhone),
      line("Data desejada", draft.date), line("Período", draft.period), line("Horário limite", draft.deadlineTime), line("Observações para motorista", draft.driverNotes),
    ]),
    section("🏁 *DESTINO*", [
      line("Endereço", [draft.destinationStreet, draft.destinationNumber, draft.destinationComplement, draft.destinationDistrict].filter(Boolean).join(", ")),
      line("Cidade/UF", [draft.destinationCity, draft.destinationState].filter(Boolean).join("/")),
      line("CEP", draft.destinationZip), line("Destinatário", draft.recipient), line("Telefone", draft.recipientPhone), line("Referência", draft.destinationReference), line("Observações de entrega", draft.deliveryNotes),
      route ? line("Rota cadastrada", `${route.hub} · ${route.deadline}`) : line("Rota cadastrada", "A confirmar pela equipe"),
    ]),
    section("📦 *MERCADORIA*", [
      line("Tipo", draft.goodsType), line("Descrição", draft.goodsDescription), line("Volumes", draft.totalVolumes || totals.quantity || ""), line("Peso aproximado", draft.totalWeight || (totals.weight ? `${totals.weight} kg` : "")),
      line("Cubagem estimada", cubage), line("Valor declarado", draft.declaredValue), line("Dimensões gerais", draft.dimensions), line("Embalagem", draft.packaging), line("Frágil", draft.fragile), line("Empilhável", draft.stackable), line("Observações", draft.goodsNotes),
    ]),
    section("🚛 *OPERAÇÃO*", [
      line("Serviço solicitado", draft.serviceType), line("Veículo sugerido", draft.vehicle), line("Necessita ajudante", draft.helper), line("Disponibilidade", "A escolha será analisada e confirmada pela equipe da Mello Transportes."),
    ]),
    section("🧾 *DOCUMENTOS*", [
      line("Possui nota fiscal", draft.hasInvoice), line("Quantidade de notas", draft.invoiceCount), line("Chave da nota", draft.invoiceKey), line("Documentos que serão anexados", draft.documents.join(", ")),
    ]),
    "Solicitação preenchida pelo site da Mello Transportes.",
    "Aguardo a confirmação de disponibilidade, prazo e valor.",
  ].filter(Boolean).join("\n\n");
  return { protocol, message };
}

export function buildActionMessage(mode: CollectionMode, values: Record<string, string>) {
  if (mode === "change") return ["✏️ *SOLICITAÇÃO DE ALTERAÇÃO*", line("Protocolo", values.protocol), "", "Gostaria de solicitar a seguinte alteração:", line("Campo", values.field), line("Informação anterior", values.previous), line("Nova informação", values.next), line("Motivo/observação", values.note), "", "Aguardo a confirmação da equipe."].filter(Boolean).join("\n");
  if (mode === "cancel") return ["❌ *SOLICITAÇÃO DE CANCELAMENTO*", line("Protocolo", values.protocol), line("Solicitante", values.name), line("Empresa", values.company), line("Motivo", values.reason), "", "Solicito o cancelamento desta coleta e aguardo a confirmação da equipe."].filter(Boolean).join("\n");
  if (mode === "track") return ["🔎 *CONSULTA DE COLETA*", line("Protocolo", values.protocol), line("Empresa", values.company), line("Origem", values.origin), line("Destino", values.destination), "", "Gostaria de verificar:", clean(values.question)].filter(Boolean).join("\n");
  if (mode === "receipt") return ["📄 *SOLICITAÇÃO DE COMPROVANTE*", line("Protocolo ou número do documento", values.identifier), line("Empresa", values.company), line("Destinatário", values.recipient), line("Cidade", values.city), line("Observação", values.note), "", "Gostaria de solicitar o comprovante de entrega referente a essa operação."].filter(Boolean).join("\n");
  if (mode === "document") return ["📎 *ENVIO DE DOCUMENTOS*", line("Protocolo", values.protocol), line("Empresa", values.company), line("Tipo", values.documentType), line("Nota fiscal", values.invoice), line("Quantidade de arquivos", values.files), line("Observação", values.note), "", "Vou anexar os documentos nesta conversa."].filter(Boolean).join("\n");
  if (mode === "quote") return ["💬 *COTAÇÃO DE FRETE*", line("Origem", values.origin), line("Destino", values.destination), line("Volumes", values.volumes), line("Peso aproximado", values.weight), line("Mercadoria", values.goods), line("WhatsApp", values.phone), "", "Aguardo confirmação de preço, prazo e disponibilidade pela equipe."].filter(Boolean).join("\n");
  if (mode === "city") return `Olá! Gostaria de confirmar se a Mello Transportes atende a cidade de ${values.city || "minha cidade"}.`;
  return "Olá! Gostaria de falar diretamente com o atendimento da Mello Transportes.";
}

export class LocalCollectionService {
  getDraft() { return JSON.parse(localStorage.getItem(draftKey) || "null") as CollectionDraft | null; }
  saveDraft(draft: CollectionDraft) { localStorage.setItem(draftKey, JSON.stringify(draft)); }
  clearDraft() { localStorage.removeItem(draftKey); }
  getProfile() { return JSON.parse(localStorage.getItem(profileKey) || "null") as Partial<CollectionDraft> | null; }
  saveProfile(draft: CollectionDraft) { localStorage.setItem(profileKey, JSON.stringify({ requesterName: draft.requesterName, companyName: draft.companyName, taxId: draft.taxId, requesterPhone: draft.requesterPhone, email: draft.email })); }
  clearLocalData() { localStorage.removeItem(draftKey); localStorage.removeItem(profileKey); localStorage.removeItem(historyKey); }
  getHistory() { return JSON.parse(localStorage.getItem(historyKey) || "[]") as SavedCollection[]; }
  saveHistory(item: SavedCollection) { localStorage.setItem(historyKey, JSON.stringify([item, ...this.getHistory().filter((saved) => saved.protocol !== item.protocol)].slice(0, 30))); }
  deleteHistory(protocol: string) { localStorage.setItem(historyKey, JSON.stringify(this.getHistory().filter((item) => item.protocol !== protocol))); }
  updateStatus(protocol: string, status: LocalStatus) { localStorage.setItem(historyKey, JSON.stringify(this.getHistory().map((item) => item.protocol === protocol ? { ...item, status, lastContact: new Date().toISOString() } : item))); }
}

export const collectionService = new LocalCollectionService();

// Future API integration: implement the same public methods in an ApiCollectionService
// and swap this export after the backend/Odoo/WhatsApp Business API contract exists.

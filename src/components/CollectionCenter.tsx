import { ArrowLeft, CheckCircle2, ClipboardList, Copy, FileText, History, MapPin, MessageCircle, PackageCheck, PenLine, Repeat2, Search, Send, Trash2, Truck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fleet } from "../data/fleet";
import { findServiceArea } from "../data/serviceAreas";
import { whatsappUrl } from "../lib/whatsapp";
import { buildActionMessage, buildCollectionMessage, calculateTotals, collectionService, emptyDraft, formatCep, formatPhone, formatTaxId, type CollectionDraft, type CollectionMode, type LocalStatus, type SavedCollection } from "../services/collectionService";

const modes: Array<{ id: CollectionMode; title: string; icon: typeof Truck; description: string }> = [
  { id: "new", title: "Nova coleta", icon: Truck, description: "Preencher solicitação completa." },
  { id: "recurring", title: "Coleta recorrente", icon: Repeat2, description: "Repetir um pedido salvo." },
  { id: "quote", title: "Cotação de frete", icon: ClipboardList, description: "Organizar dados para orçamento." },
  { id: "city", title: "Consultar cidade", icon: Search, description: "Confirmar atendimento." },
  { id: "change", title: "Alterar solicitação", icon: PenLine, description: "Pedir ajuste pelo protocolo." },
  { id: "cancel", title: "Cancelar solicitação", icon: XCircle, description: "Solicitar cancelamento humano." },
  { id: "track", title: "Acompanhar coleta", icon: MapPin, description: "Pedir atualização." },
  { id: "document", title: "Enviar documento", icon: FileText, description: "Avisar anexos no WhatsApp." },
  { id: "receipt", title: "Pedir comprovante", icon: PackageCheck, description: "Solicitar comprovante de entrega." },
  { id: "attendant", title: "Falar com atendente", icon: MessageCircle, description: "Abrir atendimento direto." },
];

const periods = ["Manhã", "Tarde", "Comercial", "A combinar"];
const services = ["Coleta normal", "Coleta com urgência", "Entrega programada", "Distribuição", "Retorno de mercadoria", "Serviço a confirmar"];
const documents = ["Nota fiscal", "DANFE", "Declaração de conteúdo", "Foto da mercadoria", "Relação de volumes", "Outro documento"];
const packageTypes = ["Caixa", "Fardo", "Envelope", "Pallet", "Tambor", "Peça avulsa", "Outro"];
const statuses: LocalStatus[] = ["Rascunho", "Pronto para enviar", "WhatsApp aberto", "Marcado pelo cliente como enviado", "Aguardando retorno", "Marcado pelo cliente como confirmado", "Finalizado", "Cancelado"];

function update<K extends keyof CollectionDraft>(draft: CollectionDraft, key: K, value: CollectionDraft[K]) {
  return { ...draft, [key]: value };
}

async function fetchCep(zip: string) {
  const digits = zip.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!response.ok) return null;
  const data = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
  if (data.erro) return null;
  return data;
}

export function CollectionCenter() {
  const [mode, setMode] = useState<CollectionMode>("new");
  const [draft, setDraft] = useState<CollectionDraft>(() => collectionService.getDraft() || emptyDraft);
  const [history, setHistory] = useState<SavedCollection[]>(() => collectionService.getHistory());
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("");
  const [sentHint, setSentHint] = useState("");
  const [simpleValues, setSimpleValues] = useState<Record<string, string>>({});
  const destinationArea = findServiceArea(draft.destinationCity);
  const totals = useMemo(() => calculateTotals(draft.volumes), [draft.volumes]);

  useEffect(() => { collectionService.saveDraft(draft); }, [draft]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(draft) !== JSON.stringify(emptyDraft)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  function setDraftValue<K extends keyof CollectionDraft>(key: K, value: CollectionDraft[K]) {
    setDraft((current) => update(current, key, value));
  }

  async function applyCep(kind: "origin" | "destination") {
    const data = await fetchCep(kind === "origin" ? draft.originZip : draft.destinationZip);
    if (!data) return;
    setDraft((current) => ({
      ...current,
      [`${kind}Street`]: data.logradouro || current[`${kind}Street` as keyof CollectionDraft],
      [`${kind}District`]: data.bairro || current[`${kind}District` as keyof CollectionDraft],
      [`${kind}City`]: data.localidade || current[`${kind}City` as keyof CollectionDraft],
      [`${kind}State`]: data.uf || current[`${kind}State` as keyof CollectionDraft],
    }));
  }

  async function finishCollection() {
    if (!draft.requesterName || !draft.requesterPhone || !draft.originCity || !draft.destinationCity || !draft.goodsType || !draft.reviewed || !draft.aware || !draft.consent) {
      setSentHint("Revise os campos obrigatórios e as confirmações antes de abrir o WhatsApp.");
      return;
    }
    const built = buildCollectionMessage(draft);
    const finalDraft = { ...draft, protocol: built.protocol };
    const item: SavedCollection = { protocol: built.protocol, createdAt: new Date().toISOString(), originCity: draft.originCity, destinationCity: draft.destinationCity, totalVolumes: draft.totalVolumes || String(totals.quantity || ""), status: "WhatsApp aberto", message: built.message, lastContact: new Date().toISOString(), draft: finalDraft };
    if (draft.saveProfile) collectionService.saveProfile(finalDraft);
    collectionService.saveDraft(finalDraft);
    collectionService.saveHistory(item);
    
    try {
      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: draft.requesterName,
          email: draft.requesterName + "@mello.example.com", // Fallback if no email
          phone: draft.requesterPhone,
          origin: draft.originCity,
          destination: draft.destinationCity,
          volumes: draft.totalVolumes || "1",
          weight: "100", // Fallback
          message: built.message
        })
      });
    } catch (e) {
      console.error("Failed to send lead to CRM", e);
    }

    setDraft(finalDraft);
    setMessage(built.message);
    setHistory(collectionService.getHistory());
    setSentHint("WhatsApp aberto. A solicitação só será enviada depois que você tocar em Enviar na conversa.");
    window.open(whatsappUrl(built.message), "_blank", "noopener,noreferrer");
  }

  function useSavedProfile() {
    const profile = collectionService.getProfile();
    if (profile) setDraft((current) => ({ ...current, ...profile }));
  }

  function repeatOrder(order: SavedCollection) {
    setDraft({ ...order.draft, protocol: undefined, date: "", reviewed: false, aware: false, consent: false });
    setMode("new");
    setStep(1);
  }

  function sendSimple() {
    const built = buildActionMessage(mode, simpleValues);
    setMessage(built);
    setSentHint(mode === "document" ? "Depois de abrir o WhatsApp, anexe os documentos e fotos nesta mesma conversa." : "WhatsApp aberto. Aguarde a confirmação humana da equipe.");
    window.open(whatsappUrl(built), "_blank", "noopener,noreferrer");
  }

  const completion = Math.round(((step + 1) / 8) * 100);

  return <section className="central-page"><div className="central-head"><p className="eyebrow"><Truck size={16} /> Central de Coletas</p><h1>Painel de pedidos via WhatsApp.</h1><p>Preencha sem cadastro, revise os dados e envie uma mensagem organizada para a equipe da Mello. O rascunho e o histórico ficam neste aparelho; a solicitação enviada é registrada no sistema da Mello.</p></div><div className="mode-grid">{modes.map((item) => <button key={item.id} className={mode === item.id ? "mode-card active" : "mode-card"} onClick={() => { setMode(item.id); setMessage(""); }}><item.icon /><strong>{item.title}</strong><span>{item.description}</span></button>)}</div>{mode === "new" && <div className="central-layout"><div className="central-form"><div className="progress"><span style={{ width: `${completion}%` }} /><b>{completion}%</b></div><StepNav step={step} setStep={setStep} />{step === 0 && <Panel title="Identificação"><div className="grid">{Text("Nome do solicitante", draft.requesterName, (v) => setDraftValue("requesterName", v))}{Text("Empresa", draft.companyName, (v) => setDraftValue("companyName", v))}{Text("CNPJ ou CPF opcional", draft.taxId, (v) => setDraftValue("taxId", formatTaxId(v)))}{Text("Telefone/WhatsApp", draft.requesterPhone, (v) => setDraftValue("requesterPhone", formatPhone(v)), "tel")}{Text("E-mail opcional", draft.email, (v) => setDraftValue("email", v), "email")}<label><input type="checkbox" checked={draft.saveProfile} onChange={(e) => setDraftValue("saveProfile", e.target.checked)} /> Salvar meus dados neste dispositivo</label></div><button className="btn ghost" type="button" onClick={useSavedProfile}>Usar meus dados salvos</button><p className="privacy-note">Privacidade: o rascunho fica salvo neste aparelho. Ao confirmar o envio, a solicitação também é registrada no sistema comercial da Mello Transportes para o atendimento do pedido.</p></Panel>}{step === 1 && <AddressStep title="Local da coleta" kind="origin" draft={draft} setDraftValue={setDraftValue} applyCep={applyCep} />}{step === 2 && <AddressStep title="Destino" kind="destination" draft={draft} setDraftValue={setDraftValue} applyCep={applyCep} destination />}{step === 3 && <Panel title="Mercadoria"><div className="grid">{Text("Tipo de mercadoria", draft.goodsType, (v) => setDraftValue("goodsType", v))}{Text("Descrição", draft.goodsDescription, (v) => setDraftValue("goodsDescription", v))}{Text("Quantidade de volumes", draft.totalVolumes, (v) => setDraftValue("totalVolumes", v), "number")}{Text("Peso total aproximado", draft.totalWeight, (v) => setDraftValue("totalWeight", v))}{Text("Valor declarado opcional", draft.declaredValue, (v) => setDraftValue("declaredValue", v))}<Select label="Tipo de embalagem" value={draft.packaging} options={packageTypes} onChange={(v) => setDraftValue("packaging", v)} />{Text("Dimensões opcionais", draft.dimensions, (v) => setDraftValue("dimensions", v))}<label><input type="checkbox" checked={draft.fragile} onChange={(e) => setDraftValue("fragile", e.target.checked)} /> Mercadoria frágil</label><label><input type="checkbox" checked={draft.stackable} onChange={(e) => setDraftValue("stackable", e.target.checked)} /> Mercadoria empilhável</label><label><input type="checkbox" checked={draft.helper} onChange={(e) => setDraftValue("helper", e.target.checked)} /> Necessita ajudante</label><label><input type="checkbox" checked={draft.hasInvoice} onChange={(e) => setDraftValue("hasInvoice", e.target.checked)} /> Possui nota fiscal</label>{Text("Quantidade de notas fiscais", draft.invoiceCount, (v) => setDraftValue("invoiceCount", v), "number")}{Text("Chave da nota fiscal opcional", draft.invoiceKey, (v) => setDraftValue("invoiceKey", v))}<label className="field wide"><span>Observações</span><textarea value={draft.goodsNotes} onChange={(e) => setDraftValue("goodsNotes", e.target.value)} /></label></div></Panel>}{step === 4 && <Panel title="Volumes e cubagem"><VolumeEditor draft={draft} setDraft={setDraft} /><div className="totals"><span>Volumes: {totals.quantity || 0}</span><span>Peso informado: {totals.weight || 0} kg</span><span>Cubagem estimada: {totals.cubic.toFixed(3).replace(".", ",")} m³</span></div></Panel>}{step === 5 && <Panel title="Veículo e serviço"><div className="grid"><Select label="Serviço solicitado" value={draft.serviceType} options={services} onChange={(v) => setDraftValue("serviceType", v)} /><Select label="Veículo sugerido" value={draft.vehicle} options={["Veículo a confirmar", ...fleet.map((item) => item.name)]} onChange={(v) => setDraftValue("vehicle", v)} />{Text("Necessidade de veículo específico", draft.specificVehicle, (v) => setDraftValue("specificVehicle", v))}</div><p>A escolha será analisada e confirmada pela equipe da Mello Transportes.</p></Panel>}{step === 6 && <Panel title="Documentos"><div className="document-list">{documents.map((doc) => <label key={doc}><input type="checkbox" checked={draft.documents.includes(doc)} onChange={(e) => setDraftValue("documents", e.target.checked ? [...draft.documents, doc] : draft.documents.filter((item) => item !== doc))} /> {doc}</label>)}</div><p>Depois de abrir o WhatsApp, anexe os documentos e as fotos na mesma conversa.</p></Panel>}{step === 7 && <Panel title="Revisão e envio"><MessagePreview message={buildCollectionMessage(draft).message} /><div className="confirm-list"><label><input type="checkbox" checked={draft.reviewed} onChange={(e) => setDraftValue("reviewed", e.target.checked)} /> Revisei os dados da solicitação.</label><label><input type="checkbox" checked={draft.aware} onChange={(e) => setDraftValue("aware", e.target.checked)} /> Estou ciente de que a coleta depende de confirmação da Mello Transportes.</label><label><input type="checkbox" checked={draft.consent} onChange={(e) => setDraftValue("consent", e.target.checked)} /> Autorizo o envio desses dados pelo WhatsApp e o registro da solicitação pela Mello Transportes.</label></div><button className="btn primary" type="button" onClick={finishCollection}><Send size={16} /> Abrir WhatsApp da Mello</button><button className="btn ghost" type="button" onClick={() => window.print()}>Baixar/imprimir resumo</button></Panel>}<div className="mobile-bar"><button className="btn ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}><ArrowLeft size={16} />Voltar</button><button className="btn primary" onClick={() => setStep((s) => Math.min(7, s + 1))}>Continuar</button></div>{sentHint && <p className="success">{sentHint}</p>}</div><aside className="summary-sticky"><h3>Resumo</h3><Summary draft={draft} area={destinationArea?.hub ? `${destinationArea.hub} · ${destinationArea.deadline}` : "Destino a confirmar"} /><button className="btn ghost" onClick={() => { if (confirm("Apagar rascunho deste dispositivo?")) { collectionService.clearDraft(); setDraft(emptyDraft); } }}><Trash2 size={16} />Apagar rascunho</button></aside></div>}{mode !== "new" && <SimpleMode mode={mode} history={history} setSimpleValues={setSimpleValues} simpleValues={simpleValues} sendSimple={sendSimple} repeatOrder={repeatOrder} />}{message && <section className="section"><h2>Prévia da mensagem</h2><MessagePreview message={message} /></section>}<HistoryPanel history={history} setHistory={setHistory} repeatOrder={repeatOrder} /></section>;
}

function StepNav({ step, setStep }: { step: number; setStep: (step: number) => void }) {
  return <div className="steps compact">{["Identificação", "Coleta", "Destino", "Mercadoria", "Volumes", "Serviço", "Documentos", "Revisão"].map((label, index) => <button key={label} className={step === index ? "active" : ""} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="center-panel"><h2>{title}</h2>{children}</div>;
}

function Text(label: string, value: string, onChange: (value: string) => void, type = "text") {
  return <label className="field"><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function AddressStep({ title, kind, draft, setDraftValue, applyCep, destination }: { title: string; kind: "origin" | "destination"; draft: CollectionDraft; setDraftValue: <K extends keyof CollectionDraft>(key: K, value: CollectionDraft[K]) => void; applyCep: (kind: "origin" | "destination") => void; destination?: boolean }) {
  const prefix = kind === "origin" ? "origin" : "destination";
  const area = destination ? findServiceArea(draft.destinationCity) : undefined;
  const field = (suffix: string) => `${prefix}${suffix}` as keyof CollectionDraft;
  return <Panel title={title}><div className="grid">{Text("CEP", String(draft[field("Zip")] || ""), (v) => setDraftValue(field("Zip"), formatCep(v) as never))}<button className="btn ghost cep-btn" type="button" onClick={() => applyCep(kind)}>Buscar CEP</button>{Text("Cidade", String(draft[field("City")] || ""), (v) => setDraftValue(field("City"), v as never))}{Text("Estado", String(draft[field("State")] || ""), (v) => setDraftValue(field("State"), v as never))}{Text("Endereço", String(draft[field("Street")] || ""), (v) => setDraftValue(field("Street"), v as never))}{Text("Número", String(draft[field("Number")] || ""), (v) => setDraftValue(field("Number"), v as never))}{Text("Complemento", String(draft[field("Complement")] || ""), (v) => setDraftValue(field("Complement"), v as never))}{Text("Bairro", String(draft[field("District")] || ""), (v) => setDraftValue(field("District"), v as never))}{Text("Ponto de referência", String(draft[field("Reference")] || ""), (v) => setDraftValue(field("Reference"), v as never))}{destination ? Text("Destinatário", draft.recipient, (v) => setDraftValue("recipient", v)) : Text("Responsável no local", draft.originResponsible, (v) => setDraftValue("originResponsible", v))}{destination ? Text("Telefone do destinatário", draft.recipientPhone, (v) => setDraftValue("recipientPhone", formatPhone(v)), "tel") : Text("Telefone do local", draft.originPhone, (v) => setDraftValue("originPhone", formatPhone(v)), "tel")}{!destination && Text("Data desejada", draft.date, (v) => setDraftValue("date", v), "date")}{!destination && <Select label="Período preferencial" value={draft.period} options={["", ...periods]} onChange={(v) => setDraftValue("period", v)} />}{!destination && Text("Horário limite", draft.deadlineTime, (v) => setDraftValue("deadlineTime", v), "time")}<label className="field wide"><span>{destination ? "Observações de entrega" : "Observações para o motorista"}</span><textarea value={destination ? draft.deliveryNotes : draft.driverNotes} onChange={(event) => setDraftValue(destination ? "deliveryNotes" : "driverNotes", event.target.value)} /></label></div>{destination && <div className={area ? "route-ok" : "route-warn"}>{area ? <><CheckCircle2 /> Cidade atendida: {area.hub} · {area.deadline}</> : "Cidade não encontrada na relação pública. O envio continua e a equipe confirma disponibilidade."}</div>}</Panel>;
}

function VolumeEditor({ draft, setDraft }: { draft: CollectionDraft; setDraft: React.Dispatch<React.SetStateAction<CollectionDraft>> }) {
  return <div className="volume-list">{draft.volumes.map((item, index) => <div className="volume-row" key={index}>{Text("Qtd.", item.quantity, (v) => setDraft((current) => ({ ...current, volumes: current.volumes.map((line, i) => i === index ? { ...line, quantity: v } : line) })), "number")}{Text("Comprimento (m)", item.length, (v) => setDraft((current) => ({ ...current, volumes: current.volumes.map((line, i) => i === index ? { ...line, length: v } : line) })))}{Text("Largura (m)", item.width, (v) => setDraft((current) => ({ ...current, volumes: current.volumes.map((line, i) => i === index ? { ...line, width: v } : line) })))}{Text("Altura (m)", item.height, (v) => setDraft((current) => ({ ...current, volumes: current.volumes.map((line, i) => i === index ? { ...line, height: v } : line) })))}{Text("Peso (kg)", item.weight, (v) => setDraft((current) => ({ ...current, volumes: current.volumes.map((line, i) => i === index ? { ...line, weight: v } : line) })))}<button className="btn ghost" onClick={() => setDraft((current) => ({ ...current, volumes: current.volumes.filter((_, i) => i !== index) }))}>Remover</button></div>)}<button className="btn ghost" onClick={() => setDraft((current) => ({ ...current, volumes: [...current.volumes, { quantity: "", length: "", width: "", height: "", weight: "" }] }))}>Adicionar volume</button></div>;
}

function Summary({ draft, area }: { draft: CollectionDraft; area: string }) {
  return <div className="mini-summary"><p><b>Solicitante:</b> {draft.requesterName || "Não informado"}</p><p><b>Coleta:</b> {draft.originCity || "Origem pendente"}</p><p><b>Destino:</b> {draft.destinationCity || "Destino pendente"}</p><p><b>Rota:</b> {area}</p><p><b>Mercadoria:</b> {draft.goodsType || "Pendente"}</p><p><b>Veículo:</b> {draft.vehicle}</p></div>;
}

function MessagePreview({ message }: { message: string }) {
  return <><pre>{message}</pre><div className="actions"><button className="btn ghost" onClick={() => navigator.clipboard.writeText(message)}><Copy size={16} />Copiar</button><button className="btn ghost" onClick={() => window.print()}>Imprimir resumo</button></div></>;
}

function SimpleMode({ mode, history, simpleValues, setSimpleValues, sendSimple, repeatOrder }: { mode: CollectionMode; history: SavedCollection[]; simpleValues: Record<string, string>; setSimpleValues: (values: Record<string, string>) => void; sendSimple: () => void; repeatOrder: (order: SavedCollection) => void }) {
  if (mode === "recurring") return <section className="section"><h2>Repetir pedido anterior</h2>{history.length === 0 ? <p>Nenhum pedido salvo neste dispositivo ainda.</p> : <div className="history-list">{history.map((item) => <article key={item.protocol}><h3>{item.protocol}</h3><p>{item.originCity} para {item.destinationCity}</p><button className="btn primary" onClick={() => repeatOrder(item)}>Repetir coleta</button></article>)}</div>}</section>;
  const fields: Record<CollectionMode, string[]> = {
    new: [], recurring: [], quote: ["origin", "destination", "volumes", "weight", "goods", "phone"], city: ["city"], change: ["protocol", "field", "previous", "next", "note"], cancel: ["protocol", "name", "company", "reason"], track: ["protocol", "company", "origin", "destination", "question"], document: ["protocol", "company", "documentType", "invoice", "files", "note"], receipt: ["identifier", "company", "recipient", "city", "note"], attendant: [],
  };
  if (mode === "attendant") return <section className="section"><h2>Atendimento direto</h2><p>Abra o WhatsApp para falar com a equipe da Mello Transportes.</p><button className="btn primary" onClick={sendSimple}>Falar com atendente</button></section>;
  return <section className="section"><h2>{modes.find((item) => item.id === mode)?.title}</h2><div className="grid">{fields[mode].map((field) => Text(fieldLabel(field), simpleValues[field] || "", (v) => setSimpleValues({ ...simpleValues, [field]: v })))}</div><button className="btn primary" onClick={sendSimple}><Send size={16} />Abrir WhatsApp</button></section>;
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = { origin: "Origem", destination: "Destino", volumes: "Volumes", weight: "Peso aproximado", goods: "Mercadoria", phone: "WhatsApp", city: "Cidade", protocol: "Protocolo", field: "Campo", previous: "Informação anterior", next: "Nova informação", note: "Observação", name: "Solicitante", company: "Empresa", reason: "Motivo", question: "Pergunta ou atualização desejada", documentType: "Tipo do documento", invoice: "Número da nota", files: "Quantidade de arquivos", identifier: "Protocolo ou número do documento", recipient: "Destinatário" };
  return labels[field] || field;
}

function HistoryPanel({ history, setHistory, repeatOrder }: { history: SavedCollection[]; setHistory: (items: SavedCollection[]) => void; repeatOrder: (order: SavedCollection) => void }) {
  return <section className="section"><p className="eyebrow"><History size={16} /> Meus pedidos neste dispositivo</p><h2>Histórico local</h2><p>Este histórico fica salvo somente neste aparelho e não representa o sistema interno da transportadora.</p>{history.length === 0 ? <p>Nenhum pedido salvo ainda.</p> : <div className="history-list">{history.map((item) => <article key={item.protocol}><h3>{item.protocol}</h3><p>{new Date(item.createdAt).toLocaleString("pt-BR")} · {item.originCity} para {item.destinationCity}</p><select value={item.status} onChange={(event) => { collectionService.updateStatus(item.protocol, event.target.value as LocalStatus); setHistory(collectionService.getHistory()); }}>{statuses.map((status) => <option key={status}>{status}</option>)}</select><div className="actions"><button className="btn ghost" onClick={() => navigator.clipboard.writeText(item.message)}>Copiar</button><a className="btn ghost" href={whatsappUrl(item.message)} target="_blank">Abrir WhatsApp</a><button className="btn ghost" onClick={() => repeatOrder(item)}>Repetir</button><button className="btn ghost" onClick={() => { if (confirm("Excluir este pedido do dispositivo?")) { collectionService.deleteHistory(item.protocol); setHistory(collectionService.getHistory()); } }}>Excluir</button></div></article>)}</div>}<button className="btn ghost" onClick={() => { if (confirm("Limpar todo o histórico local?")) { collectionService.clearLocalData(); setHistory([]); } }}><Trash2 size={16} />Limpar dados locais</button></section>;
}

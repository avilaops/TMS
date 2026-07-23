import React from "react";
import ReactDOM from "react-dom/client";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Clipboard, Copy, Mail, MapPin, Menu, PackageCheck, Phone, Search, Send, ShieldCheck, Truck, X } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CollectionCenter } from "./components/CollectionCenter";
import { company } from "./config/company";
import { faqs } from "./data/faq";
import { fleet } from "./data/fleet";
import { serviceAreas, suggestServiceAreas, findServiceArea, hubs, totalServiceAreas } from "./data/serviceAreas";
import { services } from "./data/services";
import { testimonials } from "./data/testimonials";
import { cityCheckMessage, whatsappUrl } from "./lib/whatsapp";
import "./index.css";

const RouteMap = lazy(() => import("./components/RouteMap").then((module) => ({ default: module.RouteMap })));

const collectionSchema = z.object({
  name: z.string().min(2, "Informe seu nome."),
  companyName: z.string().min(2, "Informe a empresa."),
  phone: z.string().min(8, "Informe um telefone/WhatsApp."),
  email: z.string().email("E-mail inválido.").optional().or(z.literal("")),
  originCity: z.string().min(2, "Informe a cidade de coleta."),
  originAddress: z.string().min(3, "Informe o endereço de coleta."),
  district: z.string().min(2, "Informe o bairro."),
  date: z.string().min(1, "Informe a data."),
  period: z.string().min(2, "Informe o período."),
  destinationCity: z.string().min(2, "Informe a cidade de destino."),
  destinationAddress: z.string().min(3, "Informe o endereço ou referência."),
  recipient: z.string().optional(),
  volumes: z.string().min(1, "Informe a quantidade de volumes."),
  weight: z.string().min(1, "Informe o peso aproximado."),
  goods: z.string().min(2, "Informe a mercadoria."),
  dimensions: z.string().optional(),
  helper: z.boolean().default(false),
  invoice: z.boolean().default(false),
  receipt: z.boolean().default(false),
  notes: z.string().optional(),
  consent: z.boolean().refine(Boolean, "Confirme a política de privacidade."),
});

type CollectionForm = z.infer<typeof collectionSchema>;
const defaultValues: CollectionForm = { name: "", companyName: "", phone: "", email: "", originCity: "", originAddress: "", district: "", date: "", period: "", destinationCity: "", destinationAddress: "", recipient: "", volumes: "", weight: "", goods: "", dimensions: "", helper: false, invoice: false, receipt: false, notes: "", consent: false };

function Logo() {
  return <a className="logo" href="#/" aria-label="Ir para o início"><img src="/Mello/logo-mello.png" alt="" /><span><strong>Mello <b>Transportes</b></strong><small>{company.tagline}</small></span></a>;
}

function Header() {
  const [open, setOpen] = useState(false);
  const links = [["#/", "Início"], ["#/cidades", "Cidades"], ["#/frota", "Frota"], ["#/mercadorias", "Mercadorias"], ["#/duvidas", "Dúvidas"]];
  return <header className="topbar"><Logo /><nav className={open ? "nav open" : "nav"}>{links.map(([href, label]) => <a onClick={() => setOpen(false)} href={href} key={href}>{label}</a>)}<a href={company.phoneHref}><Phone size={16} />{company.phone}</a><a className="btn primary" href="#/coleta"><Send size={16} />Solicitar coleta</a></nav><a className="whats-mini" href="#/coleta">WhatsApp</a><button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Abrir menu">{open ? <X /> : <Menu />}</button></header>;
}

function Hero() {
  return <section id="inicio" className="hero"><div className="hero-copy"><motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="eyebrow"><ShieldCheck size={16} /> Transporte regional em SP</motion.p><h1>Transporte regional com agilidade, segurança e compromisso.</h1><p>Coletas e entregas em Rio Preto e região, com atendimento próximo e rotas planejadas para sua empresa.</p><div className="actions"><a className="btn primary" href="#/coleta">Solicitar coleta <ArrowRight size={16} /></a><a className="btn ghost" href="#/cidades">Consultar cidade</a><a className="phone-link" href={company.phoneHref}><Phone size={16} />{company.phone}</a></div><div className="trust"><span>{totalServiceAreas} cidades cadastradas</span><span>Rotas Até 24h e Até 48h</span><span>Atendimento via WhatsApp</span></div></div><RouteVisual /></section>;
}

function RouteVisual() {
  return <div className="route-card map-card" aria-label="Mapa OpenStreetMap com polos e rotas regionais"><Suspense fallback={<div className="map-fallback">Carregando mapa regional...</div>}><RouteMap /></Suspense><div className="legend map-legend"><span><i className="blue" />Matriz operacional</span><span><i />Polo com rotas 24h</span><span><i className="orange" />Polo com rotas 48h</span></div></div>;
}

function CitySearch() {
  const [query, setQuery] = useState("");
  const result = query ? findServiceArea(query) : undefined;
  const suggestions = suggestServiceAreas(query);
  const message = result ? `Olá! Gostaria de solicitar uma coleta para ${result.city}. Prazo cadastrado: ${result.deadline}.` : cityCheckMessage(query);
  return <section id="cidades" className="section split"><div><p className="eyebrow"><Search size={16} /> Consulta de cidade atendida</p><h2>Digite a cidade e veja a rota cadastrada.</h2><p className="muted">A busca ignora acentos e maiúsculas. Se a cidade não aparecer, o WhatsApp já leva uma mensagem para confirmação pela equipe.</p><label className="field"><span>Cidade</span><input value={query} onChange={(e) => setQuery(e.target.value)} list="city-options" placeholder="Ex: Sao Carlos, Birigui, Mirassol" /></label><datalist id="city-options">{suggestions.map((area) => <option key={area.city} value={area.city} />)}</datalist></div><div className="result-panel">{query.length < 2 ? <p>Comece digitando uma cidade.</p> : result ? <><CheckCircle2 className="ok" /><h3>{result.city} é atendida</h3><p><b>Prazo:</b> {result.deadline}</p><p><b>Polo regional:</b> {result.hub}</p><a className="btn primary" href={whatsappUrl(message)} target="_blank">Confirmar pelo WhatsApp</a></> : <><h3>Cidade não encontrada na relação pública</h3><p>Ainda não encontramos essa cidade na relação pública. Fale com nossa equipe para confirmarmos uma possibilidade de atendimento.</p><a className="btn primary" href={whatsappUrl(message)} target="_blank">Confirmar possibilidade</a></>}</div></section>;
}

function PageHero({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return <section className="page-hero"><p className="eyebrow">{label}</p><h1>{title}</h1><p>{children}</p><div className="actions"><a className="btn primary" href="#/coleta">Solicitar coleta</a><a className="btn ghost" href={whatsappUrl("Olá! Gostaria de confirmar informações pelo site da Mello Transportes.")} target="_blank">Falar no WhatsApp</a></div></section>;
}

function FleetPage() {
  return <><PageHero label="Frota e veículos" title="Veículos para rotas regionais, coletas e entregas.">A frota abaixo preserva os tipos confirmados nos arquivos do projeto. A disponibilidade de cada veículo depende da operação do dia e será sempre confirmada pela equipe comercial.</PageHero><section className="section"><div className="vehicle-grid">{fleet.map((vehicle) => <article className="vehicle-card" key={vehicle.name}><div className="vehicle-art"><Truck /></div><div><p className="eyebrow">Frota disponível</p><h2>{vehicle.name}</h2><p>{vehicle.description}</p><div className="info-list"><span>Uso indicado: coletas, entregas regionais e distribuição conforme análise operacional.</span><span>Disponibilidade: confirmada pela equipe da Mello Transportes.</span></div><a className="btn primary" href={whatsappUrl(`Olá! Gostaria de solicitar uma coleta. Se possível, gostaria de avaliar o uso de ${vehicle.name}. Pode confirmar disponibilidade?`)} target="_blank">Consultar disponibilidade</a></div></article>)}</div></section><section className="section split"><div><h2>Como escolher o veículo</h2><p>Informe volumes, peso aproximado, tipo de mercadoria, origem, destino e data desejada. A equipe confirma o veículo adequado conforme rota, cubagem e operação do dia.</p></div><div className="result-panel"><h3>Dados que ajudam na confirmação</h3><p>Quantidade de volumes, dimensões, peso, endereço com bairro, necessidade de ajudante, nota fiscal e observações de acesso.</p></div></section></>;
}

function CitiesPage() {
  const grouped = hubs.map((hub) => ({ hub, areas: serviceAreas.filter((area) => area.hub === hub) }));
  return <><PageHero label="Cidades atendidas" title={`${totalServiceAreas} cidades cadastradas por polo regional.`}>Consulte por cidade, veja o prazo estimado e confira a lista completa por polo. A busca funciona com ou sem acentos.</PageHero><CitySearch /><section className="section"><h2>Lista completa por polo</h2><div className="city-columns">{grouped.map(({ hub, areas }) => <article key={hub}><h3>{hub}</h3><p>{areas.length} cidades</p><ul>{areas.map((area) => <li key={area.city}><span>{area.city}</span><small>{area.deadline}</small></li>)}</ul></article>)}</div></section></>;
}

function CargoPage() {
  const cargoTips = [
    ["Identifique volumes", "Informe quantidade, peso aproximado e, quando possível, dimensões. Isso ajuda a validar cubagem e veículo."],
    ["Proteja a mercadoria", "Use embalagem firme, fechamento seguro e proteção interna compatível com o item transportado."],
    ["Informe restrições", "Avise se há fragilidade, necessidade de ajudante, comprovante, retorno ou condição especial no endereço."],
    ["Nota fiscal", "As regras existentes citam operações com nota fiscal e limite de tabela. Confirme detalhes com o comercial."],
  ];
  return <><PageHero label="Mercadoria e embalagem" title="Prepare a carga com dados claros para agilizar a coleta.">Esta página reúne orientações operacionais seguras sem inventar regras comerciais. Para itens específicos, valor de NF, fragilidade ou restrição de transporte, confirme pelo WhatsApp.</PageHero><section className="section"><div className="cards">{cargoTips.map(([title, description]) => <article key={title}><PackageCheck /><h3>{title}</h3><p>{description}</p></article>)}</div></section><section className="section split"><div><h2>Checklist antes da coleta</h2><div className="checklist">{["Volumes contados e identificados", "Peso aproximado informado", "Endereço e bairro conferidos", "Destinatário ou referência de entrega informados", "Observações de acesso adicionadas", "Nota fiscal ou necessidade de confirmação comercial sinalizada"].map((item) => <p key={item}><CheckCircle2 />{item}</p>)}</div></div><div className="result-panel"><h3>Solicitar orientação</h3><p>Se a mercadoria exige cuidado especial, envie os detalhes para a equipe antes da coleta.</p><a className="btn primary" href={whatsappUrl("Olá! Gostaria de orientação sobre embalagem e transporte de uma mercadoria pela Mello Transportes.")} target="_blank">Falar sobre mercadoria</a></div></section><QuoteForm /></>;
}

function FleetAndRoutes() {
  return <><section className="section" id="rotas"><p className="eyebrow"><MapPin size={16} /> Rotas e polos</p><h2>Polos regionais com lista acessível e mapa leve.</h2><div className="hubs">{hubs.map((hub) => <article key={hub}><h3>{hub}</h3><p>{serviceAreas.filter((a) => a.hub === hub).length} cidades</p><small>{serviceAreas.filter((a) => a.hub === hub).slice(0, 5).map((a) => a.city).join(", ")}</small></article>)}</div></section><section className="section" id="frota"><p className="eyebrow"><Truck size={16} /> Frota</p><h2>Veículos disponíveis para análise operacional.</h2><div className="cards">{fleet.map((item) => <article key={item.name}><Truck /><h3>{item.name}</h3><p>{item.description}</p><small>Uso e disponibilidade confirmados pela equipe conforme coleta, volumes e rota.</small><a href={whatsappUrl(`Olá! Gostaria de solicitar uma coleta e confirmar o veículo adequado com a equipe da Mello Transportes.`)}>Confirmar veículo adequado</a></article>)}</div></section></>;
}

function Services() {
  return <section id="servicos" className="section"><p className="eyebrow"><Clipboard size={16} /> Serviços</p><h2>Soluções comerciais baseadas nos dados disponíveis.</h2><div className="cards">{services.map((s) => <article key={s.title}><h3>{s.title}</h3><p>{s.description}</p><small>{s.benefit}</small><a href="#/coleta">Solicitar agora</a></article>)}</div></section>;
}

function CollectionForm() {
  const saved = localStorage.getItem("mello-collection-draft");
  const form = useForm<CollectionForm>({ defaultValues: saved ? { ...defaultValues, ...JSON.parse(saved) } : defaultValues });
  const [step, setStep] = useState(0);
  const [sent, setSent] = useState(false);
  useEffect(() => { const sub = form.watch((value) => localStorage.setItem("mello-collection-draft", JSON.stringify(value))); return () => sub.unsubscribe(); }, [form]);
  const data = form.watch();
  const message = `Olá! Gostaria de solicitar uma coleta pela Mello Transportes.\n\nSOLICITANTE\nNome: ${data.name}\nEmpresa: ${data.companyName}\nTelefone: ${data.phone}\nE-mail: ${data.email || "Não informado"}\n\nCOLETA\nCidade: ${data.originCity}\nEndereço: ${data.originAddress}\nBairro: ${data.district}\nData: ${data.date}\nPeríodo: ${data.period}\n\nDESTINO\nCidade: ${data.destinationCity}\nEndereço/Referência: ${data.destinationAddress}\nDestinatário: ${data.recipient || "Não informado"}\n\nCARGA\nVolumes: ${data.volumes}\nPeso aproximado: ${data.weight}\nMercadoria: ${data.goods}\nDimensões: ${data.dimensions || "Não informado"}\nAjudante: ${data.helper ? "Sim" : "Não"}\nNota fiscal: ${data.invoice ? "Sim" : "Não informado"}\nComprovante/retorno: ${data.receipt ? "Sim" : "Não"}\nObservações: ${data.notes || "Sem observações"}\n\nSolicitação enviada pelo site da Mello Transportes.`;
  const steps = [["Solicitante", ["name", "companyName", "phone", "email"]], ["Coleta", ["originCity", "originAddress", "district", "date", "period"]], ["Destino", ["destinationCity", "destinationAddress", "recipient"]], ["Carga", ["volumes", "weight", "goods", "dimensions"]], ["Confirmação", []]] as const;
  async function next() { const ok = await form.trigger(steps[step][1] as unknown as Array<keyof CollectionForm>); if (ok) setStep((current) => Math.min(current + 1, steps.length - 1)); }
  function onSubmit(values: CollectionForm) { const parsed = collectionSchema.safeParse(values); if (!parsed.success) return; setSent(true); window.open(whatsappUrl(message), "_blank", "noopener,noreferrer"); }
  const input = (name: keyof CollectionForm, label: string, type = "text") => <label className="field"><span>{label}</span><input type={type} {...form.register(name)} />{form.formState.errors[name]?.message && <em>{String(form.formState.errors[name]?.message)}</em>}</label>;
  return <section id="coleta" className="section form-section"><p className="eyebrow"><Send size={16} /> Solicitação de coleta</p><h2>Preencha em etapas e envie tudo organizado pelo WhatsApp.</h2><div className="steps">{steps.map(([label], i) => <button className={i === step ? "active" : ""} key={label} onClick={() => setStep(i)}>{i + 1}. {label}</button>)}</div><form onSubmit={form.handleSubmit(onSubmit)}>{step === 0 && <div className="grid">{input("name", "Nome")}{input("companyName", "Empresa")}{input("phone", "Telefone/WhatsApp")}{input("email", "E-mail opcional", "email")}</div>}{step === 1 && <div className="grid">{input("originCity", "Cidade de coleta")}{input("originAddress", "Endereço")}{input("district", "Bairro")}{input("date", "Data desejada", "date")}{input("period", "Horário ou período")}</div>}{step === 2 && <div className="grid">{input("destinationCity", "Cidade de destino")}{input("destinationAddress", "Endereço ou referência")}{input("recipient", "Destinatário, se necessário")}</div>}{step === 3 && <div className="grid">{input("volumes", "Quantidade de volumes")}{input("weight", "Peso aproximado")}{input("goods", "Tipo de mercadoria")}{input("dimensions", "Dimensões opcionais")}<label><input type="checkbox" {...form.register("helper")} /> Necessidade de ajudante</label><label><input type="checkbox" {...form.register("invoice")} /> Informar nota fiscal</label><label><input type="checkbox" {...form.register("receipt")} /> Solicitar retorno ou comprovante</label><label className="field wide"><span>Observações</span><textarea {...form.register("notes")} /></label></div>}{step === 4 && <div className="summary"><pre>{message}</pre><label><input type="checkbox" {...form.register("consent")} /> Confirmo que os dados serão enviados pelo WhatsApp para atendimento operacional.</label>{form.formState.errors.consent?.message && <em>{form.formState.errors.consent.message}</em>}<button type="button" className="btn ghost" onClick={() => navigator.clipboard.writeText(message)}><Copy size={16} />Copiar solicitação</button></div>}<div className="form-actions">{step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Voltar</button>}{step < 4 ? <button type="button" className="btn primary" onClick={next}>Continuar</button> : <button className="btn primary" type="submit">Enviar pelo WhatsApp</button>}</div>{sent && <p className="success">Solicitação pronta. O WhatsApp foi aberto e seu rascunho segue salvo neste navegador.</p>}</form></section>;
}

function QuoteForm() {
  const [quote, setQuote] = useState({ origin: "", destination: "", volumes: "", weight: "", goods: "", phone: "" });
  const area = useMemo(() => findServiceArea(quote.destination), [quote.destination]);
  const message = `Olá! Gostaria de uma cotação pela Mello Transportes.\nOrigem: ${quote.origin}\nDestino: ${quote.destination}\nVolumes: ${quote.volumes}\nPeso aproximado: ${quote.weight}\nMercadoria: ${quote.goods}\nWhatsApp do cliente: ${quote.phone}\nPrazo cadastrado: ${area?.deadline || "A confirmar"}\nPreço e disponibilidade serão confirmados pela equipe.`;
  return <section className="section split"><div><p className="eyebrow">Cotação rápida</p><h2>Peça orçamento sem cálculo fictício.</h2><p className="muted">O site organiza as informações e a equipe confirma preço, disponibilidade e detalhes operacionais.</p></div><div className="quote grid">{Object.entries({ origin: "Cidade de origem", destination: "Cidade de destino", volumes: "Volumes", weight: "Peso aproximado", goods: "Mercadoria", phone: "WhatsApp do cliente" }).map(([key, label]) => <label className="field" key={key}><span>{label}</span><input value={quote[key as keyof typeof quote]} onChange={(e) => setQuote({ ...quote, [key]: e.target.value })} /></label>)}<a className="btn primary wide" href={whatsappUrl(message)} target="_blank">Enviar pedido de orçamento</a></div></section>;
}

function Footer() {
  return <footer><Logo /><p>{company.serviceRegion}</p><p><Phone size={16} /> {company.phone} · {company.whatsapp}</p><p><Mail size={16} /> {company.email}</p><p>{company.address}</p><small>© {new Date().getFullYear()} {company.shortName}. Política de privacidade: os dados preenchidos são usados apenas para montar a mensagem enviada pelo usuário no WhatsApp.</small></footer>;
}

function useRoute() {
  const [route, setRoute] = useState(window.location.hash.replace("#", "") || "/");
  useEffect(() => { const update = () => setRoute(window.location.hash.replace("#", "") || "/"); window.addEventListener("hashchange", update); return () => window.removeEventListener("hashchange", update); }, []);
  return route;
}

function HomePage() {
  return <><Hero /><Services /><CitySearch /><FleetAndRoutes /><QuoteForm /><CollectionForm /><section className="section timeline"><h2>Como funciona</h2>{["Informe a coleta.", "A equipe confirma a disponibilidade.", "A mercadoria é coletada.", "A entrega segue pela rota programada.", "O cliente recebe a confirmação."].map((item) => <p key={item}><CheckCircle2 />{item}</p>)}</section>{testimonials.length > 0 && <section className="section"><h2>Depoimentos</h2></section>}<FaqSection /><FinalCta /></>;
}

function FaqSection() {
  return <section id="duvidas" className="section"><h2>Dúvidas frequentes</h2><div className="faq">{faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></section>;
}

function FinalCta() {
  return <section className="final-cta"><h2>Precisa de uma coleta ou quer confirmar sua rota?</h2><a className="btn primary" href="#/coleta">Solicitar coleta</a><a className="btn ghost" href={whatsappUrl("Olá! Gostaria de falar com a Mello Transportes.")} target="_blank">Falar no WhatsApp</a><a className="btn ghost" href="#/cidades">Consultar cidade</a></section>;
}

function FloatingWhatsApp() {
  const [open, setOpen] = useState(false);
  const hasDraft = Boolean(localStorage.getItem("mello-central-draft"));
  const items = [[hasDraft ? "#/coleta" : "#/coleta", hasDraft ? "Continuar minha solicitação" : "Solicitar coleta"], ["#/coleta", "Pedir cotação"], ["#/cidades", "Consultar cidade"], ["#/coleta", "Acompanhar coleta"], ["#/coleta", "Enviar documentos"], [whatsappUrl("Olá! Gostaria de falar com o atendimento da Mello Transportes."), "Falar com atendente"]];
  return <div className="floating-whatsapp"><button className="btn primary" onClick={() => setOpen(!open)}><Send size={16} />WhatsApp</button>{open && <div className="float-menu">{items.map(([href, label]) => <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined}>{label}</a>)}</div>}</div>;
}

function App() {
  const route = useRoute();
  const content = route === "/frota" ? <FleetPage /> : route === "/cidades" ? <CitiesPage /> : route === "/mercadorias" ? <CargoPage /> : route === "/coleta" ? <CollectionCenter /> : route === "/duvidas" ? <FaqSection /> : <HomePage />;
  return <><Header /><main>{content}</main><FloatingWhatsApp /><Footer /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "LocalBusiness", name: company.name, telephone: company.phone, email: company.email, address: company.address, areaServed: company.serviceRegion, url: company.pagesUrl, makesOffer: services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.title, description: s.description } })) }) }} /></>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

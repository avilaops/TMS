import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ClipboardList, FileCheck2, Layers3, PackageCheck, Route, ShieldCheck, Truck, Users, Wallet } from 'lucide-react';
import { CONTACT_URL } from '@/lib/public-site';
import { PublicShell } from './PublicShell';
import { PostCards } from './PostCards';

const features = [
  { icon: ClipboardList, title: 'Da cotação à coleta', text: 'Acompanhe as oportunidades, organize os pedidos e mantenha as informações da carga no mesmo fluxo.' },
  { icon: Route, title: 'Viagens com contexto', text: 'Reúna cargas em manifestos e acompanhe a operação, os documentos e as ocorrências da viagem.' },
  { icon: Truck, title: 'Frota e equipe por perto', text: 'Motoristas, veículos, manutenção e despesas conectados ao trabalho de quem está na estrada.' },
  { icon: Wallet, title: 'Financeiro organizado', text: 'Acompanhe fretes, faturas, recebimentos e despesas com os acessos definidos para cada perfil.' },
  { icon: FileCheck2, title: 'Documentos no fluxo', text: 'Importe XML de NF-e e organize os registros e processos fiscais de CT-e e MDF-e junto da operação.' },
  { icon: Users, title: 'Cada pessoa na sua área', text: 'Equipe interna, motoristas e clientes têm espaços próprios para realizar o que precisam.' },
];

const questions = [
  ['A transportadora ganha um site?', 'Sim. Clientes têm um módulo de site institucional como cortesia, com apresentação, serviços, contato e blog. A equipe edita o rascunho e o administrador publica no endereço incluído no TMS. Um domínio próprio exige configuração específica.'],
  ['Para quem é o TMS?', 'Para transportadoras que precisam organizar coletas, cargas, viagens, frota e financeiro, com áreas próprias para a equipe, motoristas e clientes.'],
  ['O cliente consegue acompanhar a entrega?', 'O TMS tem portal do cliente e rastreio com documento e código de acompanhamento. O acesso à operação continua protegido por empresa e perfil.'],
  ['O motorista também usa o sistema?', 'Sim. O motorista tem uma área própria para suas viagens, etapas e registros de entrega. O que aparece depende do vínculo e das permissões da transportadora.'],
  ['Como conheço a solução para minha transportadora?', 'Fale com a equipe Ávila Ops para apresentar sua operação e combinar uma demonstração. A conversa ajuda a identificar os módulos e a configuração necessários.'],
  ['Já sou cliente. Onde entro?', 'Use o botão Já sou cliente no topo da página. O login Ávila Ops encaminha você para sua empresa e sua área de trabalho.'],
];

export function LandingPage() {
  return <PublicShell><main id="conteudo">
    <section className="public-hero public-container">
      <div className="public-hero-copy"><span className="public-eyebrow"><span className="public-dot" /> TMS DA ÁVILA OPS</span>
        <h1>Seu transporte,<br />do pedido<br />à <span>entrega.</span></h1>
        <p>Coletas, cargas, frota e financeiro em uma visão de trabalho. Para sua equipe, seus motoristas e seus clientes.</p>
        <div className="public-actions"><a className="public-button public-button-primary" href={CONTACT_URL} data-public-event="contact_click">Solicitar demonstração <ArrowUpRight size={18} aria-hidden="true" /></a><a className="public-text-link" href="#recursos">Conheça o TMS <ArrowRight size={17} aria-hidden="true" /></a></div>
        <div className="public-hero-note"><ShieldCheck size={17} aria-hidden="true" /><span>Uma operação. Acesso certo para cada pessoa.</span></div>
      </div>
      <div className="public-hero-visual">
        <div className="public-orbit public-orbit-one" /><div className="public-orbit public-orbit-two" />
        <div className="public-operation-card">
          <div className="public-operation-top"><span className="public-mini-logo">T<span>MS</span></span><div><strong>Visão da operação</strong><small>Tudo no mesmo caminho</small></div><span className="public-live-dot" /></div>
          <div className="public-route-line" aria-hidden="true"><span /><i /><span /><i /><span /></div>
          <div className="public-route-labels"><span>Coleta</span><span>Em rota</span><span>Entrega</span></div>
          <div className="public-shipment"><span className="public-icon-square"><ClipboardList size={23} /></span><div><strong>Uma carga bem organizada</strong><small>Pedido, documentos e responsáveis</small></div><Check size={18} className="public-check" /></div>
          <div className="public-shipment"><span className="public-icon-square"><Truck size={23} /></span><div><strong>A operação em movimento</strong><small>Veículo, motorista e viagem</small></div><Check size={18} className="public-check" /></div>
          <div className="public-shipment"><span className="public-icon-square"><PackageCheck size={23} /></span><div><strong>Entrega com registro</strong><small>Etapas e comprovantes no fluxo</small></div><CheckCheck size={18} className="public-check" /></div>
          <div className="public-operation-bottom"><Layers3 size={16} aria-hidden="true" /><span>Do comercial ao comprovante.</span></div>
        </div>
        <div className="public-float-card"><PackageCheck size={23} aria-hidden="true" /><div><strong>Informação que acompanha</strong><span>cada etapa da carga.</span></div></div>
        <p className="public-illustration-note">Visão ilustrativa do fluxo • sem dados reais</p>
      </div>
    </section>

    <section className="public-proof-strip"><div className="public-container"><span>Conexões que fazem a operação andar</span><div><span>COMERCIAL</span><i /><span>OPERAÇÃO</span><i /><span>MOTORISTA</span><i /><span>CLIENTE</span></div></div></section>

    <section id="recursos" className="public-section public-container">
      <div className="public-section-heading"><div><span className="public-eyebrow">DA PRIMEIRA COLETA AO ÚLTIMO REGISTRO</span><h2>Uma visão completa.<br />Um trabalho mais conectado.</h2></div><p>As informações deixam de ficar espalhadas e passam a acompanhar a carga, a equipe e cada etapa da sua rotina.</p></div>
      <div className="public-feature-grid">{features.map(({ icon: Icon, title, text }) => <article className="public-feature" key={title}><span className="public-feature-icon"><Icon size={25} strokeWidth={1.7} aria-hidden="true" /></span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>

    <section className="public-workflow"><div className="public-container public-workflow-grid"><div><span className="public-eyebrow">UM FLUXO QUE FAZ SENTIDO</span><h2>A carga muda de etapa.<br />A informação vai junto.</h2><p>O que começa como uma solicitação ganha contexto ao longo da operação, sem perder a ligação com o cliente e a viagem.</p><a className="public-text-link" href={CONTACT_URL} data-public-event="contact_click">Vamos conversar sobre sua operação <ArrowUpRight size={17} aria-hidden="true" /></a></div><ol className="public-steps"><li><span>01</span><div><h3>Organize a entrada</h3><p>Cotação, cliente e dados da carga preparados para a coleta.</p></div></li><li><span>02</span><div><h3>Conecte a viagem</h3><p>Manifesto, frota, equipe e documentos no contexto da operação.</p></div></li><li><span>03</span><div><h3>Acompanhe até o fechamento</h3><p>Entrega, comprovantes, ocorrências e financeiro ligados ao trabalho realizado.</p></div></li></ol></div></section>

    <section className="public-section public-container"><div className="public-section-heading"><div><span className="public-eyebrow">PARA QUEM FAZ ACONTECER</span><h2>Um sistema.<br />Diferentes pontos de vista.</h2></div></div><div className="public-audience-grid"><article><span>Na gestão</span><h3>A visão de quem organiza.</h3><p>O painel reúne as frentes da operação e respeita os acessos da equipe.</p></article><article><span>Na estrada</span><h3>O contexto de quem entrega.</h3><p>O motorista acompanha suas viagens e registra as etapas do serviço.</p></article><article><span>Do outro lado</span><h3>A informação de quem espera.</h3><p>O cliente tem sua área para consultar e acompanhar os serviços da transportadora.</p></article></div></section>

    <section className="public-section public-blog-section"><div className="public-container"><div className="public-section-heading"><div><span className="public-eyebrow">UNIVERSO FISCAL</span><h2>Entenda os documentos.<br />Conecte as informações.</h2></div><Link className="public-text-link" href="/blog">Explore o Blog <ArrowRight size={17} aria-hidden="true" /></Link></div><PostCards /></div></section>

    <section className="public-section public-container public-faq"><div><span className="public-eyebrow">ANTES DE COMEÇAR</span><h2>Uma boa decisão<br />começa com clareza.</h2><p>Algumas respostas para conhecer o TMS e encontrar seu próximo passo.</p></div><div>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>

    <section className="public-container public-final-cta"><div><span className="public-eyebrow">SUA OPERAÇÃO TEM UM PRÓXIMO PASSO</span><h2>Vamos conectar<br />o que move sua empresa.</h2><p>Conte como sua transportadora trabalha. A gente conversa sobre o que pode fazer sentido para ela.</p></div><a className="public-button public-button-white" href={CONTACT_URL} data-public-event="contact_click">Falar com a Ávila Ops <ArrowUpRight size={18} aria-hidden="true" /></a></section>
  </main></PublicShell>;
}

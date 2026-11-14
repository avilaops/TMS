import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import { ArrowUpRight } from 'lucide-react';
import { CONTACT_URL } from '@/lib/public-site';
import './public-site.css';
import { PublicConsent } from './PublicConsent';
import { ProductStructuredData } from './StructuredData';

export async function PublicShell({ children }: { children: ReactNode }) {
  // IDs are configured on Render at runtime, after the standalone is built by CI.
  await connection();
  return <div className="tms-public">
    <ProductStructuredData />
    <a className="public-skip" href="#conteudo">Ir para o conteúdo</a>
    <header className="public-header">
      <div className="public-container public-header-inner">
        <Link className="public-brand" href="/" aria-label="TMS Ávila Ops • início">
          <Image src="/favicon-96x96.png" alt="" width={40} height={40} priority />
          <span><strong>TMS</strong><small>ÁVILA OPS</small></span>
        </Link>
        <nav className="public-nav" aria-label="Navegação principal">
          <Link href="/sobre">Sobre</Link><Link href="/blog">Blog</Link>
          <Link className="public-client-link" href="/login" data-public-event="login_click">Já sou cliente <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </nav>
      </div>
    </header>
    {children}
    <footer className="public-footer">
      <div className="public-container public-footer-grid">
        <div><Link className="public-footer-brand" href="/">TMS <span>• Ávila Ops</span></Link><p>Logística conectada.<br />Da primeira coleta à última entrega.</p></div>
        <div><strong>Explore</strong><Link href="/sobre">Sobre o TMS</Link><Link href="/blog">Universo Fiscal</Link><Link href="/rastreio">Acompanhar uma entrega</Link></div>
        <div><strong>Vamos conversar</strong><a href={CONTACT_URL} data-public-event="contact_click">Fale com a Ávila Ops <ArrowUpRight size={14} aria-hidden="true" /></a><Link href="/login" data-public-event="login_click">Acessar minha conta</Link><a href="https://avilaops.com/">Conheça a Ávila Ops</a></div>
      </div>
      <div className="public-container public-footer-bottom"><span>© {new Date().getFullYear()} Ávila Ops</span><div><Link href="/privacidade">Privacidade</Link><Link href="/cookies">Cookies e preferências</Link></div></div>
    </footer>
    <PublicConsent containerId={process.env.TMS_GTM_CONTAINER_ID} measurementId={process.env.TMS_GA4_MEASUREMENT_ID} />
  </div>;
}

export function PublicPageFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children: ReactNode }) {
  return <main id="conteudo" className="public-page public-container">
    <Link className="public-back" href="/">← Início</Link>
    <header className="public-page-heading"><span className="public-eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</header>
    {children}
  </main>;
}

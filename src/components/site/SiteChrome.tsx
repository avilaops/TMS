"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X, MessageCircle, ArrowUpRight } from "lucide-react";
import { company } from "@/config/company";
import { whatsappUrl } from "@/lib/whatsapp";
import "@/app/mobile.css";

function Logo() {
  return <Link className="ui-logo" href="/" aria-label="Mello Transportes — início"><Image src="/logo-mello-96.webp" alt="" width={40} height={40} /><span><strong>MELLO <b>TRANSPORTES</b></strong><small>RIO PRETO E REGIÃO</small></span></Link>;
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const links = [["/servicos", "Serviços"], ["/cidades", "Cidades"], ["/frota", "Frota"], ["/rastreio", "Rastreio"], ["/blog", "Blog"], ["/duvidas", "Dúvidas"]];
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return <header className="ui-header">
    <a className="ui-skip" href="#main-content">Ir para o conteúdo</a>
    <Logo />
    <button ref={toggle} className="ui-menu-toggle" aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open} aria-controls="public-navigation" onClick={() => setOpen(!open)}>{open ? <X size={23} /> : <Menu size={23} />}</button>
    <nav id="public-navigation" className={open ? "ui-navigation is-open" : "ui-navigation"} aria-label="Navegação principal">
      {links.map(([href, title]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpen(false)}>{title}</Link>)}
      <Link className="ui-button" href="/coleta" onClick={() => setOpen(false)}>Solicitar coleta <ArrowUpRight size={16} /></Link>
    </nav>
  </header>;
}

export function SiteFooter() {
  return <footer className="ui-footer"><div className="ui-footer-inner">
    <Logo /><p>Coletas e entregas em Rio Preto e região.</p>
    <a className="ui-footer-whatsapp" href={whatsappUrl("Olá! Gostaria de falar com a Mello Transportes.")} target="_blank" rel="noopener noreferrer"><MessageCircle size={20} /> Falar no WhatsApp <ArrowUpRight size={18} /></a>
    <div className="ui-footer-links"><Link href="/cotacao">Pedir cotação</Link><Link href="/mercadorias">Preparar a carga</Link><Link href="/marca">Marca e materiais</Link><Link href="/cidades">Cidades atendidas</Link></div>
    <address><a href={company.phoneHref}>{company.phone}</a><a href={`mailto:${company.email}`}>{company.email}</a><span>{company.address}</span></address>
    <small>© {new Date().getFullYear()} {company.shortName}. Os dados informados são usados para atender sua solicitação.</small>
  </div></footer>;
}

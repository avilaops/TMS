import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, ChevronRight, MessageCircle, PackageCheck, Truck, Route, Boxes, MapPin } from "lucide-react";
import { whatsappUrl } from "@/lib/whatsapp";

export function Breadcrumbs({ items }: { items: { title: string; href?: string }[] }) {
  return <nav className="ui-breadcrumbs" aria-label="Você está em"><Link href="/">Início</Link>{items.map((item) => <span key={item.title}><ChevronRight size={12} aria-hidden="true" />{item.href ? <Link href={item.href}>{item.title}</Link> : <span aria-current="page">{item.title}</span>}</span>)}</nav>;
}

export function PageIntro({ label, title, description }: { label: string; title: string; description: string }) {
  return <header className="ui-page-intro"><p className="ui-kicker">{label}</p><h1>{title}</h1><p>{description}</p></header>;
}

export function ShortCard({ href, title, subtitle, image }: { href: string; title: string; subtitle?: string; image?: string }) {
  const Icon = href.includes('/cidades/') ? MapPin : href.includes('coletas-comerciais') ? PackageCheck : href.includes('entregas-regionais') ? Truck : href.includes('distribuicao-por-polos') ? Route : Boxes;
  return <Link className={`ui-short-card${image ? " with-image" : ""}`} href={href}>
    {image && <Image src={image} alt={`Ilustração de ${title} com a marca Mello`} width={240} height={160} sizes="(max-width: 600px) 112px, 180px" />}
    {!image && <span className="ui-card-icon"><Icon size={22} strokeWidth={1.7} aria-hidden="true" /></span>}
    <span className="ui-card-copy"><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span><span className="ui-card-arrow"><ChevronRight size={18} aria-hidden="true" /></span>
  </Link>;
}

export function ContactCTA({ title = "Vamos organizar sua próxima entrega?", message = "Olá! Gostaria de falar com a Mello Transportes sobre uma coleta." }: { title?: string; message?: string }) {
  return <section className="ui-contact"><div><p className="ui-kicker">Conte com a Mello</p><h2>{title}</h2></div><div className="ui-actions"><Link className="ui-button" href="/coleta">Solicitar coleta <ArrowUpRight size={18} /></Link><a className="ui-text-link" href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} />Falar no WhatsApp</a></div></section>;
}

export function VehiclePhoto({ src, title, priority = false }: { src: string; title: string; priority?: boolean }) {
  return <figure className="ui-vehicle-photo"><Image src={src} alt={`Ilustração de ${title} com a logo da Mello Transportes`} width={1536} height={1024} sizes="(max-width: 760px) 100vw, 60vw" priority={priority} /><figcaption>Imagem ilustrativa da aplicação da marca.</figcaption></figure>;
}

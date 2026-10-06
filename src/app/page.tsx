import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import { ShortCard, ContactCTA } from "@/components/site/PublicUI";
import { CityLookup } from "@/components/site/CityLookup";
import { LegacyHashRedirect } from "@/components/site/LegacyHashRedirect";
import { publicFleet, publicServices } from "@/data/publicCatalog";
import { totalServiceAreas } from "@/data/serviceAreas";
import { faqs } from "@/data/faq";
import { company } from "@/config/company";
import "./landing.css";
import "./mobile.css";

export default function HomePage() {
  return <div className="mello-shell"><LegacyHashRedirect /><SiteHeader /><main id="main-content" className="mello-main">
    <section className="ui-home-hero"><div><p className="ui-kicker">Perto da sua empresa. Perto do destino.</p><h1>Coletas e entregas em Rio Preto e região.</h1><p>Atendimento em {totalServiceAreas} cidades. Consulte sua rota e conte com a Mello para o próximo envio.</p><div className="ui-actions"><Link className="ui-button" href="/coleta">Solicitar coleta <ArrowUpRight size={18} /></Link><Link className="ui-button ui-button-secondary" href="/cotacao">Pedir cotação</Link></div></div><figure className="ui-home-photo"><Image src="/images/van-mello.webp" alt="Ilustração de van de carga com a logo da Mello Transportes" width={1536} height={1024} priority sizes="(max-width: 760px) 100vw, 50vw" /><figcaption>Imagem ilustrativa da aplicação da marca.</figcaption></figure></section>
    <section className="ui-city-block"><h2>A Mello atende sua cidade?</h2><CityLookup /><Link className="ui-text-link" href="/cidades">Ver todas as regiões <ArrowUpRight size={16} /></Link></section>
    <section className="ui-section"><div className="ui-section-heading"><h2>Como podemos ajudar</h2></div><div className="ui-card-list">{publicServices.map((item) => <ShortCard key={item.slug} href={`/servicos/${item.slug}`} title={item.title} />)}</div></section>
    <section className="ui-section"><div className="ui-section-heading"><h2>Conheça a frota</h2><Link className="ui-text-link" href="/frota">Ver opções <ArrowUpRight size={16} /></Link></div><div className="ui-fleet-list">{publicFleet.map((item) => <ShortCard key={item.slug} href={`/frota/${item.slug}`} title={item.title} image={item.image} />)}</div></section>
    <section className="ui-section"><div className="ui-section-heading"><h2>Antes de enviar</h2><Link className="ui-text-link" href="/duvidas">Ver dúvidas <ArrowUpRight size={16} /></Link></div><div className="ui-faq">{faqs.slice(0,3).map(([question,answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
    <ContactCTA />
  </main><SiteFooter /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "LocalBusiness", name: company.name, url: company.pagesUrl, telephone: company.phone, email: company.email, address: company.address, areaServed: company.serviceRegion, makesOffer: publicServices.map((service) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: service.title, description: service.description, url: `${company.pagesUrl}servicos/${service.slug}` } })) }) }} /></div>;
}

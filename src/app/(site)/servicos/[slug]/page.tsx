import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, ContactCTA, PageIntro, ShortCard } from "@/components/site/PublicUI";
import { publicServices } from "@/data/publicCatalog";
import { publicMetadata } from "@/lib/publicMetadata";

export const dynamicParams = false;
export function generateStaticParams() { return publicServices.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = publicServices.find((item) => item.slug === slug);
  if (!service) notFound();
  return publicMetadata(service.title, service.description, `/servicos/${slug}`, service.image);
}
export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = publicServices.find((item) => item.slug === slug);
  if (!service) notFound();
  return <><Breadcrumbs items={[{ title: "Serviços", href: "/servicos" }, { title: service.title }]} /><PageIntro label="Serviços" title={service.title} description={service.description} />
    <div className="ui-detail-layout"><figure className="ui-vehicle-photo"><Image src={service.image} alt={`Ilustração de ${service.title.toLowerCase()}`} width={1200} height={800} sizes="(max-width: 760px) 100vw, 50vw" priority /><figcaption>Imagem ilustrativa.</figcaption></figure><div className="ui-detail-copy"><h2>Como funciona</h2><ol>{service.steps.map((step) => <li key={step}>{step}</li>)}</ol><h2>O que ter em mãos</h2><ul>{service.preparation.map((item) => <li key={item}>{item}</li>)}</ul><Link className="ui-text-link" href="/cotacao">Pedir uma cotação →</Link></div></div>
    <ContactCTA title="Vamos planejar seu envio?" message={`Olá! Gostaria de saber mais sobre ${service.title.toLowerCase()}.`} />
    <section className="ui-section"><h2>Outros serviços</h2><div className="ui-card-list">{publicServices.filter((item) => item.slug !== slug).map((item) => <ShortCard key={item.slug} href={`/servicos/${item.slug}`} title={item.title} />)}</div></section>
  </>;
}

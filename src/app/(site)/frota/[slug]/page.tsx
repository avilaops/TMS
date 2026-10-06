import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, ContactCTA, PageIntro, ShortCard, VehiclePhoto } from "@/components/site/PublicUI";
import { publicFleet } from "@/data/publicCatalog";
import { publicMetadata } from "@/lib/publicMetadata";

export const dynamicParams = false;
export function generateStaticParams() { return publicFleet.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vehicle = publicFleet.find((item) => item.slug === slug);
  if (!vehicle) notFound();
  return publicMetadata(vehicle.title, vehicle.description, `/frota/${slug}`, vehicle.image);
}
export default async function VehiclePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vehicle = publicFleet.find((item) => item.slug === slug);
  if (!vehicle) notFound();
  return <><Breadcrumbs items={[{ title: "Frota", href: "/frota" }, { title: vehicle.title }]} /><PageIntro label="Nossa frota" title={vehicle.title} description={vehicle.description} />
    <div className="ui-detail-layout"><VehiclePhoto src={vehicle.image} title={vehicle.title} priority /><div className="ui-detail-copy"><h2>Para sua operação</h2><ul>{vehicle.uses.map((use) => <li key={use}>{use}</li>)}</ul><h2>Antes de confirmar</h2><p>Informe quantidade de volumes, dimensões, peso, origem e destino. A equipe verifica o veículo adequado e a programação.</p><p className="ui-note">Disponibilidade e capacidade confirmadas para cada envio.</p><Link className="ui-text-link" href="/mercadorias">Como preparar a carga →</Link></div></div>
    <ContactCTA title="Confirme o veículo para seu envio." message={`Olá! Gostaria de confirmar a disponibilidade de ${vehicle.title} para uma coleta.`} />
    <section className="ui-section"><h2>Conheça os outros veículos</h2><div className="ui-fleet-list">{publicFleet.filter((item) => item.slug !== slug).map((item) => <ShortCard key={item.slug} href={`/frota/${item.slug}`} title={item.title} image={item.image} />)}</div></section>
  </>;
}

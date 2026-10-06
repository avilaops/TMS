import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, ContactCTA, PageIntro } from "@/components/site/PublicUI";
import { publicHubs } from "@/data/publicCatalog";
import { publicMetadata } from "@/lib/publicMetadata";

export const dynamicParams = false;
export function generateStaticParams() { return publicHubs.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hub = publicHubs.find((item) => item.slug === slug);
  if (!hub) notFound();
  return publicMetadata(`Transporte na região de ${hub.name}`, `Consulte as ${hub.areas.length} cidades atendidas pelo polo de ${hub.name}, os prazos previstos e solicite uma coleta.`, `/cidades/${slug}`);
}
export default async function HubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hub = publicHubs.find((item) => item.slug === slug);
  if (!hub) notFound();
  return <><Breadcrumbs items={[{ title: "Cidades", href: "/cidades" }, { title: hub.name }]} /><PageIntro label="Polo regional" title={hub.name} description={`${hub.areas.length} cidades atendidas neste polo. Confira seu destino e o prazo previsto.`} />
    <ul className="ui-city-list">{hub.areas.map((area) => <li key={area.city}><span>{area.city}</span><small>{area.deadline}</small></li>)}</ul>
    <p className="ui-note">Os prazos da relação são estimativas de rota. Confirme a programação, a carga e as condições do destino antes do envio.</p><Link className="ui-text-link" href="/cidades">← Consultar outra região</Link>
    <ContactCTA title={`Precisa enviar para a região de ${hub.name}?`} message={`Olá! Gostaria de confirmar uma coleta para a região de ${hub.name}.`} />
  </>;
}

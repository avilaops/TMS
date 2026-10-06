import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, ContactCTA, PageIntro, ShortCard } from "@/components/site/PublicUI";
import { CityLookup } from "@/components/site/CityLookup";
import { PublicMap } from "@/components/site/PublicMap";
import { CollectionPage } from "@/components/site/CollectionPage";
import { publicFleet, publicHubs, publicServices } from "@/data/publicCatalog";
import { totalServiceAreas } from "@/data/serviceAreas";
import { faqs } from "@/data/faq";
import { brandColors, brandRules } from "@/data/brand";
import { publicMetadata } from "@/lib/publicMetadata";

const sections: Record<string, { title: string; description: string }> = {
  servicos: { title: "Serviços de transporte", description: "Coletas, entregas e distribuição regional. Escolha um serviço para conhecer os detalhes e organizar seu envio." },
  frota: { title: "O veículo certo para sua carga", description: "Strada com capota, van e VUC de baú. Conheça cada opção e confirme a disponibilidade com a equipe." },
  cidades: { title: "Onde a Mello atende", description: `Consulte seu destino entre ${totalServiceAreas} cidades de Rio Preto e região.` },
  mercadorias: { title: "Prepare sua mercadoria", description: "Uma carga bem embalada e identificada ajuda a coleta e a entrega a acontecerem com tranquilidade." },
  duvidas: { title: "Como podemos ajudar?", description: "Encontre respostas sobre coleta, prazos e documentos antes de organizar seu envio." },
  marca: { title: "Marca e materiais", description: "Logo, cores e orientações para usar a identidade da Mello Transportes." },
  coleta: { title: "Solicitar coleta", description: "Organize os dados da retirada e envie sua solicitação para a equipe da Mello Transportes." },
};

export function generateStaticParams() { return Object.keys(sections).map((section) => ({ section })); }
export const dynamicParams = false;
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = sections[section];
  if (!item) notFound();
  return publicMetadata(item.title, item.description, `/${section}`);
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = sections[section];
  if (!item) notFound();
  return <>
    <Breadcrumbs items={[{ title: item.title }]} />
    {section !== "coleta" && <PageIntro label="Mello Transportes" title={item.title} description={item.description} />}
    {section === "servicos" && <div className="ui-card-list">{publicServices.map((service) => <ShortCard key={service.slug} href={`/servicos/${service.slug}`} title={service.title} subtitle={service.summary} />)}</div>}
    {section === "frota" && <><div className="ui-fleet-list">{publicFleet.map((vehicle) => <ShortCard key={vehicle.slug} href={`/frota/${vehicle.slug}`} title={vehicle.title} subtitle={vehicle.summary} image={vehicle.image} />)}</div><p className="ui-note">Imagens ilustrativas da aplicação da marca. A equipe confirma veículo, capacidade e disponibilidade para cada envio.</p></>}
    {section === "cidades" && <><div className="ui-city-block"><CityLookup /></div><section className="ui-section"><h2>Explore por polo</h2><div className="ui-card-list">{publicHubs.map((hub) => <ShortCard key={hub.slug} href={`/cidades/${hub.slug}`} title={hub.name} subtitle={`${hub.areas.length} cidades atendidas`} />)}</div></section><PublicMap /></>}
    {section === "duvidas" && <div className="ui-faq">{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>}
    {section === "mercadorias" && <><div className="ui-detail-layout"><Image src="/blog-capas/preparo-carga.webp" alt="Ilustração de preparação e medição de uma caixa" width={1200} height={630} className="ui-editorial-photo" /><div className="ui-detail-copy"><h2>Antes da coleta</h2><ul><li>Use embalagem firme e proteção interna compatível com o conteúdo.</li><li>Identifique os volumes e o destinatário.</li><li>Informe quantidade, peso e dimensões da carga embalada.</li><li>Separe a documentação e confirme as exigências para seu envio.</li><li>Avise sobre fragilidade, acesso difícil ou necessidade de ajuda na descarga.</li></ul><p className="ui-note">Para cargas especiais, confirme a possibilidade de transporte com a equipe antes de solicitar a coleta.</p></div></div><Link className="ui-text-link" href="/blog/checklist-antes-de-solicitar-coleta">Ler o checklist completo →</Link></>}
    {section === "marca" && <><div className="ui-detail-layout"><div className="ui-brand-logo"><Image src="/logo-mello-480.webp" width={480} height={480} alt="Logo oficial da Mello Transportes" /></div><div className="ui-detail-copy"><h2>Arquivos da marca</h2><p>Use a versão adequada ao fundo e mantenha a proporção original.</p><div className="ui-actions"><a className="ui-button" href="/logo-mello.png" download>Baixar logo</a><a className="ui-text-link" href="/manual-marca-mello.pdf" target="_blank" rel="noopener noreferrer">Manual de marca ↗</a></div></div></div><h2>Cores da Mello</h2><div className="ui-swatches">{brandColors.map((color) => <div key={color.hex}><i style={{ backgroundColor: color.hex }} /><strong>{color.name}</strong><small>{color.hex}</small></div>)}</div><h2>Cuidados de aplicação</h2><ul className="ui-checklist">{brandRules.map((rule) => <li key={rule}>{rule}</li>)}</ul></>}
    {section === "coleta" && <CollectionPage />}
    {section !== "coleta" && section !== "marca" && <ContactCTA />}
  </>;
}

import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "@/components/site/SiteChrome";
import "../landing.css";

export const metadata: Metadata = {
  title: "Cotação de frete",
  description: "Solicite uma cotação de frete em São José do Rio Preto e região. Informe origem, destino, volumes e peso para receber a proposta da Mello Transportes.",
  alternates: { canonical: "/cotacao" },
  openGraph: { type: "website", locale: "pt_BR", url: "/cotacao", title: "Cotação de frete | Mello Transportes", description: "Solicite uma cotação de frete em São José do Rio Preto e região. Informe origem, destino, volumes e peso para receber a proposta da Mello Transportes.", images: [{ url: "/preview-whatsapp-v2.png", width: 1200, height: 630, alt: "Mello Transportes" }] },
  twitter: { card: "summary_large_image", title: "Cotação de frete | Mello Transportes", description: "Solicite uma cotação de frete em São José do Rio Preto e região. Informe origem, destino, volumes e peso para receber a proposta da Mello Transportes.", images: ["/preview-whatsapp-v2.png"] },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <><SiteHeader /><main id="main-content" className="public-service">{children}</main><SiteFooter /></>;
}

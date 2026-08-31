import type { Metadata, Viewport } from "next";
import { Inter, Outfit, Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";
import AnalyticsClickTracker from "@/components/analytics/AnalyticsClickTracker";
import {
  GoogleTagManagerNoScript,
  GoogleTagManagerScript,
} from "@/components/analytics/google-tag-manager";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

const SITE_URL = "https://mellotransportesriopreto.com.br";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // O dominio ja tem historico de busca local ("entrega rapida", "motoboy",
  // "transportadora em Rio Preto"). O titulo publico precisa carregar isso; as
  // areas internas herdam o template.
  title: {
    default:
      "Mello Transportes | Coletas e entregas em São José do Rio Preto",
    template: "%s | Mello Transportes",
  },
  description:
    "Transportadora em São José do Rio Preto. Coletas e entregas em mais de 130 cidades da região, com prazo de até 24h ou até 48h e atendimento pelo WhatsApp.",
  applicationName: "Mello Transportes",
  alternates: {
    canonical: "/",
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "Mello",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: "Mello Transportes Rio Preto",
    title: "Mello Transportes | Rio Preto e região",
    description:
      "Coletas e entregas em Rio Preto e região, com atendimento próximo e rotas planejadas para sua empresa.",
    images: [
      {
        url: "/preview-whatsapp-v1.png",
        width: 1200,
        height: 630,
        alt: "Mello Transportes | transporte regional em São Paulo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mello Transportes | Rio Preto e região",
    description:
      "Coletas e entregas em Rio Preto e região, com atendimento próximo e rotas planejadas para sua empresa.",
    images: ["/preview-whatsapp-v1.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={cn("font-sans", geist.variable)}>
      <head>
        <GoogleTagManagerScript />
      </head>
      <body className={`${inter.variable} ${outfit.variable} font-sans antialiased bg-gray-50 text-gray-900`}>
        <GoogleTagManagerNoScript />
        <AnalyticsClickTracker />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

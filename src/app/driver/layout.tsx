import type { Metadata, Viewport } from "next";
import DriverShell from "@/components/driver/DriverShell";

// Server component só para poder declarar o manifest próprio do app do
// motorista — a interface em si vive em DriverShell (client component).
export const metadata: Metadata = {
  title: "Mello Motorista",
  description: "Viagens, entregas e comprovantes para a equipe da Mello Transportes.",
  manifest: "/driver.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Mello Motorista",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  // O app é usado na rua, em uma mão: sem zoom acidental ao tocar nos campos.
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <DriverShell>{children}</DriverShell>;
}

import type { Metadata } from "next";

export function publicMetadata(title: string, description: string, path: string, image = "/preview-whatsapp-v2.png"): Metadata {
  return {
    title, description, alternates: { canonical: path },
    openGraph: { type: "website", locale: "pt_BR", url: path, title: `${title} | Mello Transportes`, description, images: [{ url: image, alt: title }] },
    twitter: { card: "summary_large_image", title: `${title} | Mello Transportes`, description, images: [image] },
  };
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { company } from "@/config/company";
import { sortedPosts } from "@/content/blog";
import "../landing.css";
import "./blog.css";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Conteúdo prático sobre frete, coleta, prazo e documentação de carga, escrito pela equipe da Mello Transportes em São José do Rio Preto.",
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    url: "/blog",
    title: "Blog | Mello Transportes",
    description:
      "Conteúdo prático sobre frete, coleta, prazo e documentação de carga.",
  },
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default function BlogIndexPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="blog-hero">
          <p className="eyebrow">
            <BookOpen size={16} /> Blog
          </p>
          <h1>Como o transporte regional funciona por dentro.</h1>
          <p>
            Material prático sobre cotação, coleta, prazo e documentação, do
            jeito que a operação acontece em {company.tagline}. Sem promessa
            vaga e sem termo técnico solto.
          </p>
        </section>

        <div className="post-grid">
          {sortedPosts.map((post) => (
            <article className="post-card" key={post.slug}>
              {post.coverImage && (
                <Link className="post-card-cover" href={`/blog/${post.slug}`}>
                  <Image
                    src={post.coverImage}
                    alt={post.coverImageAlt ?? post.title}
                    width={1200}
                    height={630}
                  />
                </Link>
              )}
              <div className="post-meta">
                <span className="post-tag">{post.category}</span>
                <time dateTime={post.publishedAt}>
                  {dateFormatter.format(new Date(`${post.publishedAt}T12:00:00Z`))}
                </time>
                <span>{post.readingMinutes} min de leitura</span>
              </div>
              <h2>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
              </h2>
              <p>{post.excerpt}</p>
              <Link className="read-more" href={`/blog/${post.slug}`}>
                Ler a matéria <ArrowRight size={16} />
              </Link>
            </article>
          ))}
        </div>

        <section className="post-cta">
          <h2>Precisa de uma coleta ou quer confirmar sua rota?</h2>
          <p>
            A equipe confirma cidade, prazo e veículo pelo WhatsApp. O
            formulário do site organiza os dados e envia tudo de uma vez.
          </p>
          <div className="actions">
            <a className="btn primary" href="/#/coleta">
              Solicitar coleta <ArrowRight size={16} />
            </a>
            <a className="btn ghost" href="/#/cidades">
              Consultar cidade
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

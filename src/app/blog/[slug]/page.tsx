import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PostBody } from "@/components/site/PostBody";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { company } from "@/config/company";
import { coverOf, getPost, posts, sortedPosts } from "@/content/blog";
import "../../landing.css";
import "../blog.css";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);

  if (!post) {
    return { title: "Matéria não encontrada" };
  }

  const capa = coverOf(post);

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      url: `/blog/${post.slug}`,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      images: [{ url: capa.url, width: 1200, height: 630, alt: capa.alt }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [capa.url],
    },
  };
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default async function PostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPost(slug);

  if (!post) {
    notFound();
  }

  const others = sortedPosts.filter((item) => item.slug !== post.slug).slice(0, 2);
  const siteUrl = "https://mellotransportesriopreto.com.br";

  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <article className="post-page">
          <Link className="post-back" href="/blog">
            <ArrowLeft size={16} /> Todas as matérias
          </Link>
          <div className="post-meta">
            <span className="post-tag">{post.category}</span>
            <time dateTime={post.publishedAt}>
              {dateFormatter.format(new Date(`${post.publishedAt}T12:00:00Z`))}
            </time>
            <span>{post.readingMinutes} min de leitura</span>
          </div>
          <h1>{post.title}</h1>
          <p className="post-lead">{post.excerpt}</p>
          {post.coverImage && (
            <figure><Image
              className="post-cover"
              src={post.coverImage}
              alt={post.coverImageAlt ?? post.title}
              width={1200}
              height={630}
              priority
            /><figcaption className="blog-image-note">Imagem ilustrativa gerada para este conteúdo.</figcaption></figure>
          )}
          <hr className="post-rule" />
          <PostBody blocks={post.body} />
        </article>

        <section className="post-cta">
          <h2>Quer confirmar isso na sua operação?</h2>
          <p>
            Cada carga tem um detalhe que muda a conta. Mande os dados pelo
            WhatsApp e a equipe confirma cidade, prazo e veículo antes de você
            fechar o pedido.
          </p>
          <div className="actions">
            <Link className="btn primary" href="/coleta">
              Solicitar coleta <ArrowRight size={16} />
            </Link>
            <a className="btn ghost" href={company.phoneHref}>
              {company.phone}
            </a>
          </div>
        </section>

        {others.length > 0 && (
          <section className="post-next">
            <h2>Leia também</h2>
            <div className="post-grid" style={{ margin: 0 }}>
              {others.map((item) => (
                <article className="post-card" key={item.slug}>
                  <div className="post-meta">
                    <span className="post-tag">{item.category}</span>
                    <span>{item.readingMinutes} min de leitura</span>
                  </div>
                  <h2>
                    <Link href={`/blog/${item.slug}`}>{item.title}</Link>
                  </h2>
                  <p>{item.excerpt}</p>
                  <Link className="read-more" href={`/blog/${item.slug}`}>
                    Ler a matéria <ArrowRight size={16} />
                  </Link>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            description: post.description,
            image: `${siteUrl}${coverOf(post).url}`,
            datePublished: post.publishedAt,
            dateModified: post.publishedAt,
            inLanguage: "pt-BR",
            mainEntityOfPage: `${siteUrl}/blog/${post.slug}`,
            author: { "@type": "Organization", name: company.name },
            publisher: {
              "@type": "Organization",
              name: company.name,
              logo: {
                "@type": "ImageObject",
                url: `${siteUrl}/logo-mello.png`,
              },
            },
          }),
        }}
      />
    </>
  );
}

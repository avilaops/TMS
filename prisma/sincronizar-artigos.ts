/**
 * Espelha as matérias de src/content/blog.ts na tabela Article.
 *
 * O arquivo continua sendo o dono do conteúdo: é ele que gera a página, o
 * sitemap e os dados estruturados. Esta tabela existe só para que um post de
 * rede social possa apontar para a matéria e para que a medição do Search
 * Console tenha onde pendurar o número.
 *
 * Ensaio por padrão. Só grava com `--aplicar`:
 *
 *   npx tsx prisma/sincronizar-artigos.ts             # mostra o que faria
 *   npx tsx prisma/sincronizar-artigos.ts --aplicar   # grava
 *
 * Matéria já existente (mesmo slug) é atualizada, nunca duplicada: rodar de
 * novo depois de publicar uma matéria precisa ser seguro.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { posts } from "../src/content/blog";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const aplicar = process.argv.includes("--aplicar");

async function main() {
  console.log(aplicar ? "== APLICANDO ==" : "== ENSAIO (nada será gravado) ==");
  console.log(`matérias no arquivo: ${posts.length}\n`);

  let criadas = 0;
  let atualizadas = 0;

  for (const post of posts) {
    const existente = await prisma.article.findUnique({
      where: { slug: post.slug },
      select: { id: true },
    });

    const dados = {
      title: post.title,
      description: post.description,
      category: post.category,
      // publishedAt do arquivo é data de calendário; lê em UTC para não
      // andar um dia para trás no fuso de quem roda o script.
      publishedAt: new Date(`${post.publishedAt}T12:00:00Z`),
      syncedAt: new Date(),
    };

    if (existente) {
      console.log(`ATUALIZA  ${post.slug}`);
      if (aplicar) {
        await prisma.article.update({ where: { id: existente.id }, data: dados });
      }
      atualizadas += 1;
    } else {
      console.log(`CRIA      ${post.slug}`);
      if (aplicar) {
        await prisma.article.create({ data: { ...dados, slug: post.slug } });
      }
      criadas += 1;
    }
  }

  // Matéria que sumiu do arquivo não é apagada: ela pode ter post publicado
  // apontando para ela, e apagar levaria o histórico junto. Só avisa.
  const slugs = posts.map((p) => p.slug);
  const orfas = await prisma.article.findMany({
    where: { slug: { notIn: slugs } },
    select: { slug: true },
  });
  if (orfas.length) {
    console.log(`\nno banco mas não no arquivo (não apagadas): ${orfas.map((o) => o.slug).join(", ")}`);
  }

  console.log(`\ncriadas: ${criadas} | atualizadas: ${atualizadas}`);
  if (!aplicar) console.log("ensaio: rode de novo com --aplicar para gravar.");
}

main()
  .catch((erro) => {
    console.error("FALHOU:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

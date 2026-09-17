/**
 * Da codigo de rastreio as coletas criadas antes da coluna existir.
 *
 * Usa o mesmo gerador da aplicacao (`src/lib/tracking.ts`), e nao o `random()`
 * do Postgres: `random()` nao e criptografico e e semeado por sessao, o que
 * tornaria os codigos das cargas antigas mais faceis de prever que os das novas.
 *
 * Idempotente: so toca em linha com `trackingCode` nulo. Ensaia por padrao;
 * grava com `--aplicar`.
 *
 *   npx tsx prisma/backfill-tracking-code.ts
 *   npx tsx prisma/backfill-tracking-code.ts --aplicar
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { generateTrackingCode } from "../src/lib/tracking";

const aplicar = process.argv.includes("--aplicar");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const pendentes = await prisma.collection.findMany({
    where: { trackingCode: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Coletas sem código: ${pendentes.length}`);
  if (pendentes.length === 0) return;

  if (!aplicar) {
    console.log("Ensaio. Nada foi gravado. Rode com --aplicar para gravar.");
    return;
  }

  let gravadas = 0;
  for (const { id } of pendentes) {
    // A constraint UNIQUE e a autoridade: se sortear repetido, sorteia de novo.
    for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
      try {
        await prisma.collection.update({
          where: { id },
          data: { trackingCode: generateTrackingCode() },
        });
        gravadas += 1;
        break;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "P2002" || tentativa === 5) throw error;
      }
    }
  }

  console.log(`Códigos gravados: ${gravadas}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

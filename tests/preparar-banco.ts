import { Client } from "pg";
import { aplicarRls } from "../prisma/aplicar-rls";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Roda uma vez antes de todas as suites: aplica o isolamento por empresa
 * (prisma/sql/010-rls.sql) e garante as empresas de teste. Sem DATABASE_URL
 * nao faz nada, e as suites de integracao se pulam sozinhas.
 */
export default async function prepararBanco() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  await aplicarRls(connectionString);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const empresa of [EMPRESA_PADRAO, EMPRESA_OUTRA]) {
      await client.query(
        `INSERT INTO "Tenant" (id, slug, name, active, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, true, now(), now())
         ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, active = true`,
        [empresa.id, empresa.slug, empresa.name],
      );
    }
  } finally {
    await client.end();
  }
}

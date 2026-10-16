-- Cotações no painel (a seção "Cotações", antes "CRM"): número sequencial por
-- empresa, canal de entrada, responsável da equipe, motivo da perda e a data
-- da última atividade, que é por onde a tela acha cotação parada.
--
-- É o que `prisma migrate diff` gera para a mudança em QuoteLead, tornado
-- idempotente. Em banco novo não é preciso: o `npm run db:push` já cria tudo.
--
-- Produção, com a DATABASE_URL de produção no ambiente, ANTES de publicar o
-- código:
--
--   psql "$DATABASE_URL" -1 -f prisma/sql/033-cotacoes.sql
--   npm run db:rls
--
-- O `db:rls` vem depois porque o gatilho `tms_mesmo_tenant` de QuoteLead passa
-- a conferir `assigneeId`: o responsável tem de ser usuário da mesma empresa.
--
-- Backfill: cada cotação que já existe ganha o número pela ordem de chegada
-- dentro da empresa, e a última atividade começa igual ao `updatedAt`.

ALTER TABLE "QuoteLead"
  ADD COLUMN IF NOT EXISTS "number" INTEGER,
  ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'SITE',
  ADD COLUMN IF NOT EXISTS "assigneeId" TEXT,
  ADD COLUMN IF NOT EXISTS "lostReason" TEXT,
  ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "QuoteLead" q
SET "number" = n.numero
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", id) AS numero
  FROM "QuoteLead"
  WHERE "number" IS NULL
) n
WHERE q.id = n.id
  AND NOT EXISTS (SELECT 1 FROM "QuoteLead" x WHERE x."tenantId" = q."tenantId" AND x."number" IS NOT NULL);

UPDATE "QuoteLead" SET "lastActivityAt" = "updatedAt" WHERE "lastActivityAt" > "updatedAt";

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteLead_tenantId_number_key" ON "QuoteLead"("tenantId", "number");
CREATE INDEX IF NOT EXISTS "QuoteLead_tenantId_status_idx" ON "QuoteLead"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "QuoteLead_assigneeId_idx" ON "QuoteLead"("assigneeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'QuoteLead_assigneeId_fkey'
      AND conrelid = '"QuoteLead"'::regclass
  ) THEN
    ALTER TABLE "QuoteLead"
      ADD CONSTRAINT "QuoteLead_assigneeId_fkey"
      FOREIGN KEY ("assigneeId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

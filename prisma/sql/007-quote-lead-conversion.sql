-- CRM: cotação aprovada vira coleta. Duas colunas novas em QuoteLead:
-- `invoiceValue` (valor da nota informado no pedido) e `collectionId` (a coleta
-- criada na conversão do lead).
--
-- É o que `prisma migrate diff` gera para a mudança, tornado idempotente: pode
-- rodar duas vezes sem erro. Em banco novo não é preciso: o `npm run db:push`
-- já cria tudo.
--
-- Produção: o deploy não aplica schema. No servidor, com a DATABASE_URL de
-- produção (banco `tms_avilaops_com`) no ambiente, ANTES de publicar o código:
--
--   psql "$DATABASE_URL" -f prisma/sql/007-quote-lead-conversion.sql
--   npm run db:rls
--
-- Sem as colunas, o funil (`GET /api/dashboard/crm`) e o pedido de cotação do
-- site (`POST /api/leads`, `/api/cotacoes`) respondem 500. O `db:rls` vem
-- depois porque o gatilho `tms_mesmo_tenant` de QuoteLead passa a conferir
-- `collectionId`: a coleta tem de ser da mesma empresa do lead. Nunca na ordem
-- inversa: o 010-rls.sql novo sem este arquivo quebra a gravação de lead.
--
-- Só acrescenta duas colunas anuláveis, um índice único e uma chave
-- estrangeira; nenhuma linha é lida ou alterada. Não há backfill: lead marcado
-- CONVERTED à mão antes desta mudança continua sem coleta.

ALTER TABLE "QuoteLead"
  ADD COLUMN IF NOT EXISTS "collectionId" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceValue" DOUBLE PRECISION;

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteLead_collectionId_key" ON "QuoteLead"("collectionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'QuoteLead_collectionId_fkey'
      AND conrelid = '"QuoteLead"'::regclass
  ) THEN
    ALTER TABLE "QuoteLead"
      ADD CONSTRAINT "QuoteLead_collectionId_fkey"
      FOREIGN KEY ("collectionId") REFERENCES "Collection"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Conferencia de comprovantes: quem decidiu, quando e o motivo da recusa
-- (colunas novas em ProofOfDelivery).
--
-- Como no 001 e no 002: este projeto aplica schema com `prisma db push`, nao
-- com `prisma migrate`, e nao ha historico de migrations. A mudanca vem como
-- script avulso, e continua sendo o `db push` a autoridade sobre o schema.
--
-- O SQL abaixo e o que `prisma migrate diff` gera para as colunas novas,
-- tornado idempotente: pode rodar duas vezes sem erro.
--
-- Producao: o container da app nao roda migrations e o deploy nao aplica
-- schema. No servidor, com a DATABASE_URL de producao (banco
-- `tms_avilaops_com`) no ambiente:
--
--   psql "$DATABASE_URL" -f prisma/sql/003-proof-review.sql
--   npm run db:rls
--
-- O `db:rls` (prisma/sql/010-rls.sql) vem depois porque o gatilho
-- `tms_mesmo_tenant` de ProofOfDelivery passa a conferir tambem
-- `reviewedById`: o conferente tem de ser usuario da mesma empresa do
-- comprovante. `npm run db:push` faz as duas coisas de uma vez e chega ao
-- mesmo resultado; este arquivo existe para quem prefere ver o SQL antes.
--
-- Aplique ANTES de publicar a versao que confere comprovante: sem as colunas,
-- a fila de comprovantes, a conferencia e a pagina do comprovante respondem
-- 500.
--
-- Nao ha backfill. Comprovante anterior a estas colunas continua SUBMITTED
-- (aguardando conferencia), sem conferente.
--
-- So acrescenta tres colunas anulaveis, um indice e uma chave estrangeira;
-- nenhuma coluna existente muda e nenhuma linha e lida ou alterada. Coluna
-- nova nao precisa de politica propria: a politica `tms_tenant` e por linha e
-- ja cobre a tabela.

ALTER TABLE "ProofOfDelivery"
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

CREATE INDEX IF NOT EXISTS "ProofOfDelivery_status_createdAt_idx"
  ON "ProofOfDelivery"("status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProofOfDelivery_reviewedById_fkey'
      AND conrelid = '"ProofOfDelivery"'::regclass
  ) THEN
    ALTER TABLE "ProofOfDelivery"
      ADD CONSTRAINT "ProofOfDelivery_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

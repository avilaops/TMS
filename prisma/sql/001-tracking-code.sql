-- Codigo publico de rastreio em Collection.
--
-- Este projeto aplica schema com `prisma db push`, nao com `prisma migrate`, e
-- nao ha historico de migrations. Criar uma pasta `prisma/migrations/` com uma
-- unica migration quebraria `migrate deploy`, que exigiria o baseline completo
-- do banco. Por isso a mudanca vem como script avulso, e continua sendo o
-- `db push` a autoridade sobre o schema.
--
-- O SQL abaixo e o que `prisma migrate diff` gera, tornado idempotente: pode
-- rodar duas vezes sem erro.
--
-- Producao (o container da app nao roda migrations; o banco so escuta em
-- 127.0.0.1:5436, entao e por tunel SSH):
--
--   ssh -L 5436:127.0.0.1:5436 root@<servidor>
--   psql "postgresql://mello:<senha>@127.0.0.1:5436/mello" -f prisma/sql/001-tracking-code.sql
--
-- Depois, para dar codigo as coletas que ja existem:
--
--   DATABASE_URL="postgresql://mello:<senha>@127.0.0.1:5436/mello" \
--     npx tsx prisma/backfill-tracking-code.ts --aplicar
--
-- A coluna e anulavel de proposito: o ALTER nao bloqueia a tabela nem exige
-- valor para as linhas existentes, entao a app volta a funcionar assim que ele
-- roda. O backfill pode vir em seguida, sem pressa.

ALTER TABLE "Collection" ADD COLUMN IF NOT EXISTS "trackingCode" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Collection_trackingCode_key"
  ON "Collection"("trackingCode");

-- Historico de status da coleta (tabela CollectionStatusHistory).
--
-- Como no 001: este projeto aplica schema com `prisma db push`, nao com
-- `prisma migrate`, e nao ha historico de migrations. A mudanca vem como
-- script avulso, e continua sendo o `db push` a autoridade sobre o schema.
--
-- O SQL abaixo e o que `prisma migrate diff` gera para o modelo novo, tornado
-- idempotente: pode rodar duas vezes sem erro.
--
-- Producao: o container da app nao roda migrations e o deploy nao aplica
-- schema. O banco e o PostgreSQL compartilhado do servidor (banco e role
-- `tms_avilaops_com`, ver docker-compose.yml), nao mais o `mello` da porta
-- 5436 que o cabecalho do 001 descreve. No servidor, com a DATABASE_URL de
-- producao no ambiente:
--
--   psql "$DATABASE_URL" -f prisma/sql/002-status-history.sql
--
-- Aplique ANTES de publicar a versao que grava historico: sem a tabela, criar
-- coleta e trocar status respondem 500.
--
-- Nao ha backfill. Coleta anterior a esta tabela fica sem historico: a unica
-- data disponivel seria `updatedAt`, que muda em qualquer edicao e inventaria
-- uma troca de status que nao aconteceu.
--
-- So cria tabela, indice e chaves estrangeiras; nenhuma coluna existente muda
-- e nenhuma linha e lida ou alterada.

CREATE TABLE IF NOT EXISTS "CollectionStatusHistory" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CollectionStatusHistory_collectionId_createdAt_idx"
  ON "CollectionStatusHistory"("collectionId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CollectionStatusHistory_collectionId_fkey'
      AND conrelid = '"CollectionStatusHistory"'::regclass
  ) THEN
    ALTER TABLE "CollectionStatusHistory"
      ADD CONSTRAINT "CollectionStatusHistory_collectionId_fkey"
      FOREIGN KEY ("collectionId") REFERENCES "Collection"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CollectionStatusHistory_userId_fkey'
      AND conrelid = '"CollectionStatusHistory"'::regclass
  ) THEN
    ALTER TABLE "CollectionStatusHistory"
      ADD CONSTRAINT "CollectionStatusHistory_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Resultado do convite por e-mail de cada usuario (colunas novas em "User"):
-- situacao (ENVIADO | FALHOU | PENDENTE), motivo e quando. O endereco de criar
-- a senha nunca e guardado.
--
-- Como nos scripts anteriores: este projeto aplica schema com `prisma db push`,
-- nao com `prisma migrate`, e nao ha historico de migrations. A mudanca vem
-- como script avulso e idempotente; o `db push` continua sendo a autoridade.
--
-- Producao: o deploy nao aplica schema. No servidor, com a DATABASE_URL de
-- producao (banco `tms_avilaops_com`) no ambiente, ANTES de o codigo chegar a
-- main:
--
--   psql "$DATABASE_URL" -f prisma/sql/013-invite-status.sql
--
-- Sao colunas nulas, sem referencia a outra tabela: nao mexem nas politicas de
-- empresa (010-rls.sql) e nao pedem `npm run db:rls`.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inviteStatus" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inviteDetail" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "inviteAt" TIMESTAMP(3);

-- Frete na coleta: colunas freight* em Collection.
--
-- É o que `prisma migrate diff` gera entre o schema anterior e o desta mudança:
-- só acrescenta colunas anuláveis (e um booleano com padrão) e uma chave para
-- FreightTable. Aplicado em produção em 08/10/2026, antes do deploy do código,
-- seguido do 010-rls.sql (o gatilho de Collection passa a conferir a tabela de
-- frete). Em banco novo não é preciso: o `npm run db:push` já cria tudo.

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "freightDeadlineHours" INTEGER,
ADD COLUMN     "freightDetails" JSONB,
ADD COLUMN     "freightManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freightTableId" TEXT,
ADD COLUMN     "freightValue" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_freightTableId_fkey" FOREIGN KEY ("freightTableId") REFERENCES "FreightTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

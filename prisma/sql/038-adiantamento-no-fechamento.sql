-- Baixa do adiantamento no fechamento mensal da remuneração variável
-- (src/lib/remuneracao.ts).
--
-- Uma coluna nova, anulável:
--   "CrewAdvance": "closingId" — o fechamento ("CrewPayClosing") que descontou
--     o adiantamento (o vale inteiro, ou a sobra a devolver do acerto). Nula
--     enquanto ele não foi descontado em nenhum. Reabrir o fechamento apaga a
--     linha dele e a coluna volta a nula (ON DELETE SET NULL): o adiantamento
--     volta a ser o que era, porque "status" e o acerto nunca mudaram.
-- Só acrescenta: nenhuma coluna existente muda.
--
-- No fim, um acerto único dos fechamentos gravados ANTES desta coluna existir:
-- os adiantamentos que cada um deles descontou (os ids estão em
-- "details" -> 'adiantamentos') passam a apontar para ele. Sem isso eles
-- continuariam "em aberto" e entrariam de novo, como dívida de meses
-- anteriores, no próximo fechamento da pessoa. Só preenche a coluna nova, só
-- onde ela está nula e só dentro da mesma empresa; rodar de novo não muda nada.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que
-- acrescenta "closingId" ao gatilho que impede o adiantamento de apontar para
-- fechamento de outra empresa.

-- AlterTable
ALTER TABLE "CrewAdvance" ADD COLUMN     "closingId" TEXT;

-- CreateIndex
CREATE INDEX "CrewAdvance_closingId_idx" ON "CrewAdvance"("closingId");

-- AddForeignKey
ALTER TABLE "CrewAdvance" ADD CONSTRAINT "CrewAdvance_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "CrewPayClosing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Os fechamentos que já existiam: liga a cada um os adiantamentos que ele descontou.
UPDATE "CrewAdvance" AS adiantamento
SET "closingId" = fechamento."id"
FROM "CrewPayClosing" AS fechamento
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(fechamento."details" -> 'adiantamentos') = 'array' THEN fechamento."details" -> 'adiantamentos' ELSE '[]'::jsonb END
) AS descontado
WHERE adiantamento."id" = descontado ->> 'id'
  AND adiantamento."tenantId" = fechamento."tenantId"
  AND adiantamento."closingId" IS NULL;

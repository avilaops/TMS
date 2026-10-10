-- Comprovante de entrega no padrão das grandes transportadoras (ROADMAP:
-- "Comprovante de entrega: fotos por tipo, ressalva, devolução ao motorista e
-- tentativa sem sucesso"). Só acrescenta: nenhuma coluna existente muda.
--
--   "Tenant"."podProfile": o que a baixa do motorista exige. LIVRE (padrão:
--     foto e assinatura opcionais, como era), ECOMMERCE (foto da carga no
--     local) ou B2B (foto do canhoto assinado). Ver src/lib/comprovantes.ts.
--   "ProofOfDelivery": quem recebeu em relação ao destinatário
--     ("receiverRelation"), a ressalva do ato da entrega ("exceptionType" e
--     "exceptionNote") e a distância, em metros, entre a posição da baixa e a
--     coordenada do endereço ("distanceMeters"). Tudo nulo nos comprovantes
--     antigos. A coluna "photoBase64" continua existindo e sendo lida.
--   "ProofPhoto": as fotos por tipo (ENTREGA, CANHOTO, AVARIA, FACHADA), de um
--     comprovante ("proofId") ou de uma tentativa sem sucesso ("attemptId"),
--     com o SHA-256 dos bytes da imagem. Foto substituída num reenvio não é
--     apagada: fica com "replacedAt".
--   "ProofRejection": cada devolução de um comprovante ao motorista (quem,
--     quando, motivo) e quando ele respondeu ("resubmittedAt").
--   "DeliveryAttempt": tentativa de entrega sem sucesso, por carga, ligada ao
--     chamado que ela abre.
--
-- No fim, uma linha de "ProofRejection" é criada para cada comprovante que já
-- estava recusado: a recusa deixou de ser final, e é essa linha que o
-- motorista responde quando manda fotos novas.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa nas três tabelas novas e o gatilho que impede uma
-- foto, devolução ou tentativa de apontar para registro de outra empresa. Sem
-- isso elas ficam sem política.
-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "podProfile" TEXT NOT NULL DEFAULT 'LIVRE';

-- AlterTable
ALTER TABLE "ProofOfDelivery" ADD COLUMN     "distanceMeters" INTEGER,
ADD COLUMN     "exceptionNote" TEXT,
ADD COLUMN     "exceptionType" TEXT,
ADD COLUMN     "receiverRelation" TEXT;

-- CreateTable
CREATE TABLE "ProofPhoto" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "proofId" TEXT,
    "attemptId" TEXT,
    "kind" TEXT NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "ProofPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofRejection" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resubmittedAt" TIMESTAMP(3),

    CONSTRAINT "ProofRejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "manifestId" TEXT,
    "occurrenceId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "clientKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProofPhoto_tenantId_idx" ON "ProofPhoto"("tenantId");

-- CreateIndex
CREATE INDEX "ProofPhoto_proofId_idx" ON "ProofPhoto"("proofId");

-- CreateIndex
CREATE INDEX "ProofPhoto_attemptId_idx" ON "ProofPhoto"("attemptId");

-- CreateIndex
CREATE INDEX "ProofRejection_tenantId_idx" ON "ProofRejection"("tenantId");

-- CreateIndex
CREATE INDEX "ProofRejection_proofId_rejectedAt_idx" ON "ProofRejection"("proofId", "rejectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_occurrenceId_key" ON "DeliveryAttempt"("occurrenceId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_tenantId_idx" ON "DeliveryAttempt"("tenantId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_collectionId_createdAt_idx" ON "DeliveryAttempt"("collectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_tenantId_clientKey_key" ON "DeliveryAttempt"("tenantId", "clientKey");

-- AddForeignKey
ALTER TABLE "ProofPhoto" ADD CONSTRAINT "ProofPhoto_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "ProofOfDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofPhoto" ADD CONSTRAINT "ProofPhoto_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "DeliveryAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofPhoto" ADD CONSTRAINT "ProofPhoto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRejection" ADD CONSTRAINT "ProofRejection_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "ProofOfDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRejection" ADD CONSTRAINT "ProofRejection_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRejection" ADD CONSTRAINT "ProofRejection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Comprovantes já recusados ganham a devolução em aberto. Roda uma vez só: o
-- `NOT EXISTS` deixa repetir o arquivo sem duplicar.
INSERT INTO "ProofRejection" ("tenantId", "id", "proofId", "reason", "rejectedById", "rejectedAt")
SELECT p."tenantId", gen_random_uuid()::text, p."id", COALESCE(NULLIF(p."rejectionReason", ''), 'Comprovante recusado.'), p."reviewedById", COALESCE(p."reviewedAt", p."updatedAt")
  FROM "ProofOfDelivery" p
 WHERE p."status" = 'REJECTED'
   AND NOT EXISTS (SELECT 1 FROM "ProofRejection" r WHERE r."proofId" = p."id");

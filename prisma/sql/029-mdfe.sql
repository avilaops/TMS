-- Emissão de MDF-e (modelo 58, modal rodoviário, leiaute 3.00). Três tabelas novas:
--   "MdfeNumbering": o próximo número de cada série do MDF-e, por ambiente
--     (homologação e produção têm numerações separadas), como a do CT-e.
--   "Mdfe": cada MDF-e montado para uma viagem (um por UF de descarregamento),
--     com o XML enviado, a resposta da SEFAZ e, quando autorizado, o protocolo
--     e o mdfeProc; depois, o encerramento ou o cancelamento.
--   "MdfeEvent": cada evento que a SEFAZ registrou (cancelamento, encerramento,
--     inclusão de condutor, inclusão de DF-e), com o XML assinado e o retorno.
-- E colunas novas, todas opcionais ou com valor padrão:
--   "Vehicle": o que o MDF-e pede do veículo (RENAVAM, tara, tipo de rodado e
--     de carroceria, UF de licenciamento e, para veículo de terceiro, o
--     proprietário);
--   "FiscalIssuer": a série do MDF-e, o tipo de emitente e o seguro padrão da
--     carga.
-- Só acrescenta: nenhuma linha existente muda.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa nas três tabelas e o gatilho que impede um MDF-e de
-- apontar para viagem ou usuário de outra empresa. Sem isso as tabelas ficam
-- sem política.
-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "bodyType" TEXT,
ADD COLUMN     "licenseState" TEXT,
ADD COLUMN     "ownerIe" TEXT,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "ownerRntrc" TEXT,
ADD COLUMN     "ownerState" TEXT,
ADD COLUMN     "ownerTaxId" TEXT,
ADD COLUMN     "ownerType" TEXT,
ADD COLUMN     "renavam" TEXT,
ADD COLUMN     "tareKg" INTEGER,
ADD COLUMN     "wheelType" TEXT;

-- AlterTable
ALTER TABLE "FiscalIssuer" ADD COLUMN     "insurancePolicy" TEXT,
ADD COLUMN     "insurerName" TEXT,
ADD COLUMN     "insurerTaxId" TEXT,
ADD COLUMN     "mdfeEmitterType" TEXT NOT NULL DEFAULT '1',
ADD COLUMN     "mdfeSeries" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "MdfeNumbering" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "series" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MdfeNumbering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mdfe" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "series" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "accessKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "emitterType" TEXT NOT NULL,
    "loadState" TEXT NOT NULL,
    "unloadState" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "inputs" JSONB,
    "xmlSent" TEXT NOT NULL,
    "xmlReturn" TEXT,
    "protocol" TEXT,
    "statusCode" INTEGER,
    "statusReason" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeProtocol" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelProtocol" TEXT,
    "cancelReason" TEXT,
    "sendingAt" TIMESTAMP(3),
    "unanswered" BOOLEAN NOT NULL DEFAULT false,
    "numberBurned" BOOLEAN NOT NULL DEFAULT false,
    "closeReminderAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mdfe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MdfeEvent" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "mdfeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "xmlSent" TEXT NOT NULL,
    "xmlReturn" TEXT NOT NULL,
    "protocol" TEXT,
    "statusCode" INTEGER NOT NULL,
    "statusReason" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "details" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MdfeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MdfeNumbering_tenantId_idx" ON "MdfeNumbering"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MdfeNumbering_tenantId_environment_series_key" ON "MdfeNumbering"("tenantId", "environment", "series");

-- CreateIndex
CREATE INDEX "Mdfe_tenantId_idx" ON "Mdfe"("tenantId");

-- CreateIndex
CREATE INDEX "Mdfe_tenantId_manifestId_idx" ON "Mdfe"("tenantId", "manifestId");

-- CreateIndex
CREATE INDEX "Mdfe_manifestId_idx" ON "Mdfe"("manifestId");

-- CreateIndex
CREATE INDEX "Mdfe_status_authorizedAt_idx" ON "Mdfe"("status", "authorizedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mdfe_tenantId_accessKey_key" ON "Mdfe"("tenantId", "accessKey");

-- CreateIndex
CREATE UNIQUE INDEX "Mdfe_tenantId_environment_series_number_key" ON "Mdfe"("tenantId", "environment", "series", "number");

-- CreateIndex
CREATE INDEX "MdfeEvent_tenantId_idx" ON "MdfeEvent"("tenantId");

-- CreateIndex
CREATE INDEX "MdfeEvent_mdfeId_idx" ON "MdfeEvent"("mdfeId");

-- CreateIndex
CREATE UNIQUE INDEX "MdfeEvent_tenantId_mdfeId_type_sequence_key" ON "MdfeEvent"("tenantId", "mdfeId", "type", "sequence");

-- AddForeignKey
ALTER TABLE "MdfeNumbering" ADD CONSTRAINT "MdfeNumbering_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mdfe" ADD CONSTRAINT "Mdfe_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mdfe" ADD CONSTRAINT "Mdfe_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mdfe" ADD CONSTRAINT "Mdfe_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdfeEvent" ADD CONSTRAINT "MdfeEvent_mdfeId_fkey" FOREIGN KEY ("mdfeId") REFERENCES "Mdfe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdfeEvent" ADD CONSTRAINT "MdfeEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdfeEvent" ADD CONSTRAINT "MdfeEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


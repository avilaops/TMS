-- Emissão de CT-e (modelo 57, modal rodoviário, leiaute 4.00). Três tabelas novas:
--   "FiscalIssuer": os dados fiscais do emitente (uma linha por empresa, com os
--     parâmetros do ICMS e do IBS/CBS da Reforma Tributária) e o certificado
--     digital A1. O arquivo .pfx e a senha ficam CIFRADOS
--     (AES-256-GCM, chave derivada de TMS_CHAVE_DE_DADOS; src/lib/cifra.ts). Em
--     claro ficam só o titular, o CNPJ e a validade do certificado.
--   "CteNumbering": o próximo número de cada série, por ambiente (homologação e
--     produção têm numerações separadas).
--   "Cte": cada CT-e montado para uma carga, com o XML enviado, a resposta da
--     SEFAZ e, quando autorizado, o protocolo e o cteProc.
-- Só acrescenta: nenhuma linha existente muda.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa nas três tabelas e o gatilho que impede um CT-e de
-- apontar para carga ou usuário de outra empresa. Sem isso as tabelas ficam sem
-- política.

-- CreateTable
CREATE TABLE "FiscalIssuer" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "ie" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "district" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "phone" TEXT,
    "rntrc" TEXT NOT NULL,
    "taxRegime" TEXT NOT NULL,
    "cteSeries" INTEGER NOT NULL DEFAULT 1,
    "environment" TEXT NOT NULL DEFAULT 'HOMOLOGACAO',
    "cfopInState" TEXT NOT NULL,
    "cfopOutState" TEXT NOT NULL,
    "icmsCst" TEXT NOT NULL,
    "icmsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ibsCbsCst" TEXT,
    "ibsCbsClass" TEXT,
    "ibsStateRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "ibsCityRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cbsRate" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "pisRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cofinsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "certPfxEnc" TEXT,
    "certPasswordEnc" TEXT,
    "certSubject" TEXT,
    "certTaxId" TEXT,
    "certNotBefore" TIMESTAMP(3),
    "certNotAfter" TIMESTAMP(3),
    "certUploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalIssuer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CteNumbering" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "series" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CteNumbering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cte" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "series" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "accessKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "xmlSent" TEXT NOT NULL,
    "xmlReturn" TEXT,
    "protocol" TEXT,
    "statusCode" INTEGER,
    "statusReason" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "authorizedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelProtocol" TEXT,
    "cancelReason" TEXT,
    "cancelXml" TEXT,
    "sendingAt" TIMESTAMP(3),
    "unanswered" BOOLEAN NOT NULL DEFAULT false,
    "numberBurned" BOOLEAN NOT NULL DEFAULT false,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalIssuer_tenantId_key" ON "FiscalIssuer"("tenantId");

-- CreateIndex
CREATE INDEX "CteNumbering_tenantId_idx" ON "CteNumbering"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CteNumbering_tenantId_environment_series_key" ON "CteNumbering"("tenantId", "environment", "series");

-- CreateIndex
CREATE INDEX "Cte_tenantId_idx" ON "Cte"("tenantId");

-- CreateIndex
CREATE INDEX "Cte_tenantId_collectionId_idx" ON "Cte"("tenantId", "collectionId");

-- CreateIndex
CREATE INDEX "Cte_collectionId_idx" ON "Cte"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Cte_tenantId_accessKey_key" ON "Cte"("tenantId", "accessKey");

-- CreateIndex
CREATE UNIQUE INDEX "Cte_tenantId_environment_series_number_key" ON "Cte"("tenantId", "environment", "series", "number");

-- AddForeignKey
ALTER TABLE "FiscalIssuer" ADD CONSTRAINT "FiscalIssuer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CteNumbering" ADD CONSTRAINT "CteNumbering_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cte" ADD CONSTRAINT "Cte_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cte" ADD CONSTRAINT "Cte_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cte" ADD CONSTRAINT "Cte_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


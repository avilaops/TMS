-- Documentos fiscais: nota fiscal eletrônica importada pelo XML ("FiscalDocument"),
-- com o que o leitor extraiu, o XML original e a carga a que está ligada (opcional).
-- A chave de acesso é única por empresa.
-- Só acrescenta: uma tabela nova, nenhuma coluna alterada.
-- Depois deste arquivo, rode o 010-rls.sql de novo (`npm run db:rls`): é ele
-- que cria a política por empresa e o gatilho de referência da tabela nova.
-- CreateTable
CREATE TABLE "FiscalDocument" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "accessKey" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "series" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "operationNature" TEXT,
    "freightMode" INTEGER,
    "issuerTaxId" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "issuerCity" TEXT,
    "issuerState" TEXT,
    "issuerAddress" TEXT,
    "recipientTaxId" TEXT,
    "recipientName" TEXT,
    "recipientCity" TEXT,
    "recipientState" TEXT,
    "recipientAddress" TEXT,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "grossWeight" DOUBLE PRECISION,
    "volumes" INTEGER,
    "xml" TEXT NOT NULL,
    "collectionId" TEXT,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalDocument_tenantId_idx" ON "FiscalDocument"("tenantId");

-- CreateIndex
CREATE INDEX "FiscalDocument_tenantId_createdAt_idx" ON "FiscalDocument"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "FiscalDocument_collectionId_idx" ON "FiscalDocument"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_tenantId_accessKey_key" ON "FiscalDocument"("tenantId", "accessKey");

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


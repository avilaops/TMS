-- Subcontratação contratada: os documentos que a transportadora parceira
-- (a subcontratada) emitiu para uma viagem feita no veículo dela. Uma tabela
-- nova:
--   "SubcontractDocument": a chave de acesso (44 posições) e a data de emissão
--     do CT-e de subcontratação dela (ligado à carga, "collectionId") ou do
--     MDF-e dela (com a UF de descarregamento, "unloadState"), presos ao
--     contrato de frete da viagem ("FreightContract"). O sistema só guarda a
--     chave: não emite nem transmite nada em nome da subcontratada.
-- Só acrescenta: nenhuma tabela nem linha existente muda.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa na tabela e o gatilho que impede o documento de
-- apontar para contrato, carga ou usuário de outra empresa. Sem isso a tabela
-- fica sem política.

-- CreateTable
CREATE TABLE "SubcontractDocument" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accessKey" TEXT NOT NULL,
    "collectionId" TEXT,
    "unloadState" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubcontractDocument_tenantId_idx" ON "SubcontractDocument"("tenantId");

-- CreateIndex
CREATE INDEX "SubcontractDocument_contractId_idx" ON "SubcontractDocument"("contractId");

-- CreateIndex
CREATE INDEX "SubcontractDocument_collectionId_idx" ON "SubcontractDocument"("collectionId");

-- AddForeignKey
ALTER TABLE "SubcontractDocument" ADD CONSTRAINT "SubcontractDocument_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "FreightContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractDocument" ADD CONSTRAINT "SubcontractDocument_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractDocument" ADD CONSTRAINT "SubcontractDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractDocument" ADD CONSTRAINT "SubcontractDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Recebimento, conferência e depósito: posições do depósito ("WarehouseLocation"),
-- volumes conferidos de cada carga ("CollectionVolume") e a conferência
-- concluída ("WarehouseReceipt").
-- Só acrescenta: três tabelas novas, nenhuma coluna alterada.
-- Depois deste arquivo, rode o 010-rls.sql de novo (`npm run db:rls`): é ele
-- que cria a política por empresa e o gatilho de referência das tabelas novas.
-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionVolume" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "weight" DOUBLE PRECISION,
    "damageNote" TEXT,
    "locationId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionVolume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseReceipt" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "userId" TEXT,
    "concludedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedVolumes" INTEGER NOT NULL,
    "receivedVolumes" INTEGER NOT NULL,
    "damagedVolumes" INTEGER NOT NULL,
    "missingVolumes" INTEGER NOT NULL,
    "declaredWeight" DOUBLE PRECISION NOT NULL,
    "checkedWeight" DOUBLE PRECISION,
    "quantityDivergence" BOOLEAN NOT NULL DEFAULT false,
    "weightDivergence" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseLocation_tenantId_idx" ON "WarehouseLocation"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_tenantId_code_key" ON "WarehouseLocation"("tenantId", "code");

-- CreateIndex
CREATE INDEX "CollectionVolume_tenantId_idx" ON "CollectionVolume"("tenantId");

-- CreateIndex
CREATE INDEX "CollectionVolume_locationId_idx" ON "CollectionVolume"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionVolume_tenantId_code_key" ON "CollectionVolume"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionVolume_collectionId_sequence_key" ON "CollectionVolume"("collectionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseReceipt_collectionId_key" ON "WarehouseReceipt"("collectionId");

-- CreateIndex
CREATE INDEX "WarehouseReceipt_tenantId_idx" ON "WarehouseReceipt"("tenantId");

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionVolume" ADD CONSTRAINT "CollectionVolume_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionVolume" ADD CONSTRAINT "CollectionVolume_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionVolume" ADD CONSTRAINT "CollectionVolume_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionVolume" ADD CONSTRAINT "CollectionVolume_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tabelas de frete (FreightTable, FreightTableCity) e Client.freightTableId.
--
-- É o que `prisma migrate diff` gera entre o schema anterior e o desta mudança:
-- só acrescenta (duas tabelas, uma coluna anulável, índices e chaves). Foi
-- aplicado em produção em 08/10/2026, antes do deploy do código, seguido do
-- 010-rls.sql (política, permissões e gatilho das tabelas novas). Em banco novo
-- não é preciso: o `npm run db:push` já cria tudo.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "freightTableId" TEXT;

-- CreateTable
CREATE TABLE "FreightTable" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "includedWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "excessPerKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cubageFactor" DOUBLE PRECISION,
    "invoiceLimit" DOUBLE PRECISION,
    "adValoremPct" DOUBLE PRECISION,
    "maxVolumes" INTEGER,
    "redeliveryPct" DOUBLE PRECISION,
    "returnPct" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreightTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightTableCity" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "cityKey" TEXT NOT NULL,
    "minimum" DOUBLE PRECISION NOT NULL,
    "deadlineHours" INTEGER NOT NULL DEFAULT 24,
    "dedicated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FreightTableCity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FreightTable_tenantId_idx" ON "FreightTable"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FreightTable_tenantId_name_key" ON "FreightTable"("tenantId", "name");

-- CreateIndex
CREATE INDEX "FreightTableCity_tenantId_idx" ON "FreightTableCity"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FreightTableCity_tableId_cityKey_key" ON "FreightTableCity"("tableId", "cityKey");

-- CreateIndex
CREATE INDEX "Client_freightTableId_idx" ON "Client"("freightTableId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_freightTableId_fkey" FOREIGN KEY ("freightTableId") REFERENCES "FreightTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightTable" ADD CONSTRAINT "FreightTable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightTableCity" ADD CONSTRAINT "FreightTableCity_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "FreightTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightTableCity" ADD CONSTRAINT "FreightTableCity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


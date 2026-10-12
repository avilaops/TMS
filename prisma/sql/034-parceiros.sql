-- Parceiros de transporte (agregado, autônomo e transportadora) e frete
-- contratado por viagem. Três tabelas novas:
--   "Carrier": o cadastro do parceiro (tipo, nome, CPF ou CNPJ único por
--     empresa, RNTRC, IE, UF, contato, chave Pix e dados bancários) e a forma
--     padrão de contratação dele;
--   "FreightContract": o contrato de frete de uma viagem com o parceiro (um
--     por viagem), com o bruto, os acréscimos, os descontos, as retenções
--     digitadas e a situação;
--   "FreightPayment": cada pagamento do contrato (adiantamento ou saldo), com
--     o lançamento que criou no Financeiro.
-- E duas colunas novas, anuláveis:
--   "Vehicle"."carrierId" e "Driver"."carrierId": o veículo e o motorista do
--     parceiro. Com o veículo ligado a um parceiro, o MDF-e lê o proprietário
--     do cadastro dele; as colunas "owner*" do veículo continuam como estão.
-- Só acrescenta: nenhuma linha existente muda.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa nas três tabelas e o gatilho que impede veículo,
-- motorista, contrato ou pagamento de apontar para registro de outra empresa.
-- Sem isso as tabelas ficam sem política.

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "carrierId" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "carrierId" TEXT;

-- CreateTable
CREATE TABLE "Carrier" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT NOT NULL,
    "rntrc" TEXT,
    "ie" TEXT,
    "state" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "pixKey" TEXT,
    "bankInfo" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultCalcMode" TEXT,
    "defaultCalcBase" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightContract" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "calcMode" TEXT NOT NULL,
    "calcBase" DOUBLE PRECISION,
    "grossAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tollAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherAdditions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discounts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "irrf" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sestSenat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherWithholdings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreightContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightPayment" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "notes" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreightPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Carrier_tenantId_idx" ON "Carrier"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_tenantId_taxId_key" ON "Carrier"("tenantId", "taxId");

-- CreateIndex
CREATE UNIQUE INDEX "FreightContract_manifestId_key" ON "FreightContract"("manifestId");

-- CreateIndex
CREATE INDEX "FreightContract_tenantId_idx" ON "FreightContract"("tenantId");

-- CreateIndex
CREATE INDEX "FreightContract_carrierId_idx" ON "FreightContract"("carrierId");

-- CreateIndex
CREATE INDEX "FreightContract_tenantId_status_idx" ON "FreightContract"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FreightPayment_transactionId_key" ON "FreightPayment"("transactionId");

-- CreateIndex
CREATE INDEX "FreightPayment_tenantId_idx" ON "FreightPayment"("tenantId");

-- CreateIndex
CREATE INDEX "FreightPayment_contractId_idx" ON "FreightPayment"("contractId");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightContract" ADD CONSTRAINT "FreightContract_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightContract" ADD CONSTRAINT "FreightContract_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightContract" ADD CONSTRAINT "FreightContract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightPayment" ADD CONSTRAINT "FreightPayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "FreightContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightPayment" ADD CONSTRAINT "FreightPayment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightPayment" ADD CONSTRAINT "FreightPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

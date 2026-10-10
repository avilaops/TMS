-- Cobrança pelo Mercado Pago (ROADMAP, Fase 4): Pix dinâmico e boleto com baixa
-- automática. Duas tabelas novas:
--   "PaymentGateway": a conta do Mercado Pago de cada empresa. O Access Token e
--     o segredo de assinatura do webhook ficam CIFRADOS (AES-256-GCM, chave
--     derivada de TMS_CHAVE_DE_DADOS; src/lib/cifra.ts). Só os 4 últimos
--     caracteres ficam em claro, para a tela dizer qual credencial está lá.
--   "PaymentCharge": cada cobrança criada no gateway para uma fatura.
-- Só acrescenta: nenhuma linha existente muda.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa nas duas tabelas e o gatilho que impede uma cobrança
-- de apontar para fatura de outra empresa. Sem isso as tabelas ficam sem política.
-- CreateTable
CREATE TABLE "PaymentGateway" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MERCADO_PAGO',
    "accessTokenEnc" TEXT NOT NULL,
    "accessTokenEnd" TEXT NOT NULL,
    "webhookSecretEnc" TEXT NOT NULL,
    "webhookSecretEnd" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCharge" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MERCADO_PAGO',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "gatewayId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION,
    "pixCode" TEXT,
    "qrCodeBase64" TEXT,
    "ticketUrl" TEXT,
    "digitableLine" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGateway_tenantId_key" ON "PaymentGateway"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentCharge_tenantId_idx" ON "PaymentCharge"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentCharge_invoiceId_idx" ON "PaymentCharge"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentCharge_status_createdAt_idx" ON "PaymentCharge"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCharge_tenantId_gatewayId_key" ON "PaymentCharge"("tenantId", "gatewayId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCharge_tenantId_idempotencyKey_key" ON "PaymentCharge"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "PaymentGateway" ADD CONSTRAINT "PaymentGateway_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Conciliação bancária por extrato importado (ROADMAP, Fase 4): as linhas do
-- extrato OFX que o administrador envia ("BankStatementLine"), cada uma com o
-- lançamento do Financeiro com que foi conciliada.
-- Só acrescenta: uma tabela nova, nenhuma linha existente muda.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa na tabela e o gatilho que impede uma linha do
-- extrato de apontar para lançamento de outra empresa. Sem isso a tabela fica
-- sem política.
--
-- A linha é única por empresa + conta + identificador da movimentação no banco
-- ("fitId"): é o que deixa reenviar o mesmo extrato sem duplicar. Da conta ficam
-- só o fim do número ("account") e um resumo criptográfico ("accountKey").
-- Um lançamento casa com uma linha só ("transactionId" único); apagar o
-- lançamento solta a linha (ON DELETE SET NULL), que volta a pendente.
--
-- A roteirização por cidade, que veio junto, não mexe no banco: a tabela dos
-- municípios é um arquivo do repositório (src/data/municipios.json).

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "bankId" TEXT,
    "account" TEXT NOT NULL,
    "fitId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "kind" TEXT,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transactionId" TEXT,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_transactionId_key" ON "BankStatementLine"("transactionId");

-- CreateIndex
CREATE INDEX "BankStatementLine_tenantId_idx" ON "BankStatementLine"("tenantId");

-- CreateIndex
CREATE INDEX "BankStatementLine_tenantId_status_postedAt_idx" ON "BankStatementLine"("tenantId", "status", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_tenantId_accountKey_fitId_key" ON "BankStatementLine"("tenantId", "accountKey", "fitId");

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Equipe e fechamento do contas a receber (ROADMAP 1.16 e 1.12).
--
-- Equipe: tabelas "Helper" (ajudante), "Absence" (ausência de motorista ou de
-- ajudante) e "CrewAdvance" (adiantamento e acerto), e o percentual de comissão
-- do motorista ("Driver"."commissionPct").
-- Financeiro: juros, multa, desconto e valor recebido na baixa de um título, e
-- o centro de custo do lançamento ("FinancialTransaction"); multa e juros
-- sugeridos por empresa ("Tenant", padrão de 2% e 1% ao mês).
--
-- Só acrescenta: tabelas novas e colunas anuláveis ou com valor padrão.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa nas três tabelas novas e o gatilho que recusa
-- ausência ou adiantamento apontando para motorista, ajudante ou viagem de
-- outra empresa.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "lateFinePct" DOUBLE PRECISION NOT NULL DEFAULT 2,
ADD COLUMN     "lateInterestPct" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "commissionPct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "FinancialTransaction" ADD COLUMN     "costCenter" TEXT,
ADD COLUMN     "discount" DOUBLE PRECISION,
ADD COLUMN     "fine" DOUBLE PRECISION,
ADD COLUMN     "interest" DOUBLE PRECISION,
ADD COLUMN     "paidAmount" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Helper" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Helper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "driverId" TEXT,
    "helperId" TEXT,
    "type" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewAdvance" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "driverId" TEXT,
    "helperId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "manifestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "spentAmount" DOUBLE PRECISION,
    "settledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Helper_tenantId_idx" ON "Helper"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Helper_tenantId_cpf_key" ON "Helper"("tenantId", "cpf");

-- CreateIndex
CREATE INDEX "Absence_tenantId_idx" ON "Absence"("tenantId");

-- CreateIndex
CREATE INDEX "Absence_tenantId_startDate_endDate_idx" ON "Absence"("tenantId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "Absence_driverId_idx" ON "Absence"("driverId");

-- CreateIndex
CREATE INDEX "Absence_helperId_idx" ON "Absence"("helperId");

-- CreateIndex
CREATE INDEX "CrewAdvance_tenantId_idx" ON "CrewAdvance"("tenantId");

-- CreateIndex
CREATE INDEX "CrewAdvance_tenantId_status_idx" ON "CrewAdvance"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CrewAdvance_driverId_idx" ON "CrewAdvance"("driverId");

-- CreateIndex
CREATE INDEX "CrewAdvance_helperId_idx" ON "CrewAdvance"("helperId");

-- CreateIndex
CREATE INDEX "CrewAdvance_manifestId_idx" ON "CrewAdvance"("manifestId");

-- AddForeignKey
ALTER TABLE "Helper" ADD CONSTRAINT "Helper_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Helper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewAdvance" ADD CONSTRAINT "CrewAdvance_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewAdvance" ADD CONSTRAINT "CrewAdvance_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Helper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewAdvance" ADD CONSTRAINT "CrewAdvance_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewAdvance" ADD CONSTRAINT "CrewAdvance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Viagem completa, despesas e resultado (ROADMAP 1.6, 1.7 e 1.18).
--
-- "Manifest": ajudante, hodômetro de saída e de retorno, previsão de saída e
-- de retorno, observação, e as datas próprias da saída ("departedAt") e da
-- finalização ("finishedAt"). As duas ficam nulas nas viagens que já existem:
-- para elas o sistema segue usando "createdAt" como saída e "updatedAt" como
-- finalização. Nada é preenchido aqui.
-- "Collection": "manifestSequence", a ordem da entrega na viagem.
-- "TripExpense": despesa de viagem (pedágio, combustível, alimentação...),
-- lançada pelo painel ou pelo motorista e aprovada pelo administrador.
--
-- Só acrescenta: uma tabela nova e colunas anuláveis.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa na tabela nova e o gatilho que recusa despesa
-- apontando para viagem, usuário, abastecimento ou lançamento de outra empresa
-- (e viagem apontando para ajudante de outra empresa).

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "manifestSequence" INTEGER;

-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "departureOdometer" INTEGER,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "helperId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "plannedDepartureAt" TIMESTAMP(3),
ADD COLUMN     "plannedReturnAt" TIMESTAMP(3),
ADD COLUMN     "returnOdometer" INTEGER;

-- CreateTable
CREATE TABLE "TripExpense" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "liters" DOUBLE PRECISION,
    "odometer" INTEGER,
    "fuelingId" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripExpense_fuelingId_key" ON "TripExpense"("fuelingId");

-- CreateIndex
CREATE UNIQUE INDEX "TripExpense_transactionId_key" ON "TripExpense"("transactionId");

-- CreateIndex
CREATE INDEX "TripExpense_tenantId_idx" ON "TripExpense"("tenantId");

-- CreateIndex
CREATE INDEX "TripExpense_manifestId_idx" ON "TripExpense"("manifestId");

-- CreateIndex
CREATE INDEX "TripExpense_tenantId_status_idx" ON "TripExpense"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Helper"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_fuelingId_fkey" FOREIGN KEY ("fuelingId") REFERENCES "Fueling"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

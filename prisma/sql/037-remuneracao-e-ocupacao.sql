-- Remuneração variável da equipe de estrada e capacidade do veículo em volume
-- (src/lib/remuneracao.ts e src/lib/ocupacao.ts).
--
-- Colunas novas, todas anuláveis ou com valor padrão:
--   "Driver": "dailyRate", "perKmRate", "perDeliveryRate", "perTripRate" — as
--     formas de remuneração além da comissão ("commissionPct"): R$ por dia de
--     viagem, por km rodado, por entrega feita e fixo por viagem.
--   "Helper": "dailyRate", "perTripRate" — a diária e o fixo do ajudante.
--   "Vehicle": "cubicCapacity" — a cubagem útil, em m³, que a montagem da
--     viagem confere contra as cargas, junto com a capacidade em kg.
--   "Tenant": "driverPayVisible" — o aplicativo do motorista mostra a ele o
--     que as viagens renderam? Nasce desligado em toda empresa.
-- Uma tabela nova:
--   "CrewPayClosing": o fechamento mensal da remuneração variável de um
--     motorista ou de um ajudante, com os valores congelados, quem fechou e o
--     lançamento que fez no Financeiro. Um por pessoa e mês.
-- Só acrescenta: nenhuma linha existente muda.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa na tabela nova e o gatilho que impede o fechamento
-- de apontar para motorista, ajudante, usuário ou lançamento de outra empresa.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "driverPayVisible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "dailyRate" DOUBLE PRECISION,
ADD COLUMN     "perDeliveryRate" DOUBLE PRECISION,
ADD COLUMN     "perKmRate" DOUBLE PRECISION,
ADD COLUMN     "perTripRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "cubicCapacity" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Helper" ADD COLUMN     "dailyRate" DOUBLE PRECISION,
ADD COLUMN     "perTripRate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "CrewPayClosing" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "driverId" TEXT,
    "helperId" TEXT,
    "month" TEXT NOT NULL,
    "variableTotal" DOUBLE PRECISION NOT NULL,
    "advancesTotal" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "details" JSONB NOT NULL,
    "closedById" TEXT,
    "closedByName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionId" TEXT,

    CONSTRAINT "CrewPayClosing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrewPayClosing_transactionId_key" ON "CrewPayClosing"("transactionId");

-- CreateIndex
CREATE INDEX "CrewPayClosing_tenantId_idx" ON "CrewPayClosing"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CrewPayClosing_tenantId_driverId_month_key" ON "CrewPayClosing"("tenantId", "driverId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "CrewPayClosing_tenantId_helperId_month_key" ON "CrewPayClosing"("tenantId", "helperId", "month");

-- AddForeignKey
ALTER TABLE "CrewPayClosing" ADD CONSTRAINT "CrewPayClosing_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewPayClosing" ADD CONSTRAINT "CrewPayClosing_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "Helper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewPayClosing" ADD CONSTRAINT "CrewPayClosing_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewPayClosing" ADD CONSTRAINT "CrewPayClosing_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrewPayClosing" ADD CONSTRAINT "CrewPayClosing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

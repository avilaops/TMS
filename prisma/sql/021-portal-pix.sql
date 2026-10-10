-- Portal do cliente completo e cobrança por Pix (estático).
--
-- Tudo aditivo:
--  * "Tenant": a chave Pix da transportadora e o recebedor que vão no "Pix
--    Copia e Cola" (src/lib/pix.ts). Nulo = sem Pix.
--  * "Collection": dados do pedido de coleta (data e janela de horário,
--    prioridade, cubagem e observação). Carga antiga fica com prioridade NORMAL.
--  * "ClientReceiver": destinatários frequentes que o cliente cadastra pelo
--    portal. O isolamento por empresa (política e gatilho de mesma empresa)
--    vem de 010-rls.sql, reaplicado pelo `npm run db:push`.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "pixCity" TEXT,
ADD COLUMN     "pixKey" TEXT,
ADD COLUMN     "pixKeyType" TEXT,
ADD COLUMN     "pixName" TEXT;

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "cubicMeters" DOUBLE PRECISION,
ADD COLUMN     "pickupDate" TIMESTAMP(3),
ADD COLUMN     "pickupFrom" TEXT,
ADD COLUMN     "pickupNotes" TEXT,
ADD COLUMN     "pickupTo" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "ClientReceiver" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientReceiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientReceiver_tenantId_idx" ON "ClientReceiver"("tenantId");

-- CreateIndex
CREATE INDEX "ClientReceiver_tenantId_clientId_idx" ON "ClientReceiver"("tenantId", "clientId");

-- AddForeignKey
ALTER TABLE "ClientReceiver" ADD CONSTRAINT "ClientReceiver_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReceiver" ADD CONSTRAINT "ClientReceiver_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

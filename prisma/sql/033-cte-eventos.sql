-- Eventos do CT-e (leiaute 4.00). Uma tabela nova:
--   "CteEvent": cada evento que a SEFAZ registrou para um CT-e (carta de
--     correção 110110, cancelamento 110111, comprovante de entrega 110180 e o
--     cancelamento dele, 110181), no molde da "MdfeEvent": o XML assinado que
--     foi enviado, o retorno e o protocolo. `cancelledAt` só vale para o
--     comprovante de entrega: é quando a SEFAZ registrou o cancelamento dele.
--     O evento que a consulta pela chave devolveu e que o sistema não tinha
--     entra com "xmlSent" vazio e o procEventoCTe inteiro em "xmlReturn".
-- Só acrescenta: nenhuma linha existente muda. O cancelamento de CT-e feito
-- antes desta tabela continua só nas colunas "cancel*" da "Cte"; os novos
-- gravam nos dois lugares.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa na tabela e o gatilho que impede um evento de
-- apontar para CT-e ou usuário de outra empresa. Sem isso a tabela fica sem
-- política.

-- CreateTable
CREATE TABLE "CteEvent" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "cteId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "xmlSent" TEXT NOT NULL,
    "xmlReturn" TEXT NOT NULL,
    "protocol" TEXT,
    "statusCode" INTEGER NOT NULL,
    "statusReason" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "details" JSONB,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CteEvent_tenantId_idx" ON "CteEvent"("tenantId");

-- CreateIndex
CREATE INDEX "CteEvent_cteId_idx" ON "CteEvent"("cteId");

-- CreateIndex
CREATE UNIQUE INDEX "CteEvent_tenantId_cteId_type_sequence_key" ON "CteEvent"("tenantId", "cteId", "type", "sequence");

-- AddForeignKey
ALTER TABLE "CteEvent" ADD CONSTRAINT "CteEvent_cteId_fkey" FOREIGN KEY ("cteId") REFERENCES "Cte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CteEvent" ADD CONSTRAINT "CteEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CteEvent" ADD CONSTRAINT "CteEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

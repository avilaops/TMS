-- Atendimento e ocorrências: chamados ("Occurrence") com número sequencial por
-- empresa e a conversa de cada um ("OccurrenceMessage").
-- Só acrescenta: duas tabelas novas, nenhuma coluna alterada.
-- Depois deste arquivo, rode o 010-rls.sql de novo (`npm run db:rls`): é ele
-- que cria a política por empresa e o gatilho de referência das tabelas novas.
-- CreateTable
CREATE TABLE "Occurrence" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "collectionId" TEXT,
    "clientId" TEXT,
    "openedById" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'STAFF',
    "assigneeId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccurrenceMessage" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "authorId" TEXT,
    "fromClient" BOOLEAN NOT NULL DEFAULT false,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccurrenceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Occurrence_tenantId_idx" ON "Occurrence"("tenantId");

-- CreateIndex
CREATE INDEX "Occurrence_tenantId_status_idx" ON "Occurrence"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Occurrence_clientId_idx" ON "Occurrence"("clientId");

-- CreateIndex
CREATE INDEX "Occurrence_collectionId_idx" ON "Occurrence"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Occurrence_tenantId_number_key" ON "Occurrence"("tenantId", "number");

-- CreateIndex
CREATE INDEX "OccurrenceMessage_tenantId_idx" ON "OccurrenceMessage"("tenantId");

-- CreateIndex
CREATE INDEX "OccurrenceMessage_occurrenceId_createdAt_idx" ON "OccurrenceMessage"("occurrenceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceMessage" ADD CONSTRAINT "OccurrenceMessage_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceMessage" ADD CONSTRAINT "OccurrenceMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceMessage" ADD CONSTRAINT "OccurrenceMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


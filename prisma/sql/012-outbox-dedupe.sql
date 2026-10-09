-- Chave de evento único (o aviso de um título vencido sai uma vez só).
-- Depois deste arquivo, rode o 010-rls.sql de novo: ele cria o gatilho dos
-- avisos de fatura.
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

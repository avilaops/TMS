-- Campos opcionais; preserva os registros manuais existentes. Reaplicável.
-- Aplicar antes do código e executar npm run db:rls no ambiente de destino.
ALTER TABLE "SubcontractDocument"
  ADD COLUMN IF NOT EXISTS "xml" TEXT,
  ADD COLUMN IF NOT EXISTS "xmlImportedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "environment" TEXT,
  ADD COLUMN IF NOT EXISTS "protocol" TEXT,
  ADD COLUMN IF NOT EXISTS "sefazCode" INTEGER,
  ADD COLUMN IF NOT EXISTS "sefazReason" TEXT,
  ADD COLUMN IF NOT EXISTS "sefazProtocol" TEXT,
  ADD COLUMN IF NOT EXISTS "sefazCheckedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sefazRevision" INTEGER NOT NULL DEFAULT 0;

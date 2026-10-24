-- Execute com papel de migração, com backup, antes do deploy.
CREATE TABLE IF NOT EXISTS "DocumentDelivery" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
  "clientId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  "providerId" TEXT,
  "errorMessage" TEXT,
  "objectKey" TEXT,
  "checksumSha256" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  FOREIGN KEY ("clientId") REFERENCES "Client"(id) ON DELETE RESTRICT,
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT,
  UNIQUE ("tenantId","eventId","documentType","recipientEmail")
);
CREATE INDEX IF NOT EXISTS "DocumentDelivery_tenant_client_created_idx" ON "DocumentDelivery" ("tenantId","clientId","createdAt");
CREATE INDEX IF NOT EXISTS "DocumentDelivery_tenant_status_created_idx" ON "DocumentDelivery" ("tenantId",status,"createdAt");
ALTER TABLE "DocumentDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentDelivery" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "document_delivery_tenant" ON "DocumentDelivery";
CREATE POLICY "document_delivery_tenant" ON "DocumentDelivery"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

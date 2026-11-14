-- Aditivo e reaplicável. Não publica nenhum site automaticamente.
BEGIN;
CREATE TABLE IF NOT EXISTS "CarrierSite" (
  "tenantId" TEXT PRIMARY KEY DEFAULT current_setting('app.tenant_id'::text),
  "draft" JSONB NOT NULL,
  "published" JSONB,
  "publishedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarrierSite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "CarrierSite" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CarrierSite";
CREATE POLICY tenant_isolation ON "CarrierSite" TO tms_app
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "CarrierSite" TO tms_app;
COMMIT;

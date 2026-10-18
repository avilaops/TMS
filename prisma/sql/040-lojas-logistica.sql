-- Persistência da integração Lojas. O db push cria estas tabelas em bancos
-- novos; este script idempotente atualiza instalações existentes.

CREATE TABLE IF NOT EXISTS "LojasIntegrationCredential" (
  "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "keyHash" TEXT NOT NULL,
  "keyLast4" TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId"),
  UNIQUE ("keyHash"),
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "LogisticsOrder" (
  "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "externalId" TEXT NOT NULL,
  "clientId" TEXT,
  mode TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'QUOTED',
  direction TEXT NOT NULL DEFAULT 'OUTBOUND',
  rma TEXT,
  "reverseOfId" TEXT,
  payload JSONB NOT NULL,
  quote JSONB,
  "quotedAmount" DOUBLE PRECISION,
  "quotedDeadline" INTEGER,
  inspection JSONB,
  "inspectedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "externalId"),
  UNIQUE ("tenantId", rma),
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("clientId") REFERENCES "Client"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY ("reverseOfId") REFERENCES "LogisticsOrder"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "LogisticsShipment" (
  "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "orderId" TEXT NOT NULL,
  "collectionId" TEXT UNIQUE,
  "externalId" TEXT NOT NULL,
  "originKey" TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  "promisedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "externalId"),
  UNIQUE ("orderId", "originKey"),
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("orderId") REFERENCES "LogisticsOrder"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("collectionId") REFERENCES "Collection"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "IntegrationRequest" (
  "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "credentialId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  "responseStatus" INTEGER,
  "responseBody" JSONB,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "idempotencyKey"),
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("credentialId") REFERENCES "LojasIntegrationCredential"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "LogisticsOrder_tenantId_state_idx" ON "LogisticsOrder"("tenantId", state);
CREATE INDEX IF NOT EXISTS "LogisticsShipment_tenantId_state_idx" ON "LogisticsShipment"("tenantId", state);
CREATE INDEX IF NOT EXISTS "IntegrationRequest_tenantId_status_idx" ON "IntegrationRequest"("tenantId", status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lojas_logistics_mode_check') THEN
    ALTER TABLE "LogisticsOrder" ADD CONSTRAINT lojas_logistics_mode_check
      CHECK (mode IN ('CIF', 'FOB', 'PICKUP', 'OWN_CARRIER'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lojas_logistics_order_state_check') THEN
    ALTER TABLE "LogisticsOrder" ADD CONSTRAINT lojas_logistics_order_state_check
      CHECK (state IN ('QUOTED', 'CONFIRMED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED', 'PARTIAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lojas_integration_request_status_check') THEN
    ALTER TABLE "IntegrationRequest" ADD CONSTRAINT lojas_integration_request_status_check
      CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED'));
  END IF;
END $$;

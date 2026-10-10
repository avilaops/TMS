-- Roteirização por endereço, mapa e GPS do motorista (ROADMAP: "Roteirização
-- por endereço, mapa e GPS do motorista com OpenStreetMap"). Só acrescenta:
-- nenhuma linha existente muda.
--
--   "Collection": o endereço da entrega além da cidade (logradouro, número,
--     bairro e CEP, todos opcionais) e a coordenada dele, achada em segundo
--     plano (src/lib/geo-db.ts). "geoSource": ADDRESS = achou o endereço;
--     NONE = procurou e não achou; nulo = ainda não procurada.
--   "Manifest": a última posição que o motorista compartilhou pelo app.
--   "TripPosition": histórico enxuto das posições de uma viagem (no máximo 500
--     pontos por viagem; os mais antigos saem).
--   "GeoCache": cache da localização de endereços. NÃO tem "tenantId" de
--     propósito: é dado público e o cache é do sistema. Guarda só o texto
--     normalizado do endereço e a coordenada.
--
-- Rode depois dela o `npm run db:rls` (prisma/sql/010-rls.sql): é ele que liga
-- o isolamento por empresa em "TripPosition", o gatilho que impede uma posição
-- de apontar para viagem de outra empresa, e que tira do papel da aplicação
-- qualquer acesso ao "GeoCache". Sem isso "TripPosition" fica sem política.
-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "deliveryDistrict" TEXT,
ADD COLUMN     "deliveryLat" DOUBLE PRECISION,
ADD COLUMN     "deliveryLon" DOUBLE PRECISION,
ADD COLUMN     "deliveryNumber" TEXT,
ADD COLUMN     "deliveryStreet" TEXT,
ADD COLUMN     "deliveryZip" TEXT,
ADD COLUMN     "geoAt" TIMESTAMP(3),
ADD COLUMN     "geoSource" TEXT;

-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN     "lastAccuracy" DOUBLE PRECISION,
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLon" DOUBLE PRECISION,
ADD COLUMN     "lastPositionAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TripPosition" (
    "tenantId" TEXT NOT NULL DEFAULT current_setting('app.tenant_id'::text),
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoCache" (
    "key" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "TripPosition_tenantId_idx" ON "TripPosition"("tenantId");

-- CreateIndex
CREATE INDEX "TripPosition_manifestId_recordedAt_idx" ON "TripPosition"("manifestId", "recordedAt");

-- AddForeignKey
ALTER TABLE "TripPosition" ADD CONSTRAINT "TripPosition_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPosition" ADD CONSTRAINT "TripPosition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

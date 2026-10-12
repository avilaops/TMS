-- Redespacho e subcontratação no CT-e (leiaute 4.00). Colunas novas na carga
-- ("Collection"), todas opcionais ou com padrão:
--   "serviceType": o tipo de serviço do CT-e da carga (NORMAL, SUBCONTRACT,
--     REDISPATCH, INTERMEDIATE: o `tpServ` 0, 1, 2 e 3). Toda carga existente
--     fica NORMAL, que é o que ela já era.
--   "previousCteKey": a chave do CT-e da transportadora que contratou esta
--     (o documento de transporte anterior, `docAnt`).
--   "shipper*": o expedidor (`exped`), quem entrega a carga à transportadora.
--   "consignee*": o recebedor (`receb`), quem a recebe dela.
-- Só acrescenta: nenhuma linha existente muda e nenhuma tabela nova nasce
-- (prisma/sql/010-rls.sql não muda). Ver src/lib/redespacho.ts.

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "consigneeCity" TEXT,
ADD COLUMN     "consigneeDistrict" TEXT,
ADD COLUMN     "consigneeDocument" TEXT,
ADD COLUMN     "consigneeIe" TEXT,
ADD COLUMN     "consigneeName" TEXT,
ADD COLUMN     "consigneeNumber" TEXT,
ADD COLUMN     "consigneeStreet" TEXT,
ADD COLUMN     "consigneeZip" TEXT,
ADD COLUMN     "previousCteKey" TEXT,
ADD COLUMN     "serviceType" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "shipperCity" TEXT,
ADD COLUMN     "shipperDistrict" TEXT,
ADD COLUMN     "shipperDocument" TEXT,
ADD COLUMN     "shipperIe" TEXT,
ADD COLUMN     "shipperName" TEXT,
ADD COLUMN     "shipperNumber" TEXT,
ADD COLUMN     "shipperStreet" TEXT,
ADD COLUMN     "shipperZip" TEXT;

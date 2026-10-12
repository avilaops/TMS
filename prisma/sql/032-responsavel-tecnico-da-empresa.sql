-- Responsável técnico (infRespTec) do CT-e e do MDF-e: passa a ser a empresa
-- cadastrada em Empresa > Fiscal. CNPJ e telefone já existem; entram o nome da
-- pessoa de contato e o e-mail. Colunas novas, anuláveis.
ALTER TABLE "FiscalIssuer" ADD COLUMN "contactName" TEXT;
ALTER TABLE "FiscalIssuer" ADD COLUMN "contactEmail" TEXT;

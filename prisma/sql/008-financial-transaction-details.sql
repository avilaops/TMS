-- Financeiro: quando e como o lançamento foi pago, categoria, fornecedor e observação.
--
-- É o que `prisma migrate diff` gera entre o schema anterior e o desta mudança:
-- cinco colunas anuláveis em FinancialTransaction, sem tabela nem chave nova (o
-- 010-rls.sql não muda). Aplicado em produção em 09/10/2026, antes do deploy do
-- código. Em banco novo não é preciso: o `npm run db:push` já cria tudo.

-- AlterTable
ALTER TABLE "FinancialTransaction" ADD COLUMN     "category" TEXT,
ADD COLUMN     "counterparty" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethod" TEXT;

-- Perfis de acesso da equipe: Diretoria, Financeiro, Comercial, Expedição e
-- Conferência (enum "Role"). O que cada perfil pode fazer não está no banco:
-- está em src/lib/permissoes.ts.
--
-- Só acrescenta valores ao enum; nenhuma linha muda e nenhum usuário troca de
-- perfil. `IF NOT EXISTS` deixa o arquivo rodar mais de uma vez.
--
-- Pode ser aplicado em transação única (`psql -1 -f`), como os outros: no
-- PostgreSQL 12 em diante o `ALTER TYPE ... ADD VALUE` roda dentro de
-- transação, desde que o valor novo não seja USADO antes do COMMIT. Por isso
-- este arquivo não tem mais nada: nem UPDATE, nem DEFAULT, nem política que
-- cite os valores novos. Não acrescente aqui nada que os use.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DIRECTOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FINANCE';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMMERCIAL';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'EXPEDITION';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'WAREHOUSE';

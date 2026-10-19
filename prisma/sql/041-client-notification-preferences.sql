-- Execute em janela de manutenção, antes de liberar a nova API.
-- Ajuste o schema caso a instalação use nome diferente de public.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "notificationRecipients" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "notificationPreferences" JSONB NOT NULL DEFAULT '{}'::jsonb;

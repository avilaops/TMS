-- Símbolo da empresa (tenant), escolhido pelo administrador em /dashboard/empresa.
-- Guardado como data URL de imagem pequena (PNG, JPEG ou WebP), como as fotos
-- do comprovante. Nulo = o símbolo padrão do sistema.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "logo" TEXT;

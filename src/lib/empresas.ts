import { sistema } from "@/lib/prisma";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Slug de empresa: minúsculas, números e hífen, de 1 a 40 caracteres. */
export function normalizarSlug(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const slug = valor.trim().toLowerCase();
  return SLUG.test(slug) ? slug : null;
}

/**
 * Empresa de uma rota pública (cotação e lead vindos de um site), que não tem
 * sessão para dizer de quem é.
 *
 * Vale o slug informado na requisição; sem ele, o de TMS_EMPRESA_PADRAO, que
 * mantém funcionando o site que já chamava estas rotas antes de o sistema ter
 * mais de uma empresa. Devolve o id, ou null se a empresa não existe ou está
 * desativada: quem chama responde 404 sem gravar nada.
 */
export async function empresaPublica(informado?: unknown): Promise<string | null> {
  const slug = normalizarSlug(informado) ?? normalizarSlug(process.env.TMS_EMPRESA_PADRAO);
  if (!slug) return null;

  const empresa = await sistema.tenant.findUnique({
    where: { slug },
    select: { id: true, active: true },
  });

  return empresa?.active ? empresa.id : null;
}

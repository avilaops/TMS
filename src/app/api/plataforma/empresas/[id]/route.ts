import { NextResponse } from "next/server";
import { paraEmpresa, sistema } from "@/lib/prisma";
import { alterarEmpresaSchema, EMPRESA_SELECT, requireEquipe } from "@/lib/plataforma";
import { atorDaPlataforma, nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from "@/lib/auditoria";

/**
 * Altera o nome ou ativa/desativa uma empresa. Desativar não apaga nada: só
 * impede a entrada (a busca do login ignora empresa desativada) e as rotas
 * públicas dela. O identificador não muda depois de criado.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { conta, error } = await requireEquipe();
  if (error) return error;

  const { id } = await params;
  const parsed = alterarEmpresaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }

  const existe = await sistema.tenant.findUnique({ where: { id }, select: { slug: true, name: true, active: true } });
  if (!existe) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });

  const empresa = await sistema.tenant.update({ where: { id }, data: parsed.data, select: EMPRESA_SELECT });
  console.info(`Plataforma: empresa ${existe.slug} alterada por ${conta.email}: ${JSON.stringify(parsed.data)}.`);

  // A linha fica na trilha da empresa afetada, com a conta da plataforma como autora.
  const antes = { name: existe.name, active: existe.active };
  const depois = { name: empresa.name, active: empresa.active };
  if (!nadaMudou(antes, depois)) {
    await registrarAuditoriaDepois(paraEmpresa(id).db, {
      ator: atorDaPlataforma(conta),
      origem: origemDaRequisicao(req),
      acao: "empresa.alterar",
      entidade: "empresa",
      entidadeId: id,
      resumo:
        antes.active !== depois.active
          ? `Empresa ${empresa.name} ${depois.active ? "reativada" : "desativada"} pela plataforma`
          : `Empresa ${empresa.name} alterada pela plataforma`,
      antes,
      depois,
    });
  }
  return NextResponse.json(empresa);
}

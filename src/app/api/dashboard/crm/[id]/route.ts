import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { LEAD_INCLUDE, LEAD_LOCKED_MESSAGE, LEAD_NOT_FOUND_MESSAGE, updateLeadSchema } from "@/lib/crm";
import { firstIssue } from "@/lib/usuarios";
import { nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from "@/lib/auditoria";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireStaff({ pode: "crm" });
    if (error) return error;

    const { id } = await params;
    const parsed = updateLeadSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { status, estimatedValue } = parsed.data;

    // Como estava, para a auditoria. Lead que não existe segue adiante e cai no 404 de sempre.
    const anterior = await prisma.quoteLead.findUnique({ where: { id }, select: { status: true, estimatedValue: true, companyName: true } });

    // A condição vai no próprio UPDATE: uma conversão em curso segura a linha,
    // e quando ela termina este UPDATE já não encontra o lead aberto.
    const { count } = await prisma.quoteLead.updateMany({
      where: { id, status: { not: "CONVERTED" } },
      data: {
        ...(status !== undefined && { status }),
        ...(estimatedValue !== undefined && { estimatedValue }),
      },
    });

    const lead = await prisma.quoteLead.findUnique({ where: { id }, include: LEAD_INCLUDE });
    // Lead de outra empresa não aparece para esta: mesma resposta do inexistente.
    if (!lead) {
      return NextResponse.json({ error: LEAD_NOT_FOUND_MESSAGE }, { status: 404 });
    }
    if (count === 0) {
      return NextResponse.json({ error: LEAD_LOCKED_MESSAGE }, { status: 409 });
    }

    if (anterior) {
      const antes = { status: anterior.status, estimatedValue: anterior.estimatedValue };
      const depois = { status: lead.status, estimatedValue: lead.estimatedValue };
      if (!nadaMudou(antes, depois)) {
        await registrarAuditoriaDepois(prisma, {
          ator: user,
          origem: origemDaRequisicao(req),
          acao: "cotacao.alterar",
          entidade: "cotacao",
          entidadeId: id,
          resumo: `Cotação de ${anterior.companyName} alterada`,
          antes,
          depois,
        });
      }
    }

    return NextResponse.json(lead);
  } catch (error) {
    console.error("Erro ao atualizar lead:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar lead." }, { status: 500 });
  }
}

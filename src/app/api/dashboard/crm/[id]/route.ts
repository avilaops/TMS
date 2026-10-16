import { NextResponse } from "next/server";
import { transacao } from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { ASSIGNEE_MESSAGE, LEAD_INCLUDE, LEAD_LOCKED_MESSAGE, LEAD_NOT_FOUND_MESSAGE, updateLeadSchema } from "@/lib/crm";
import { DA_EQUIPE_COMERCIAL } from "@/lib/crm-db";
import { firstIssue } from "@/lib/usuarios";
import { Refusal } from "@/lib/cadastros";
import { nadaMudou, origemDaRequisicao, registrarAuditoria } from "@/lib/auditoria";

// O que a auditoria compara, antes e depois.
const CAMPOS = { status: true, estimatedValue: true, assigneeId: true, lostReason: true } as const;

/**
 * Altera uma cotação do funil: status, valor estimado, responsável, motivo da
 * perda, ou só registra que alguém falou com o cliente (`contato: true`).
 *
 * Trocar o status e registrar contato renovam a última atividade, que é o que
 * tira a cotação de "parada". O motivo da perda só fica com status Perdida:
 * sair de Perdidos apaga o motivo. Cotação convertida não muda mais (409).
 */
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
    const { status, estimatedValue, assigneeId, lostReason, contato } = parsed.data;
    const origem = origemDaRequisicao(req);

    const resultado = await transacao(async (tx) => {
      // Como estava, para a auditoria e para a regra do motivo. Lead de outra
      // empresa não aparece para esta: mesma resposta do inexistente.
      const anterior = await tx.quoteLead.findUnique({ where: { id }, select: { ...CAMPOS, companyName: true } });
      if (!anterior) throw new Refusal(LEAD_NOT_FOUND_MESSAGE, 404);
      if (anterior.status === "CONVERTED") throw new Refusal(LEAD_LOCKED_MESSAGE, 409);

      if (assigneeId) {
        // Usuário de outra empresa não aparece nesta: cai no mesmo 400.
        const responsavel = await tx.user.findFirst({ where: { id: assigneeId, ...DA_EQUIPE_COMERCIAL }, select: { id: true } });
        if (!responsavel) throw new Refusal(ASSIGNEE_MESSAGE, 400);
      }

      const statusFinal = status ?? anterior.status;
      const motivo = statusFinal === "LOST" ? (lostReason === undefined ? anterior.lostReason : lostReason) : null;
      const mexeuNoCliente = contato === true || (status !== undefined && status !== anterior.status);

      // A condição vai no próprio UPDATE: uma conversão em curso segura a linha,
      // e quando ela termina este UPDATE já não encontra o lead aberto.
      const { count } = await tx.quoteLead.updateMany({
        where: { id, status: { not: "CONVERTED" } },
        data: {
          ...(status !== undefined && { status }),
          ...(estimatedValue !== undefined && { estimatedValue }),
          ...(assigneeId !== undefined && { assigneeId }),
          ...(motivo !== anterior.lostReason && { lostReason: motivo }),
          ...(mexeuNoCliente && { lastActivityAt: new Date() }),
        },
      });
      if (count === 0) throw new Refusal(LEAD_LOCKED_MESSAGE, 409);

      const lead = await tx.quoteLead.findUniqueOrThrow({ where: { id }, include: LEAD_INCLUDE });

      const antes = { status: anterior.status, estimatedValue: anterior.estimatedValue, assigneeId: anterior.assigneeId, lostReason: anterior.lostReason };
      const depois = { status: lead.status, estimatedValue: lead.estimatedValue, assigneeId: lead.assigneeId, lostReason: lead.lostReason };
      if (!nadaMudou(antes, depois)) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: "cotacao.alterar",
          entidade: "cotacao",
          entidadeId: id,
          resumo: `Cotação de ${anterior.companyName} alterada`,
          antes,
          depois,
        });
      } else if (contato) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: "cotacao.contato",
          entidade: "cotacao",
          entidadeId: id,
          resumo: `Contato com ${anterior.companyName} registrado`,
        });
      }

      return lead;
    });

    return NextResponse.json(resultado);
  } catch (error) {
    if (error instanceof Refusal) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Erro ao atualizar lead:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar lead." }, { status: 500 });
  }
}

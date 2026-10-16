import { NextResponse } from "next/server";
import prisma, { transacao } from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { LEAD_INCLUDE, ASSIGNEE_MESSAGE, createLeadSchema, filtrosDaLista, ondeDaLista } from "@/lib/crm";
import { DA_EQUIPE_COMERCIAL, criarCotacao } from "@/lib/crm-db";
import { calcularFrete, tabelaVigente } from "@/lib/frete";
import { firstIssue } from "@/lib/usuarios";
import { Refusal } from "@/lib/cadastros";
import { origemDaRequisicao, registrarAuditoria } from "@/lib/auditoria";

/**
 * Cotações da empresa, da mais nova para a mais antiga. Os filtros
 * (`?status=&dias=&assigneeId=&busca=`, src/lib/crm.ts) valem para a lista;
 * sem nenhum, vem tudo, que é o que o funil mostra.
 */
export async function GET(req?: Request) {
  try {
    const { error } = await requireStaff({ pode: "crm" });
    if (error) return error;

    const filtros = filtrosDaLista(req ? new URL(req.url).searchParams : new URLSearchParams());
    const leads = await prisma.quoteLead.findMany({
      where: ondeDaLista(filtros),
      include: LEAD_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(leads);
  } catch (error) {
    console.error("Erro ao listar cotações:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * Cotação registrada pela equipe: o pedido que chegou por WhatsApp, telefone
 * ou e-mail entra no mesmo funil do site, com o próximo número da empresa. O
 * valor estimado sai da tabela padrão, como no pedido do site; sem tabela, ou
 * com a cidade fora dela, fica sem valor para o comercial preencher. Sem
 * responsável informado, fica com quem registrou.
 */
export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: "crm" });
  if (error) return error;

  try {
    const parsed = createLeadSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);
    const volumes = data.volumes ?? 1;

    const lead = await transacao(async (tx) => {
      const assigneeId = data.assigneeId === undefined ? user.id : data.assigneeId;
      if (assigneeId) {
        // Usuário de outra empresa não aparece nesta: cai no mesmo 400.
        const responsavel = await tx.user.findFirst({ where: { id: assigneeId, ...DA_EQUIPE_COMERCIAL }, select: { id: true } });
        if (!responsavel) throw new Refusal(ASSIGNEE_MESSAGE, 400);
      }

      const tabela = await tabelaVigente(tx);
      const frete = tabela
        ? calcularFrete(tabela, data.destination, { peso: data.weight, volumes, valorNota: data.invoiceValue })
        : null;

      const criada = await criarCotacao(
        tx,
        {
          companyName: data.companyName,
          email: data.email ?? "",
          phone: data.phone ?? "",
          origin: data.origin,
          destination: data.destination,
          volumes,
          weight: data.weight,
          invoiceValue: data.invoiceValue ?? null,
          estimatedValue: frete?.atendida ? frete.valor : null,
          channel: data.channel,
          assigneeId,
        },
        { id: true, number: true },
      );

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: "cotacao.registrar",
        entidade: "cotacao",
        entidadeId: criada.id,
        resumo: `Cotação nº ${criada.number} registrada para ${data.companyName}`,
        depois: {
          number: criada.number,
          companyName: data.companyName,
          channel: data.channel,
          origin: data.origin,
          destination: data.destination,
          volumes,
          weight: data.weight,
          invoiceValue: data.invoiceValue ?? null,
          assigneeId,
        },
      });

      return tx.quoteLead.findUniqueOrThrow({ where: { id: criada.id }, include: LEAD_INCLUDE });
    });

    return NextResponse.json(lead, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Erro ao registrar cotação:", err);
    return NextResponse.json({ error: "Erro interno ao registrar a cotação." }, { status: 500 });
  }
}

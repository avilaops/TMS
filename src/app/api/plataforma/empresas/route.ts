import { NextResponse } from "next/server";
import { sistema } from "@/lib/prisma";
import { criarEmpresaSchema, EMPRESA_SELECT, requireEquipe } from "@/lib/plataforma";
import { liberarAcesso, senhaSemUso } from "@/lib/acessos";

// Cadastro de empresas (tenants). Roda pelo caminho de sistema porque é
// justamente o que existe acima das empresas; quem protege é `requireEquipe`.

export async function GET() {
  const { error } = await requireEquipe();
  if (error) return error;

  const empresas = await sistema.tenant.findMany({ select: EMPRESA_SELECT, orderBy: { name: "asc" } });
  return NextResponse.json(empresas);
}

export async function POST(req: Request) {
  const { conta, error } = await requireEquipe();
  if (error) return error;

  const parsed = criarEmpresaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }
  const data = parsed.data;

  const repetida = await sistema.tenant.findFirst({
    where: { OR: [{ slug: data.slug }, ...(data.cnpj ? [{ cnpj: data.cnpj }] : [])] },
    select: { slug: true },
  });
  if (repetida) {
    return NextResponse.json(
      { error: repetida.slug === data.slug ? "Já existe empresa com este identificador." : "Já existe empresa com este CNPJ." },
      { status: 409 },
    );
  }

  try {
    const empresa = await sistema.$transaction(async (tx) => {
      const criada = await tx.tenant.create({
        data: { slug: data.slug, name: data.name, cnpj: data.cnpj ?? null },
        select: { id: true },
      });
      await tx.user.create({
        data: { tenantId: criada.id, name: data.adminName, email: data.adminEmail, role: "ADMIN", password: senhaSemUso() },
      });
      return tx.tenant.findUniqueOrThrow({ where: { id: criada.id }, select: EMPRESA_SELECT });
    });

    console.info(`Plataforma: empresa ${data.slug} criada por ${conta.email}.`);

    // O administrador entra pelo login único: garante a conta lá e libera o TMS.
    const acesso = await liberarAcesso({ email: data.adminEmail, nome: data.adminName });
    return NextResponse.json({ ...empresa, acesso }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Já existe empresa com este identificador ou CNPJ." }, { status: 409 });
    }
    console.error("Erro ao criar empresa:", err);
    return NextResponse.json({ error: "Erro interno ao criar a empresa." }, { status: 500 });
  }
}

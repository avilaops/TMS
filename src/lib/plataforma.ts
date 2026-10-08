import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions, type ContaAvilaOps } from "@/lib/auth";

/**
 * Conta do login único de quem fez a requisição, para as rotas que valem antes
 * de haver empresa (escolha de empresa e plataforma). Sem ela → 401.
 */
export async function requireConta(): Promise<
  { conta: ContaAvilaOps; equipe: boolean; error: null } | { conta: null; equipe: false; error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();

  if (!session?.user || !email) {
    return { conta: null, equipe: false, error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }

  const equipe = session.user.equipe === true;
  return {
    conta: { email, nome: session.user.name ?? email, papel: equipe ? "ADMIN" : "CLIENTE" },
    equipe,
    error: null,
  };
}

/**
 * Rotas da plataforma (cadastro de empresas): só a equipe da Ávila Ops, que é
 * quem o auth marca com o papel ADMIN. Administrador de uma transportadora não
 * é equipe: ele administra a empresa dele, não a plataforma.
 */
export async function requireEquipe() {
  const resultado = await requireConta();
  if (resultado.error) return resultado;
  if (!resultado.equipe) {
    return { conta: null, equipe: false as const, error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }) };
  }
  return resultado;
}

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "Identificador: só minúsculas, números e hífen, de 1 a 40 caracteres.");
const nome = z.string().trim().min(2, "Informe o nome da empresa.").max(160);
const cnpj = z
  .string()
  .transform((v) => v.replace(/\D/g, ""))
  .pipe(z.string().regex(/^\d{14}$/, "CNPJ precisa ter 14 dígitos."))
  .nullish()
  .or(z.literal("").transform(() => null));

export const criarEmpresaSchema = z.object({
  slug,
  name: nome,
  cnpj,
  // Primeiro administrador da empresa. Ele entra pelo login único: precisa ter
  // conta no auth com este e-mail e estar liberado para o TMS.
  adminName: z.string().trim().min(2, "Informe o nome do administrador.").max(120),
  adminEmail: z.string().trim().toLowerCase().max(254).pipe(z.email("E-mail do administrador inválido.")),
});

export const alterarEmpresaSchema = z
  .object({ name: nome.optional(), active: z.boolean().optional() })
  .refine((d) => d.name !== undefined || d.active !== undefined, { message: "Informe o que alterar." });

export const EMPRESA_SELECT = {
  id: true,
  slug: true,
  name: true,
  cnpj: true,
  active: true,
  createdAt: true,
  _count: { select: { users: true, clients: true, collections: true } },
} as const;

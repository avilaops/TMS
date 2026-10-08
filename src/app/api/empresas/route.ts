import { NextResponse } from "next/server";
import { empresasDaConta } from "@/lib/auth";
import { requireConta } from "@/lib/plataforma";

/** Empresas em que a conta logada pode entrar (tela /empresa). */
export async function GET() {
  const { conta, equipe, error } = await requireConta();
  if (error) return error;

  return NextResponse.json({ equipe, empresas: await empresasDaConta(conta) });
}

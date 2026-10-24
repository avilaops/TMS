import { NextResponse } from "next/server";
import { cteParaLojas } from "@/lib/cte-integracao-lojas";
import { autenticarLojas, CredencialLojasInvalida } from "@/lib/lojas-logistica-auth";
import { paraEmpresa } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contexto: { params: Promise<{ empresa: string }> }) {
  const empresa = (await contexto.params).empresa;
  try {
    const { tenantId } = await autenticarLojas(request, empresa);
    const paginaInformada = Number(new URL(request.url).searchParams.get("pagina") ?? "1");
    const pagina = Number.isSafeInteger(paginaInformada) ? Math.min(10_000, Math.max(1, paginaInformada)) : 1;
    const limite = 50;
    const db = paraEmpresa(tenantId).db;
    const [total, documentos] = await Promise.all([
      db.cte.count(),
      db.cte.findMany({
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        skip: (pagina - 1) * limite,
        take: limite,
        include: {
          collection: { select: { trackingCode: true } },
          events: { orderBy: [{ registeredAt: "asc" }, { sequence: "asc" }] },
        },
      }),
    ]);
    return NextResponse.json({
      versao: "avila.fiscal.cte.v1",
      fonte_canonica: "TMS",
      pagina,
      paginas: Math.max(1, Math.ceil(total / limite)),
      total,
      documentos: documentos.map((cte) => cteParaLojas(empresa, cte)),
    }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (erro) {
    if (erro instanceof CredencialLojasInvalida) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    console.error("Integração fiscal Lojas/TMS:", erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: "Integração fiscal temporariamente indisponível." }, { status: 503 });
  }
}

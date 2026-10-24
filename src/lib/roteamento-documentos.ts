/**
 * Preferências para automações externas. Esta função NÃO envia e-mails nem
 * afirma que PDF/XML estejam disponíveis: o executor precisa obtê-los,
 * verificar autorização e registrar o resultado real da entrega.
 */
export type Documento = "nfeXml" | "cteXml" | "danfePdf" | "dactePdf" | "boletoPdf" | "comprovantePdf" | "faturaPdf" | "vencimento";
type Destinatario = { email: string; category: string; documents: Documento[] };
type Preferencias = { enabled: boolean; sendWhen: "disponivel" | "faturamento" };

const EVENTOS: Record<string, readonly Documento[]> = {
  "cte.autorizado": ["cteXml", "dactePdf"],
  "fatura.emitida": ["boletoPdf", "faturaPdf"],
  "cobranca.vencida": ["vencimento"],
  "coleta.status": ["comprovantePdf"],
};

export function selecionarDestinatarios(
  tipo: string,
  dados: Record<string, unknown>,
  destinatarios: unknown,
  preferencias: unknown,
) {
  const prefs = preferencias as Partial<Preferencias> | null;
  if (!dados || typeof dados !== "object") return [];
  if (!Array.isArray(destinatarios) || destinatarios.length > 20) return [];
  if (!prefs?.enabled) return [];
  const permitidos = EVENTOS[tipo];
  if (!permitidos || !Array.isArray(destinatarios)) return [];
  // Nunca sugerir comprovante sem status entregue.
  if (tipo === "coleta.status") {
    const coleta = dados.coleta as { status?: string } | null;
    if (coleta?.status !== "DELIVERED") return [];
  }
  // Autorização fiscal é condição obrigatória, inclusive ao reenviar.
  if (tipo === "cte.autorizado") {
    const cte = dados.cte as { situacao?: string; ambiente?: string } | null;
    if (cte?.situacao !== "AUTHORIZED" || cte?.ambiente !== "PRODUCAO") return [];
  }
  if (tipo === "fatura.emitida") {
    const fatura = dados.fatura as { status?: string; cobranca?: { boleto?: unknown } } | null;
    if (!fatura || fatura.status !== "OPEN") return [];
  }
  return (destinatarios as Destinatario[]).flatMap((destinatario) => {
    if (!destinatario || typeof destinatario.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinatario.email.trim()) || !Array.isArray(destinatario.documents)) return [];
    let tipos = destinatario.documents.filter((d) => permitidos.includes(d));
    // Boleto somente se o gateway disponibilizou cobrança efetiva.
    if (tipo === "fatura.emitida") {
      const fatura = dados.fatura as { cobranca?: { boleto?: unknown } };
      if (!fatura.cobranca?.boleto) tipos = tipos.filter((d) => d !== "boletoPdf");
    }
    if (!tipos.length) return [];
    return [{ email: destinatario.email.trim().toLowerCase(), categoria: destinatario.category, documentosSolicitados: [...new Set(tipos)] }];
  });
}

import { describe, expect, it } from "vitest";
import { selecionarDestinatarios } from "@/lib/roteamento-documentos";
const recipients = [{ email: "fiscal@empresa.com.br", category: "fiscal", documents: ["cteXml", "dactePdf", "boletoPdf"] }];
const enabled = { enabled: true, sendWhen: "disponivel" };

describe("roteamento documental", () => {
  it("não emite destinos quando desativado", () => {
    expect(selecionarDestinatarios("cte.autorizado", { cte: { situacao: "AUTHORIZED", ambiente: "PRODUCAO" } }, recipients, { ...enabled, enabled: false })).toEqual([]);
  });
  it("não recomenda XML de CT-e sem autorização fiscal válida", () => {
    expect(selecionarDestinatarios("cte.autorizado", { cte: { situacao: "PENDING", ambiente: "PRODUCAO" } }, recipients, enabled)).toEqual([]);
    expect(selecionarDestinatarios("cte.autorizado", { cte: { situacao: "AUTHORIZED", ambiente: "HOMOLOGACAO" } }, recipients, enabled)).toEqual([]);
  });
  it("seleciona apenas documentos daquele evento", () => {
    expect(selecionarDestinatarios("cte.autorizado", { cte: { situacao: "AUTHORIZED", ambiente: "PRODUCAO" } }, recipients, enabled)).toEqual([
      { email: "fiscal@empresa.com.br", categoria: "fiscal", documentosSolicitados: ["cteXml", "dactePdf"] },
    ]);
  });
  it("não encaminha boleto inexistente", () => {
    expect(selecionarDestinatarios("fatura.emitida", { fatura: { status: "OPEN" } }, recipients, enabled)).toEqual([]);
  });
});

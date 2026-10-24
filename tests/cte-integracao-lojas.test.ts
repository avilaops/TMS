import { describe, expect, it } from "vitest";
import { cteParaLojas } from "@/lib/cte-integracao-lojas";

const base = {
  id: "cte-1", collectionId: "carga-1", environment: "PRODUCAO", series: 1, number: 42,
  accessKey: "35261060067738000106570010000000421000000011", protocol: "135260000000001",
  statusCode: 100, statusReason: "Autorizado", issuedAt: new Date("2026-10-24T10:00:00Z"),
  authorizedAt: new Date("2026-10-24T10:00:01Z"), cancelledAt: null, cancelProtocol: null,
  createdAt: new Date("2026-10-24T10:00:00Z"), updatedAt: new Date("2026-10-24T10:00:01Z"),
  collection: { trackingCode: "1234567890" }, events: [],
};

describe("contrato fiscal Lojas/TMS", () => {
  it("só oferece XML e DACTE para CT-e autorizado", () => {
    const autorizado = cteParaLojas("transportadora", { ...base, status: "AUTHORIZED" });
    expect(autorizado.arquivos.xml).toContain("/cte/cte-1/xml");
    expect(autorizado.arquivos.dacte).toContain("/cte/cte-1/dacte");
    const rejeitado = cteParaLojas("transportadora", { ...base, status: "REJECTED", protocol: null, authorizedAt: null });
    expect(rejeitado.arquivos).toEqual({ xml: null, dacte: null });
  });

  it("mantém cancelamento e eventos sem transportar XML bruto", () => {
    const documento = cteParaLojas("transportadora", { ...base, status: "CANCELLED", cancelledAt: new Date("2026-10-24T11:00:00Z"), cancelProtocol: "135260000000002", events: [{ id: "evento-1", type: "110111", sequence: 1, protocol: "135260000000002", statusCode: 135, statusReason: "Evento registrado", registeredAt: new Date("2026-10-24T11:00:00Z"), cancelledAt: null }] });
    expect(documento.arquivos).toEqual({ xml: "/api/integracoes/lojas/v1/empresas/transportadora/documentos-fiscais/cte/cte-1/xml", dacte: null });
    expect(documento.eventos[0]).toMatchObject({ tipo: "110111", sequencia: 1 });
    expect(JSON.stringify(documento)).not.toMatch(/xmlSent|xmlReturn|cert|senha/i);
  });
});

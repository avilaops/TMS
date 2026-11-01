import { describe, expect, it } from "vitest";
import { ocupacaoDoRoteiro } from "../src/lib/ocupacao";

describe("ocupação ao longo do roteiro de entregas", () => {
  it("parte só das cargas pendentes e descarrega na ordem recebida sem mutar a entrada", () => {
    const cargas = [
      { id: "feita", status: "DELIVERED", weight: 900, cubicMeters: 50 },
      { id: "a", status: "ROUTE", weight: 12, cubicMeters: 2 },
      { id: "b", status: "ROUTE", weight: 8, cubicMeters: null },
    ];
    const copia = structuredClone(cargas);
    const resultado = ocupacaoDoRoteiro(cargas, ["feita", "b", "a"], { capacity: 15, cubicCapacity: 3 });
    expect(resultado.inicial).toMatchObject({ excesso: true, peso: { total: 20 }, cubagem: { total: 2, semMedida: 1 } });
    expect(resultado.aposEntrega.feita).toBeUndefined();
    expect(resultado.aposEntrega.b).toMatchObject({ excesso: false, peso: { total: 12 }, cubagem: { total: 2, semMedida: 0 } });
    expect(resultado.aposEntrega.a).toMatchObject({ peso: { total: 0 }, cubagem: { total: 0 } });
    expect(cargas).toEqual(copia);
  });

  it("preserva o arredondamento de frações e a ausência de medidas", () => {
    const cargas = [
      { id: "a", status: "ROUTE", weight: 0.1, cubicMeters: 0.1 },
      { id: "b", status: "ROUTE", weight: 0.2, cubicMeters: 0.2 },
      { id: "c", status: "ROUTE", weight: null, cubicMeters: null },
    ];
    const resultado = ocupacaoDoRoteiro(cargas, ["c", "a", "b"], { capacity: 0.3, cubicCapacity: 0.3 });
    expect(resultado.inicial).toMatchObject({ excesso: false, peso: { total: 0.3, semMedida: 1 }, cubagem: { total: 0.3, semMedida: 1 } });
    expect(resultado.aposEntrega.c.peso.semMedida).toBe(0);
    expect(resultado.aposEntrega.a.peso.total).toBe(0.2);
  });

  it("não inventa capacidade e mantém entregas sem localização no saldo", () => {
    const resultado = ocupacaoDoRoteiro([
      { id: "a", status: "ROUTE", weight: 10 },
      { id: "sem-local", status: "ROUTE", weight: 20 },
    ], ["a", "sem-local"], null);
    expect(resultado.inicial.semCapacidade).toBe(true);
    expect(resultado.aposEntrega.a.peso.total).toBe(20);
    expect(resultado.aposEntrega["sem-local"].peso.total).toBe(0);
    expect(ocupacaoDoRoteiro([], [], null).aposEntrega).toEqual({});
  });
});

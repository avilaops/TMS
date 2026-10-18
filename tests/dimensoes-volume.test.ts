import { describe, expect, it } from "vitest";
import { calcularDimensoesDosVolumes } from "@/lib/dimensoes-volume";

describe("dimensões dos volumes", () => {
  it("calcula cada tipo em centímetros e soma quantidade, cubagem e peso", () => {
    expect(
      calcularDimensoesDosVolumes([
        { quantidade: 4, comprimento: 60, largura: 40, altura: 50, unidade: "cm", pesoUnitario: 12.5 },
        { quantidade: 2, comprimento: 1, largura: 0.5, altura: 0.4, unidade: "m", pesoUnitario: null },
      ]),
    ).toEqual({
      volumes: 6,
      metrosCubicos: 0.88,
      pesoDetalhado: 50,
      linhas: [
        { metrosCubicosUnitarios: 0.12, metrosCubicosTotais: 0.48, pesoTotal: 50 },
        { metrosCubicosUnitarios: 0.2, metrosCubicosTotais: 0.4, pesoTotal: null },
      ],
    });
  });

  it("arredonda a cubagem para seis casas sem acumular ruído", () => {
    const resultado = calcularDimensoesDosVolumes([
      { quantidade: 3, comprimento: 33.3, largura: 22.2, altura: 11.1, unidade: "cm", pesoUnitario: null },
    ]);

    expect(resultado.metrosCubicos).toBe(0.024617);
    expect(resultado.linhas[0].metrosCubicosUnitarios).toBe(0.008206);
  });

  it("recusa quantidade, dimensões e peso inválidos", () => {
    const base = { quantidade: 1, comprimento: 1, largura: 1, altura: 1, unidade: "m" as const, pesoUnitario: null };
    for (const linha of [
      { ...base, quantidade: 0 },
      { ...base, quantidade: 1.5 },
      { ...base, comprimento: 0 },
      { ...base, largura: Number.NaN },
      { ...base, altura: -1 },
      { ...base, pesoUnitario: 0 },
    ]) {
      expect(() => calcularDimensoesDosVolumes([linha]), JSON.stringify(linha)).toThrow();
    }
  });

  it("recusa lista vazia", () => {
    expect(() => calcularDimensoesDosVolumes([])).toThrow("Informe ao menos um tipo de volume");
  });
});

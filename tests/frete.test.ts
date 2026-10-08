import { describe, expect, it } from "vitest";
import { calcularFrete, chaveDaCidade, type TabelaDeFrete } from "../src/lib/frete";

/** A conta do frete, sem banco: tabela na mão, carga na mão, valor conferido. */

const cidade = (city: string, minimum: number, extra: Partial<TabelaDeFrete["cities"][number]> = {}) => ({
  city,
  cityKey: chaveDaCidade(city),
  minimum,
  deadlineHours: 24,
  dedicated: false,
  ...extra,
});

const tabela = (regras: Partial<TabelaDeFrete> = {}): TabelaDeFrete => ({
  id: "t1",
  name: "Tabela de teste",
  includedWeightKg: 30,
  excessPerKg: 0.5,
  cubageFactor: null,
  invoiceLimit: null,
  adValoremPct: null,
  maxVolumes: null,
  cities: [
    cidade("Mirassol", 50),
    cidade("São José do Rio Preto", 60, { deadlineHours: 48 }),
    cidade("Santa Clara d'Oeste", 80),
    cidade("Ipiguá", 150, { dedicated: true }),
  ],
  ...regras,
});

const valor = (frete: ReturnType<typeof calcularFrete>) => (frete.atendida ? frete.valor : null);

describe("calcularFrete", () => {
  it("carga dentro do peso coberto paga só o mínimo da cidade, com o prazo de lá", () => {
    const frete = calcularFrete(tabela(), "Mirassol", { peso: 30 });
    expect(frete).toMatchObject({ atendida: true, cidade: "Mirassol", valor: 50, prazoHoras: 24, avisos: [] });
    expect(frete.atendida && frete.composicao).toHaveLength(1);

    expect(calcularFrete(tabela(), "São José do Rio Preto", { peso: 1 })).toMatchObject({ valor: 60, prazoHoras: 48 });
  });

  it("o que passa do peso coberto paga por kg, e só o excedente", () => {
    // 100 kg: 70 excedentes x 0,50 = 35; mais o mínimo de 50.
    expect(valor(calcularFrete(tabela(), "Mirassol", { peso: 100 }))).toBe(85);
    // 30,5 kg: meio quilo excedente = 0,25.
    expect(valor(calcularFrete(tabela(), "Mirassol", { peso: 30.5 }))).toBe(50.25);
  });

  it("com fator de cubagem vale o maior entre o peso real e o cubado", () => {
    const comCubagem = tabela({ cubageFactor: 300 });
    // 0,5 m³ x 300 = 150 kg cubados contra 40 kg reais: 120 excedentes x 0,50 = 60.
    const volumosa = calcularFrete(comCubagem, "Mirassol", { peso: 40, metrosCubicos: 0.5 });
    expect(volumosa).toMatchObject({ valor: 110, pesoTaxavel: 150 });
    expect(volumosa.atendida && volumosa.composicao[1].rotulo).toContain("peso cubado");

    // Carga densa: 0,1 m³ = 30 kg cubados contra 100 kg reais. Vale o real.
    expect(calcularFrete(comCubagem, "Mirassol", { peso: 100, metrosCubicos: 0.1 })).toMatchObject({ valor: 85, pesoTaxavel: 100 });

    // Tabela sem fator ignora o volume.
    expect(valor(calcularFrete(tabela(), "Mirassol", { peso: 40, metrosCubicos: 5 }))).toBe(55);
  });

  it("nota acima do limite: percentual sobre o que passa, quando a tabela define", () => {
    const comLimite = tabela({ invoiceLimit: 2000, adValoremPct: 3 });
    expect(valor(calcularFrete(comLimite, "Mirassol", { peso: 10, valorNota: 2000 }))).toBe(50);
    // 5.000 de nota: 3% sobre 3.000 = 90.
    expect(valor(calcularFrete(comLimite, "Mirassol", { peso: 10, valorNota: 5000 }))).toBe(140);
  });

  it("nota acima do limite sem percentual combinado: calcula e avisa o comercial", () => {
    const frete = calcularFrete(tabela({ invoiceLimit: 1500 }), "Mirassol", { peso: 10, valorNota: 1500.01 });
    expect(frete).toMatchObject({ atendida: true, valor: 50 });
    expect(frete.atendida && frete.avisos).toEqual([expect.stringMatching(/consultar o comercial/)]);
  });

  it("volumes acima do combinado e cidade dedicada viram aviso, sem mudar o valor", () => {
    const frete = calcularFrete(tabela({ maxVolumes: 3 }), "Ipiguá", { peso: 10, volumes: 4 });
    expect(frete).toMatchObject({ atendida: true, valor: 150 });
    expect(frete.atendida && frete.avisos).toHaveLength(2);

    expect(calcularFrete(tabela({ maxVolumes: 3 }), "Mirassol", { peso: 10, volumes: 3 })).toMatchObject({ avisos: [] });
  });

  it("acha a cidade com acento, caixa, UF e apóstrofo escritos de outro jeito", () => {
    for (const escrito of [
      "sao jose do rio preto",
      "SÃO JOSÉ DO RIO PRETO",
      "  São José do Rio Preto/SP ",
      "São José do Rio Preto - SP",
      "São José do Rio Preto (SP)",
    ]) {
      expect(valor(calcularFrete(tabela(), escrito, { peso: 1 })), escrito).toBe(60);
    }
    for (const escrito of ["Santa Clara D´Oeste", "santa clara d’oeste", "SANTA CLARA D'OESTE", "Santa Clara dOeste"]) {
      expect(valor(calcularFrete(tabela(), escrito, { peso: 1 })), escrito).toBe(80);
    }
  });

  it("cidade fora da tabela, ou em branco, não é atendida", () => {
    expect(calcularFrete(tabela(), "Campinas", { peso: 10 })).toEqual({ atendida: false });
    expect(calcularFrete(tabela(), "   ", { peso: 10 })).toEqual({ atendida: false });
    // Nome parecido não basta: a tabela é a autoridade.
    expect(calcularFrete(tabela(), "Mirassolândia", { peso: 10 })).toEqual({ atendida: false });
  });

  it("valores saem em centavos inteiros, sem resto de ponto flutuante", () => {
    const frete = calcularFrete(tabela({ excessPerKg: 0.85, includedWeightKg: 51 }), "Mirassol", { peso: 51.1 });
    expect(valor(frete)).toBe(50.09); // 0,1 kg x 0,85 = 0,085 → 0,09
    expect(valor(calcularFrete(tabela(), "Mirassol", { peso: -5 }))).toBe(50);
  });
});

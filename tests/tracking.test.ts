import { describe, expect, it } from "vitest";
import {
  TRACKING_CODE_LENGTH,
  generateTrackingCode,
  normalizeTaxId,
  normalizeTrackingCode,
  takeTrackingCodeDigits,
} from "../src/lib/tracking";

describe("generateTrackingCode", () => {
  it("devolve sempre 10 dígitos", () => {
    for (let i = 0; i < 2000; i += 1) {
      expect(generateTrackingCode()).toMatch(/^\d{10}$/);
    }
  });

  it("não é sequencial: códigos seguidos não têm relação", () => {
    const codigos = Array.from({ length: 200 }, () => Number(generateTrackingCode()));
    const diferencasIguais = codigos
      .slice(1)
      .map((valor, i) => valor - codigos[i])
      .every((delta, _, todas) => delta === todas[0]);
    expect(diferencasIguais).toBe(false);
  });

  it("quase não repete em um volume muito acima do uso real", () => {
    // Em 10^10 valores, 20 mil sorteios honestos repetem uma vez a cada ~50
    // execuções (paradoxo do aniversário: n²/2N = 2%). Exigir zero repetições
    // fazia este teste falhar sozinho de vez em quando. Um gerador viciado
    // repetiria às dezenas; mais de 3 num sorteio honesto é 1 em bilhões.
    const vistos = new Set<string>();
    for (let i = 0; i < 20000; i += 1) vistos.add(generateTrackingCode());
    expect(vistos.size).toBeGreaterThanOrEqual(20000 - 3);
  });

  it("usa todo o espaço, incluindo zeros à esquerda", () => {
    // Se o gerador tratasse o código como número, nada começaria com zero e o
    // espaço cairia de 10^10 para 9x10^9.
    const amostra = Array.from({ length: 50000 }, () => generateTrackingCode());
    expect(amostra.some((c) => c.startsWith("0"))).toBe(true);
    const primeiroDigito = new Set(amostra.map((c) => c[0]));
    expect(primeiroDigito.size).toBe(10);
  });
});

describe("normalizeTrackingCode", () => {
  it("aceita o código limpo e com separadores", () => {
    expect(normalizeTrackingCode("1234567890")).toBe("1234567890");
    expect(normalizeTrackingCode(" 1234-567.890 ")).toBe("1234567890");
  });

  it("preserva zeros à esquerda", () => {
    expect(normalizeTrackingCode("0000000123")).toBe("0000000123");
  });

  it("recusa o que não tem exatamente 10 dígitos", () => {
    expect(normalizeTrackingCode("123456789")).toBeNull();
    expect(normalizeTrackingCode("12345678901")).toBeNull();
    expect(normalizeTrackingCode("")).toBeNull();
    expect(normalizeTrackingCode(null)).toBeNull();
    expect(normalizeTrackingCode(12345 as unknown)).toBeNull();
  });
});

describe("normalizeTaxId", () => {
  it("aceita CPF e CNPJ, formatados ou não", () => {
    expect(normalizeTaxId("12.345.678/0001-99")).toBe("12345678000199");
    expect(normalizeTaxId("12345678000199")).toBe("12345678000199");
    expect(normalizeTaxId("123.456.789-09")).toBe("12345678909");
  });

  it("recusa tamanhos que não são documento", () => {
    expect(normalizeTaxId("123")).toBeNull();
    expect(normalizeTaxId("123456789012345")).toBeNull();
  });
});

describe("constante", () => {
  it("o comprimento é 10", () => {
    expect(TRACKING_CODE_LENGTH).toBe(10);
  });
});

describe("takeTrackingCodeDigits", () => {
  it("preserva o código colado com separadores", () => {
    // Regressao: com `maxLength={10}` no input, o navegador cortava o texto
    // bruto ("9184-726.3") e so depois a pontuacao saia, entregando 8 digitos.
    expect(takeTrackingCodeDigits("9184-726.350")).toBe("9184726350");
    expect(takeTrackingCodeDigits(" 9184 726 350 ")).toBe("9184726350");
  });

  it("corta no décimo dígito, não no décimo caractere", () => {
    expect(takeTrackingCodeDigits("918472635012345")).toBe("9184726350");
  });

  it("mantém zeros à esquerda e o digitar parcial", () => {
    expect(takeTrackingCodeDigits("0000000123")).toBe("0000000123");
    expect(takeTrackingCodeDigits("918")).toBe("918");
    expect(takeTrackingCodeDigits("")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { mensagemDaProposta } from "../src/lib/proposta-cotacao";

describe("mensagem da proposta comercial", () => {
  it("leva os dados negociados e avisa que o frete ainda será confirmado", () => {
    expect(mensagemDaProposta({
      number: 1494,
      companyName: "Indústria Interessada",
      origin: "São José do Rio Preto",
      destination: "Mirassol",
      volumes: 3,
      weight: 120.5,
      estimatedValue: 1234.5,
      deadline: "até 2 dias úteis",
      validUntil: "2026-10-25",
    })).toBe(
      "Olá, Indústria Interessada!\n\n" +
      "Segue a proposta da cotação nº 1494:\n" +
      "São José do Rio Preto → Mirassol\n" +
      "Carga: 3 volumes · 120,5 kg\n" +
      "Frete estimado: R$ 1.234,50\n" +
      "Prazo de entrega: até 2 dias úteis\n" +
      "Proposta válida até 25/10/2026.\n\n" +
      "O valor é estimado e está sujeito à confirmação no momento da coleta.",
    );
  });

  it.each([
    [{ estimatedValue: null }, "A cotação precisa ter um valor estimado."],
    [{ deadline: "  " }, "Informe o prazo de entrega."],
    [{ validUntil: "" }, "Informe a validade da proposta."],
    [{ validUntil: "25/10/2026" }, "Informe uma data de validade válida."],
  ])("recusa proposta incompleta: %o", (alteracao, mensagem) => {
    expect(() => mensagemDaProposta({
      number: null,
      companyName: "Cliente",
      origin: "Origem",
      destination: "Destino",
      volumes: 1,
      weight: 10,
      estimatedValue: 0,
      deadline: "24 horas",
      validUntil: "2026-10-25",
      ...alteracao,
    })).toThrow(mensagem);
  });
});

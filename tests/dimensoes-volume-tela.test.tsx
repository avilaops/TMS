// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { EditorDeDimensoes } from "../src/components/cotacao/EditorDeDimensoes";

afterEach(async () => {
  await desmontarTudo();
  vi.restoreAllMocks();
});

const preencher = async (campo: HTMLInputElement, valor: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("editor de dimensões", () => {
  it("adiciona tipos de volume e entrega os totais calculados", async () => {
    const aoCalcular = vi.fn();
    const tela = await montar(<EditorDeDimensoes onChange={aoCalcular} />);

    await clicar(porTexto(tela, "button", "Informar dimensões")[0]);
    await preencher(tela.querySelector('[aria-label="Quantidade do tipo 1"]')!, "4");
    await preencher(tela.querySelector('[aria-label="Comprimento do tipo 1"]')!, "60");
    await preencher(tela.querySelector('[aria-label="Largura do tipo 1"]')!, "40");
    await preencher(tela.querySelector('[aria-label="Altura do tipo 1"]')!, "50");
    await preencher(tela.querySelector('[aria-label="Peso unitário do tipo 1"]')!, "12,5");

    await ate(() => expect(tela.textContent).toContain("Cubagem total: 0,48 m³"));
    expect(tela.textContent).toContain("0,12 m³ cada · 0,48 m³ neste tipo");
    expect(tela.textContent).toContain("4 volumes");
    expect(tela.textContent).toContain("Peso detalhado: 50 kg");
    expect(aoCalcular).toHaveBeenLastCalledWith({ volumes: 4, cubicMeters: 0.48, detailedWeight: 50 });
  });

  it("permite unidades diferentes, remove linhas e limpa os totais ao fechar", async () => {
    const aoCalcular = vi.fn();
    const tela = await montar(<EditorDeDimensoes onChange={aoCalcular} />);

    await clicar(porTexto(tela, "button", "Informar dimensões")[0]);
    await clicar(porTexto(tela, "button", "Adicionar tipo de volume")[0]);
    expect(tela.querySelectorAll("[data-tipo-volume]")).toHaveLength(2);

    await clicar(tela.querySelector('[aria-label="Remover tipo 2"]')!);
    expect(tela.querySelectorAll("[data-tipo-volume]")).toHaveLength(1);
    await clicar(porTexto(tela, "button", "Ocultar dimensões")[0]);

    expect(tela.querySelectorAll("[data-tipo-volume]")).toHaveLength(0);
    expect(aoCalcular).toHaveBeenLastCalledWith(null);
  });

  it("não calcula nem quebra a tela com quantidade fracionada ou peso inválido", async () => {
    const aoCalcular = vi.fn();
    const tela = await montar(<EditorDeDimensoes onChange={aoCalcular} />);
    await clicar(porTexto(tela, "button", "Informar dimensões")[0]);
    await preencher(tela.querySelector('[aria-label="Quantidade do tipo 1"]')!, "1,5");
    await preencher(tela.querySelector('[aria-label="Comprimento do tipo 1"]')!, "60");
    await preencher(tela.querySelector('[aria-label="Largura do tipo 1"]')!, "40");
    await preencher(tela.querySelector('[aria-label="Altura do tipo 1"]')!, "50");

    expect(tela.textContent).not.toContain("Cubagem total");
    expect(aoCalcular).toHaveBeenLastCalledWith(null);
  });
});

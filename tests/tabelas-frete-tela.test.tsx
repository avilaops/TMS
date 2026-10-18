// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import TabelasDeFrete from "../src/app/dashboard/tabelas-frete/page";

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

const preencher = async (input: HTMLInputElement, valor: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("simulador de frete", () => {
  it("mostra o veículo sugerido com suas capacidades", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url) === "/api/tabelas-frete") return Response.json([]);
        return Response.json({
          tabela: { id: "t1", name: "Tabela padrão" },
          frete: { atendida: true, cidade: "Mirassol", valor: 85, prazoHoras: 24, composicao: [], avisos: [] },
          adequacaoVeiculo: {
            sugerido: { id: "v1", plate: "FRT1A23", model: "Sprinter", type: "VAN", capacity: 1500, cubicCapacity: 10 },
            compativeis: [{ id: "v1", plate: "FRT1A23", model: "Sprinter", type: "VAN", capacity: 1500, cubicCapacity: 10 }],
            aviso: null,
          },
        });
      }),
    );

    const tela = await montar(<TabelasDeFrete />);
    await ate(() => expect(tela.textContent).toContain("Simular frete"));
    const inputs = tela.querySelectorAll("form input");
    await preencher(inputs[0] as HTMLInputElement, "Mirassol");
    await preencher(inputs[1] as HTMLInputElement, "1000");
    await act(async () => {
      tela.querySelector("form:last-of-type")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await ate(() => expect(tela.textContent).toContain("Sugestão: VAN · FRT1A23"));
    expect(tela.textContent).toContain("Sprinter · 1.500 kg · 10 m³");
  });

  it("envia a cubagem e a quantidade calculadas pelas dimensões", async () => {
    let enviado: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/tabelas-frete") return Response.json([]);
      enviado = JSON.parse(String(init?.body));
      return Response.json({
        tabela: { id: "t1", name: "Tabela padrão" },
        frete: { atendida: false },
        adequacaoVeiculo: { sugerido: null, compativeis: [], aviso: "Nenhum veículo compatível." },
      });
    }));

    const tela = await montar(<TabelasDeFrete />);
    await ate(() => expect(tela.textContent).toContain("Simular frete"));
    const inputs = tela.querySelectorAll("form input");
    await preencher(inputs[0] as HTMLInputElement, "Mirassol");
    await preencher(inputs[1] as HTMLInputElement, "50");
    await clicar(porTexto(tela, "button", "Informar dimensões")[0]);
    await preencher(tela.querySelector('[aria-label="Quantidade do tipo 1"]')!, "4");
    await preencher(tela.querySelector('[aria-label="Comprimento do tipo 1"]')!, "60");
    await preencher(tela.querySelector('[aria-label="Largura do tipo 1"]')!, "40");
    await preencher(tela.querySelector('[aria-label="Altura do tipo 1"]')!, "50");
    await act(async () => {
      tela.querySelector("form:last-of-type")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await ate(() => expect(enviado).toMatchObject({ volumes: "4", cubicMeters: "0.48" }));
  });
});

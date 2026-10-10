// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { AVISO_DE_VIAGEM_SEM_MDFE, fraseDoBloqueioDaSaida, type FaltasParaSair } from "../src/lib/mdfe";

/**
 * A tela de Manifestos quando o servidor não libera a saída por falta de
 * documento fiscal (409 com `faltas`): o cartão da viagem mostra o que falta,
 * com o atalho para emitir. As regras e a rota são testadas em
 * tests/mdfe.test.ts e tests/mdfe-rotas.test.ts. Nada aqui fala com servidor
 * nenhum: o `fetch` é simulado.
 */

const estado = vi.hoisted(() => ({ papel: "OPERATION" }));

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: estado.papel } }, status: "authenticated" }) }));
// A tela da viagem (abas, mapa, MDF-e) tem os próprios testes: aqui basta saber em que aba ela abriu.
vi.mock("../src/app/dashboard/manifestos/viagem", () => ({
  TelaDaViagem: ({ manifesto, abaInicial }: { manifesto: { id: string }; abaInicial: string }) => <div data-tela-da-viagem={manifesto.id} data-aba-inicial={abaInicial} />,
}));

import ManifestosPage from "../src/app/dashboard/manifestos/page";

const VIAGEM = {
  id: "a1b2c3d4-0000-0000-0000-000000000001",
  status: "ASSEMBLING",
  createdAt: "2026-10-10T12:00:00.000Z",
  driver: { id: "m1", user: { name: "João da Silva" }, cpf: "52998224725", active: true },
  vehicle: { id: "v1", plate: "ABC1D23", model: "Truck", type: "TRUCK", status: "AVAILABLE" },
  collections: [
    { id: "c1", sender: "Remetente", receiver: "Destinatário", origin: "Mirassol - SP", destination: "Belo Horizonte - MG", volumes: 3, weight: 42.5, client: { tradeName: null, companyName: "Cliente Ltda" }, status: "COLLECTED", manifestId: "a1b2c3d4-0000-0000-0000-000000000001" },
  ],
};

const FALTAS: FaltasParaSair = { ctes: [{ id: "c1", codigo: "9700000001" }, { id: "c2", codigo: "9700000002" }], mdfe: "interestadual" };

/** As quatro leituras da tela e a resposta de liberar a saída. O resto (ausências) responde vazio. */
function api(aoLiberar: { status: number; body: unknown }) {
  const pedidos: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const endereco = String(url);
      pedidos.push(`${init?.method ?? "GET"} ${endereco}`);
      if (endereco === "/api/manifestos") return new Response(JSON.stringify([VIAGEM]));
      if (endereco === `/api/manifestos/${VIAGEM.id}/liberar`) return new Response(JSON.stringify(aoLiberar.body), { status: aoLiberar.status });
      return new Response("[]");
    }),
  );
  return pedidos;
}

const liberar = async (tela: HTMLElement) => clicar(porTexto(tela, "button", "Liberar saída")[0]);

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  estado.papel = "OPERATION";
});

describe("Manifestos: saída bloqueada por falta de CT-e ou de MDF-e", () => {
  it("o 409 com a lista vira um quadro no cartão da viagem, com o que falta e os atalhos para emitir", async () => {
    const alerta = vi.fn();
    vi.stubGlobal("confirm", () => true);
    vi.stubGlobal("alert", alerta);
    const pedidos = api({ status: 409, body: { error: fraseDoBloqueioDaSaida(FALTAS), faltas: FALTAS } });
    const tela = await montar(<ManifestosPage />);
    await ate(() => expect(porTexto(tela, "button", "Liberar saída")).toHaveLength(1));
    expect(tela.querySelector("[data-saida-bloqueada]")).toBeNull();

    await liberar(tela);
    await ate(() => expect(tela.querySelector(`[data-saida-bloqueada="${VIAGEM.id}"]`)).not.toBeNull());
    expect(pedidos).toContain(`POST /api/manifestos/${VIAGEM.id}/liberar`);
    // O quadro substitui o alerta do navegador: a lista e os atalhos ficam na tela.
    expect(alerta).not.toHaveBeenCalled();
    const quadro = tela.querySelector<HTMLElement>("[data-saida-bloqueada]")!;
    expect(quadro.getAttribute("role")).toBe("alert");
    expect(quadro.textContent).toContain("Saída não liberada: falta documento fiscal autorizado.");
    expect(quadro.querySelector('[data-falta="cte"]')!.textContent).toContain("CT-e de 2 cargas: 9700000001, 9700000002");
    expect(quadro.querySelector('[data-falta="mdfe"]')!.textContent).toContain("MDF-e da viagem (depois dos CT-e)");
    expect(quadro.querySelector('[data-atalho="cte"]')!.getAttribute("href")).toBe("/dashboard/fiscal/cte");

    // O atalho do MDF-e abre a viagem na aba do MDF-e.
    expect(tela.querySelector("[data-tela-da-viagem]")).toBeNull();
    await clicar(quadro.querySelector('[data-atalho="mdfe"]')!);
    expect(tela.querySelector(`[data-tela-da-viagem="${VIAGEM.id}"]`)!.getAttribute("data-aba-inicial")).toBe("MDF-e");
  });

  it("só o MDF-e faltando; e quem não lê o fiscal vê o que falta, sem os atalhos", async () => {
    vi.stubGlobal("confirm", () => true);
    vi.stubGlobal("alert", vi.fn());
    estado.papel = "WAREHOUSE";
    api({ status: 409, body: { error: "x", faltas: { ctes: [], mdfe: "intermunicipal" } satisfies FaltasParaSair } });
    const tela = await montar(<ManifestosPage />);
    await ate(() => expect(porTexto(tela, "button", "Liberar saída")).toHaveLength(1));
    await liberar(tela);
    await ate(() => expect(tela.querySelector("[data-saida-bloqueada]")).not.toBeNull());
    const quadro = tela.querySelector<HTMLElement>("[data-saida-bloqueada]")!;
    expect(quadro.querySelector('[data-falta="cte"]')).toBeNull();
    expect(quadro.querySelector('[data-falta="mdfe"]')!.textContent).toBe("MDF-e da viagem");
    expect(quadro.querySelector("[data-atalho]")).toBeNull();
  });

  it("homologação ou empresa sem emitente: a saída é liberada e o aviso continua sendo um alerta; outro 409 também", async () => {
    const alerta = vi.fn();
    vi.stubGlobal("confirm", () => true);
    vi.stubGlobal("alert", alerta);
    api({ status: 200, body: { success: true, aviso: AVISO_DE_VIAGEM_SEM_MDFE.interestadual } });
    const tela = await montar(<ManifestosPage />);
    await ate(() => expect(porTexto(tela, "button", "Liberar saída")).toHaveLength(1));
    await liberar(tela);
    await ate(() => expect(alerta).toHaveBeenCalledWith(AVISO_DE_VIAGEM_SEM_MDFE.interestadual));
    expect(tela.querySelector("[data-saida-bloqueada]")).toBeNull();
    await desmontarTudo();

    // 409 sem a lista (veículo ocupado, por exemplo): a frase do servidor, como antes.
    alerta.mockClear();
    api({ status: 409, body: { error: "O veículo já está em outra viagem em rota." } });
    const outra = await montar(<ManifestosPage />);
    await ate(() => expect(porTexto(outra, "button", "Liberar saída")).toHaveLength(1));
    await liberar(outra);
    await ate(() => expect(alerta).toHaveBeenCalledWith("O veículo já está em outra viagem em rota."));
    expect(outra.querySelector("[data-saida-bloqueada]")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotaoDanfe } from "../src/components/fiscal/botao-danfe";
import { PainelDaNota, type NotaAberta } from "../src/app/dashboard/fiscal/nota";
import UsuariosPage from "../src/app/dashboard/usuarios/page";
import type { NotaImportada } from "../src/lib/nfe";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

/**
 * Telas dos acabamentos: o botão "DANFE (PDF)" (painel e portal usam o mesmo
 * componente) e o cadastro de usuário recolhido no celular. O `fetch` é
 * simulado: o que se prova é o que a tela pede e o que ela mostra.
 */

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CHAVE = "35261099444333000181550010000012341123456780";

const NOTA: NotaImportada = {
  id: "n1",
  accessKey: CHAVE,
  number: 1234,
  series: 1,
  issuedAt: "2026-10-08T17:30:00.000Z",
  operationNature: "Venda de mercadoria",
  freightMode: 0,
  issuerTaxId: "99444333000181",
  issuerName: "Fábrica de Tintas",
  issuerCity: "São José do Rio Preto",
  issuerState: "SP",
  issuerAddress: null,
  recipientTaxId: "99444333000262",
  recipientName: "Mercado Bom Preço",
  recipientCity: "Mirassol",
  recipientState: "SP",
  recipientAddress: null,
  totalValue: 1534.56,
  grossWeight: 42.5,
  volumes: 3,
  createdAt: "2026-10-09T12:00:00.000Z",
  collection: { id: "c1", trackingCode: "1234567890", status: "CONFIRMED", origin: "São José do Rio Preto - SP", destination: "Mirassol - SP" },
};

const painel = (aberta: Partial<NotaAberta>) =>
  montar(<PainelDaNota aberta={{ nota: NOTA, sugestao: null, cargaComAChave: null, ...aberta }} clientes={[]} aoFechar={() => undefined} aoMudar={() => undefined} />);

describe("botão DANFE (PDF)", () => {
  it("no painel da nota, aparece ao lado de Baixar XML só quando o serviço está ligado", async () => {
    const ligado = await painel({ danfe: true });
    const arquivos = ligado.querySelector("[data-arquivos]")!;
    expect(arquivos.querySelector('a[href="/api/fiscal/notas/n1/xml"]')!.textContent).toContain("Baixar XML");
    expect(arquivos.querySelector("[data-danfe]")!.textContent).toContain("DANFE (PDF)");

    for (const danfe of [false, undefined]) {
      const desligado = await painel({ danfe });
      expect(desligado.querySelector("[data-danfe]"), String(danfe)).toBeNull();
      expect(desligado.querySelector('[data-arquivos] a[href="/api/fiscal/notas/n1/xml"]'), String(danfe)).not.toBeNull();
    }
  });

  it("baixa o PDF com o nome que a rota manda", async () => {
    const pedidos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        pedidos.push(url);
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${CHAVE}-danfe.pdf"` },
        });
      }),
    );
    const criar = vi.fn(() => "blob:teste");
    const soltar = vi.fn();
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: soltar });
    const baixados: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      baixados.push(this.download);
    });

    const tela = await montar(<BotaoDanfe endereco="/api/portal/coletas/c1/notas/n1/danfe" />);
    await clicar(tela.querySelector("[data-danfe]")!);

    await ate(() => expect(baixados).toEqual([`${CHAVE}-danfe.pdf`]));
    expect(pedidos).toEqual(["/api/portal/coletas/c1/notas/n1/danfe"]);
    expect(soltar).toHaveBeenCalledWith("blob:teste");
    expect(tela.querySelector('[role="alert"]')).toBeNull();
  });

  it("erro do serviço aparece na tela, com a frase da rota, e nada é baixado", async () => {
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const respostas = [
      new Response(JSON.stringify({ error: "O serviço fiscal demorou demais para responder. Tente de novo em instantes." }), { status: 504 }),
      new Response("<html>erro</html>", { status: 502 }),
      new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => respostas.shift()!));

    const tela = await montar(<BotaoDanfe endereco="/api/fiscal/notas/n1/danfe" />);
    const alerta = () => tela.querySelector('[role="alert"]')?.textContent ?? "";

    await clicar(tela.querySelector("[data-danfe]")!);
    await ate(() => expect(alerta()).toContain("demorou demais"));

    await clicar(tela.querySelector("[data-danfe]")!);
    await ate(() => expect(alerta()).toBe("Não foi possível gerar o DANFE."));

    await clicar(tela.querySelector("[data-danfe]")!);
    await ate(() => expect(alerta()).toContain("Sessão expirada"));

    expect(clique).not.toHaveBeenCalled();
    expect(tela.querySelector<HTMLButtonElement>("[data-danfe]")!.disabled).toBe(false);
  });
});

describe("tela de usuários no celular", () => {
  const USUARIO = { id: "u1", name: "Ana", email: "ana@exemplo.br", role: "ADMIN", clientId: null, createdAt: "2026-10-01T12:00:00.000Z", inviteStatus: null, inviteDetail: null, inviteAt: null };

  const responder = (status: number, corpo: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(JSON.stringify(url === "/api/usuarios" ? corpo : []), { status: url === "/api/usuarios" ? status : 200 })),
    );

  it("o cadastro fica recolhido atrás do botão, e abrir esconde a lista; no computador os dois ficam à vista", async () => {
    responder(200, [USUARIO]);
    const tela = await montar(<UsuariosPage />);
    await ate(() => expect(tela.textContent).toContain("ana@exemplo.br"));

    const cadastro = tela.querySelector<HTMLElement>("[data-novo-usuario]")!;
    const lista = tela.querySelector<HTMLElement>("[data-lista]")!;
    const botao = porTexto(tela, "button", "Novo usuário")[0];

    // Recolhido no celular (`hidden`), sempre aberto do `md` para cima.
    expect(cadastro.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
    expect(lista.className.split(" ")).toEqual(expect.arrayContaining(["flex", "md:flex"]));
    expect(lista.className.split(" ")).not.toContain("hidden");
    expect(botao.className).toContain("md:hidden");
    expect(botao.getAttribute("aria-expanded")).toBe("false");

    await clicar(botao);
    expect(cadastro.className.split(" ")).toContain("flex");
    expect(cadastro.className.split(" ")).not.toContain("hidden");
    expect(lista.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
    expect(porTexto(tela, "button", "Fechar")[0].getAttribute("aria-expanded")).toBe("true");

    await clicar(porTexto(tela, "button", "Fechar")[0]);
    expect(cadastro.className.split(" ")).toContain("hidden");
    expect(lista.className.split(" ")).not.toContain("hidden");
  });

  it("403 mostra acesso negado sem citar perfil", async () => {
    responder(403, { error: "Acesso negado" });
    const tela = await montar(<UsuariosPage />);
    await ate(() => expect(tela.textContent).toContain("Acesso negado"));
    expect(tela.textContent).toContain("Seu perfil não tem acesso a esta área.");
    expect(tela.textContent).not.toContain("Administrador");
    expect(tela.querySelector("[data-novo-usuario]")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => {
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={String(props.alt ?? "")} {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />;
} }));

import EmpresaPage from "../src/app/dashboard/empresa/page";

afterEach(async () => { await desmontarTudo(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, "clipboard"); });

it("mostra estado, pedidos recentes e a chave somente na resposta da rotação", async () => {
  let leituras = 0;
  let rotacoes = 0;
  const confirmar = vi.fn(() => false);
  vi.stubGlobal("confirm", confirmar);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => undefined) } });
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const caminho = String(url);
    if (caminho === "/api/empresa") return Response.json({ name: "Mello Transportes", logo: null });
    if (caminho === "/api/empresa/integracoes/lojas") {
      if (init?.method === "POST") {
        rotacoes += 1;
        return Response.json({ configurado: true, final: "xYz9", rotacionadaEm: "2026-10-18T12:00:00.000Z", chave: "lojas_chave_secreta_xYz9" }, { status: 201 });
      }
      leituras += 1;
      return Response.json({ configurado: leituras > 1, final: leituras > 1 ? "xYz9" : null, rotacionadaEm: leituras > 1 ? "2026-10-18T12:00:00.000Z" : null, ordens: [{ externalId: "PED-2048", mode: "CIF", state: "CONFIRMED", direction: "OUTBOUND", rma: null, createdAt: new Date().toISOString() }] });
    }
    if (caminho === "/api/empresa/webhook") return Response.json({ url: null, entregas: [] });
    if (caminho === "/api/empresa/cobranca") return Response.json({ multaPct: 2, jurosPct: 1 });
    if (caminho === "/api/empresa/gateway") return Response.json({ disponivel: false, configurado: false, webhook: "", accessTokenFinal: null, webhookSecretFinal: null });
    if (caminho === "/api/empresa/comprovantes") return Response.json({ perfil: "LIVRE" });
    if (caminho === "/api/empresa/remuneracao") return Response.json({ visivelAoMotorista: false });
    return Response.json({}, { status: 404 });
  }));

  const tela = await montar(<EmpresaPage />);
  await ate(() => expect(tela.querySelector('section[aria-label="Integração Lojas"]')).not.toBeNull());
  const secao = tela.querySelector('section[aria-label="Integração Lojas"]')!;
  const identidade = tela.querySelector('form[aria-label="Identidade da empresa"]')!;
  const painelDaIdentidade = identidade.parentElement!;

  expect(secao.className).toContain("hidden");
  expect(secao.className).not.toContain("md:block");
  expect(painelDaIdentidade.className).not.toContain("hidden");
  await clicar(tela.querySelector('[data-aba="integracao"]')!);
  expect(secao.className).not.toContain("hidden");
  expect(painelDaIdentidade.className).toContain("hidden");

  expect(secao.textContent).toContain("PED-2048");
  expect(secao.textContent).toContain("Não configurada");
  expect(secao.textContent).not.toContain("lojas_chave_secreta_xYz9");
  await clicar(porTexto(secao, "button", "Criar chave")[0]);
  await ate(() => expect(secao.textContent).toContain("lojas_chave_secreta_xYz9"));
  expect(secao.textContent).toContain("Ativa");
  expect(secao.textContent).toContain("•••• xYz9");
  expect(secao.textContent).toContain("18/10/2026");

  await clicar(porTexto(secao, "button", "Copiar chave")[0]);
  await ate(() => expect(secao.textContent).toContain("Chave copiada"));

  await clicar(porTexto(secao, "button", "Trocar chave")[0]);
  expect(confirmar).toHaveBeenCalledOnce();
  expect(rotacoes).toBe(1);

  confirmar.mockReturnValue(true);
  await clicar(porTexto(secao, "button", "Trocar chave")[0]);
  await ate(() => expect(rotacoes).toBe(2));
  expect(secao.textContent).toContain("Copiar chave");
  expect(secao.textContent).not.toContain("Chave copiada");
});

it("orienta o próximo passo quando ainda não recebeu pedidos da Lojas", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    const caminho = String(url);
    if (caminho === "/api/empresa") return Response.json({ name: "Mello Transportes", logo: null });
    if (caminho === "/api/empresa/integracoes/lojas") return Response.json({ configurado: false, final: null, rotacionadaEm: null, ordens: [] });
    if (caminho === "/api/empresa/webhook") return Response.json({ url: null, entregas: [] });
    if (caminho === "/api/empresa/cobranca") return Response.json({ multaPct: 2, jurosPct: 1 });
    if (caminho === "/api/empresa/gateway") return Response.json({ disponivel: false, configurado: false, webhook: "", accessTokenFinal: null, webhookSecretFinal: null });
    if (caminho === "/api/empresa/comprovantes") return Response.json({ perfil: "LIVRE" });
    if (caminho === "/api/empresa/remuneracao") return Response.json({ visivelAoMotorista: false });
    return Response.json({}, { status: 404 });
  }));

  const tela = await montar(<EmpresaPage />);
  const secao = tela.querySelector('section[aria-label="Integração Lojas"]')!;
  await ate(() => expect(secao.textContent).toContain("Crie a chave e envie um pedido de teste"));
});

it("não oferece criar ou trocar a chave antes de conhecer o estado atual", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
    const caminho = String(url);
    if (caminho === "/api/empresa") return Response.json({ name: "Mello Transportes", logo: null });
    if (caminho === "/api/empresa/integracoes/lojas") return new Promise<Response>(() => undefined);
    if (caminho === "/api/empresa/webhook") return Response.json({ url: null, entregas: [] });
    if (caminho === "/api/empresa/cobranca") return Response.json({ multaPct: 2, jurosPct: 1 });
    if (caminho === "/api/empresa/gateway") return Response.json({ disponivel: false, configurado: false, webhook: "", accessTokenFinal: null, webhookSecretFinal: null });
    if (caminho === "/api/empresa/comprovantes") return Response.json({ perfil: "LIVRE" });
    if (caminho === "/api/empresa/remuneracao") return Response.json({ visivelAoMotorista: false });
    return Response.json({}, { status: 404 });
  }));

  const tela = await montar(<EmpresaPage />);
  await ate(() => expect(tela.querySelector('section[aria-label="Integração Lojas"]')).not.toBeNull());
  const botaoDaChave = porTexto(tela, "button", "Carregando chave")[0] as HTMLButtonElement;
  expect(botaoDaChave.disabled).toBe(true);
});

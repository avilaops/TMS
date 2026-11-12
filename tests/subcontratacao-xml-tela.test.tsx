// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { montar, ate, clicar, desmontarTudo } from "./tela";
import { DocumentosDaSubcontratada } from "../src/app/dashboard/manifestos/subcontratacao";
import type { SubcontratacaoDaViagem } from "../src/lib/subcontratacao";
import { CHAVE_MDFE_SUB, xmlDaSubcontratada } from "./subcontratacao-xml-apoio";

const dados: SubcontratacaoDaViagem = {
  viagem: { id: "v1", status: "ASSEMBLING" }, parceiro: { id: "p1", name: "Transportes Parceira", taxId: "99777111000176" }, noVeiculoDela: true,
  cargas: [{ id: "c1", codigo: "CARGA-1", destino: "Belo Horizonte - MG", precisaDeCte: true, ctes: [] }],
  ufsDeDescarga: ["MG"], mdfes: [{ id: "d1", kind: "MDFE", accessKey: CHAVE_MDFE_SUB, unloadState: "MG", collectionId: null, issuedAt: "2026-10-03T00:00:00Z", hasXml: true, environment: "PRODUCAO", protocol: "135260000000300", sefazCode: null }], semCte: [{ id: "c1", codigo: "CARGA-1" }], ufsEmDobro: [],
};

afterEach(async () => { await desmontarTudo(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function api() {
  const pedidos: { url: string; method: string; body?: unknown }[] = [];
  let consultado = false;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    pedidos.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/consultar")) consultado = true;
    const corpo = init?.method === "POST" ? { id: "d1" } : { ...dados, mdfes: dados.mdfes.map((doc) => ({ ...doc, sefazCode: consultado ? 101 : null, sefazReason: consultado ? "Cancelado" : null, sefazCheckedAt: consultado ? "2026-11-12T15:00:00Z" : null })) };
    return new Response(JSON.stringify(corpo), { status: 200 });
  });
  return pedidos;
}

async function selecionar(tela: ParentNode, xml: string, tamanho?: number) {
  const input = tela.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input).not.toBeNull();
  const arquivo = new File([xml], "documento.xml", { type: "application/xml" });
  Object.defineProperty(arquivo, "text", { value: async () => xml });
  if (tamanho) Object.defineProperty(arquivo, "size", { value: tamanho });
  Object.defineProperty(input, "files", { value: [arquivo], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("XML e consulta na tela da subcontratada", () => {
  it("lê XML sem gravar ao selecionar e importa somente quando a pessoa confirma", async () => {
    const pedidos = api();
    const tela = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector('[data-importar-xml]')).not.toBeNull());
    await selecionar(tela, xmlDaSubcontratada("MDFE"));
    expect(tela.textContent).toContain("MG");
    expect(pedidos.filter((p) => p.method === "POST")).toHaveLength(0);
    await act(async () => { tela.querySelector('[data-importar-xml]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await ate(() => expect(tela.textContent).toContain("XML importado"));
    expect(pedidos.find((p) => p.url.endsWith("/importar"))).toMatchObject({ method: "POST", body: { xml: xmlDaSubcontratada("MDFE") } });
  });

  it("CT-e pede carga antes de enviar; erro de arquivo não dispara gravação", async () => {
    const pedidos = api();
    const tela = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector('[data-importar-xml]')).not.toBeNull());
    await selecionar(tela, xmlDaSubcontratada());
    expect(tela.querySelector('select[name="xmlCollectionId"]')).not.toBeNull();
    await act(async () => { tela.querySelector('[data-importar-xml]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(tela.querySelector('[role="alert"]')?.textContent).toContain("Escolha a carga");
    await selecionar(tela, "<erro/>");
    expect(tela.querySelector('[role="alert"]')?.textContent).toContain("XML");
    expect(pedidos.filter((p) => p.method === "POST")).toHaveLength(0);
  });

  it("mostra download privado e consulta explícita sem confundir protocolo com situação atual", async () => {
    const pedidos = api();
    const tela = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector('[data-consultar-documento="d1"]')).not.toBeNull());
    expect(tela.textContent).toContain("Não consultado");
    expect(tela.querySelector('a[download]')?.getAttribute("href")).toBe("/api/manifestos/v1/subcontratacao/d1/xml");
    expect(pedidos.filter((p) => p.method === "POST")).toHaveLength(0);
    await clicar(tela.querySelector('[data-consultar-documento="d1"]')!);
    await ate(() => expect(tela.textContent).toContain("Cancelado"));
    expect(pedidos.filter((p) => p.url.endsWith("/consultar"))).toHaveLength(1);
  });

  it("perfil de leitura baixa XML mas não importa nem consulta", async () => {
    api();
    const tela = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar={false} />);
    await ate(() => expect(tela.querySelector('a[download]')).not.toBeNull());
    expect(tela.querySelector('[data-importar-xml]')).toBeNull();
    expect(tela.querySelector('[data-consultar-documento]')).toBeNull();
  });
});

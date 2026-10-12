// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import type { ReciboDeFrete, SugestaoParaOMdfe } from "../src/lib/frete-contratado";
import type { ConferenciaDoMdfe, MdfesDaViagem } from "../src/lib/mdfe";
import type { CargaParaCte } from "../src/lib/nfe";
import { QUEM_EMITE_O_MDFE, avisoDeCargasSemCte, avisoDeMdfeEmDobro, type SubcontratacaoDaViagem } from "../src/lib/subcontratacao";
import type { CteEmitido } from "../src/lib/cte";

/**
 * As telas deste módulo: os documentos da subcontratada (aba MDF-e e aba Frete
 * da viagem, e o recibo), o botão "Usar o valor sugerido" do contrato, a
 * sugestão do contrato no pagamento do frete do MDF-e, as etapas do formulário
 * de minuta no celular e o menu "Mais" da lista de CT-e. As regras e as rotas
 * são testadas em `tests/subcontratacao.test.ts` e `tests/mdfe-rotas.test.ts`.
 */

const estado = vi.hoisted(() => ({ perfil: "ADMIN" }));

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: estado.perfil } } }) }));

import ColetasPage from "../src/app/dashboard/coletas/page";
import CtePage from "../src/app/dashboard/fiscal/cte/page";
import { MdfeDaViagem } from "../src/app/dashboard/fiscal/mdfe/painel";
import { FolhaDoRecibo } from "../src/app/dashboard/manifestos/[id]/recibo-frete/folha";
import { FreteDaViagem } from "../src/app/dashboard/manifestos/frete";
import { DocumentosDaSubcontratada } from "../src/app/dashboard/manifestos/subcontratacao";
import { TelaDaViagem } from "../src/app/dashboard/manifestos/viagem";
import type { Manifesto } from "../src/app/dashboard/manifestos/carregar";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: Record<string, unknown> | undefined };

/** Respostas por "MÉTODO endereço"; o GET dispensa o método. Uma lista de respostas é consumida em ordem. Endereço sem resposta é erro. */
function api(respostas: Record<string, Resposta | Resposta[]>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      pedidos.push({ url: String(url), method, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
      const achada = respostas[method === "GET" ? String(url) : `${method} ${String(url)}`];
      if (!achada) throw new Error(`Chamada inesperada: ${method} ${String(url)}`);
      const resposta = Array.isArray(achada) ? (achada.length > 1 ? achada.shift()! : achada[0]) : achada;
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return pedidos;
}

const digitar = async (campo: HTMLInputElement | HTMLSelectElement, valor: string) => {
  const prototipo = campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};

const enviarFormulario = async (formulario: Element) => {
  await act(async () => {
    formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

const campo = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(tela: ParentNode, nome: string) => tela.querySelector<T>(`[name="${nome}"]`)!;

/** A tela como o celular a vê (`true`) ou o computador (`false`): é o que o formulário de minuta pergunta ao abrir um bloco. */
const telaDeCelular = (celular: boolean) => vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: celular && consulta.includes("max-width"), media: consulta }));

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  estado.perfil = "ADMIN";
});

/* -------------------------- Documentos da subcontratada ------------------------ */

const CHAVE_DO_CTE = "35261099777111000176570010000003001000003004";
const CHAVE_DO_MDFE = "35261099777111000176580010000003011000003015";

const SUBCONTRATACAO: SubcontratacaoDaViagem = {
  viagem: { id: "v1", status: "ASSEMBLING" },
  parceiro: { id: "p1", name: "Transportes Subcontratada", taxId: "99777111000176" },
  noVeiculoDela: true,
  cargas: [
    { id: "c1", codigo: "9700000001", destino: "Belo Horizonte - MG", precisaDeCte: true, ctes: [{ id: "d1", kind: "CTE", accessKey: CHAVE_DO_CTE, collectionId: "c1", unloadState: null, issuedAt: "2026-10-03T00:00:00.000Z" }] },
    { id: "c2", codigo: "9700000002", destino: "Rio de Janeiro - RJ", precisaDeCte: true, ctes: [] },
    { id: "c3", codigo: "9700000003", destino: "São José do Rio Preto - SP", precisaDeCte: false, ctes: [] },
  ],
  ufsDeDescarga: ["MG", "RJ"],
  mdfes: [{ id: "d2", kind: "MDFE", accessKey: CHAVE_DO_MDFE, collectionId: null, unloadState: "MG", issuedAt: "2026-10-04T00:00:00.000Z" }],
  semCte: [{ id: "c2", codigo: "9700000002" }],
  ufsEmDobro: [],
};

describe("documentos da subcontratada", () => {
  it("recolhido (aba MDF-e): uma linha com o resumo; aberto, avisa quem o mostra e lista o MDF-e dela por UF e o CT-e dela por carga", async () => {
    api({ "/api/manifestos/v1/subcontratacao": { body: SUBCONTRATACAO } });
    const alternou = vi.fn();
    const tela = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar recolhido aoAlternar={alternou} />);
    await ate(() => expect(tela.querySelector('[data-subcontratacao="resumo"]')).not.toBeNull());
    expect(tela.querySelector('[data-subcontratacao="resumo"]')!.textContent).toMatch(/Subcontratada: Transportes Subcontratada.*MDF-e dela: 1 · CT-e dela: 1 \(1 carga sem\)/);
    expect(tela.querySelector("form")).toBeNull();

    await clicar(tela.querySelector("[data-abrir-subcontratacao]")!);
    expect(alternou).toHaveBeenLastCalledWith(true);
    expect(tela.querySelector("[data-quem-emite]")!.textContent).toBe(QUEM_EMITE_O_MDFE);
    expect(tela.querySelector('[data-lista="mdfe"]')!.textContent).toMatch(/MDF-e · descarga em MG · 04\/10\/2026/);
    expect(tela.querySelector(`[data-documento-da-subcontratada="${CHAVE_DO_MDFE}"]`)!.textContent).toContain("3526 1099 7771");
    const ctes = tela.querySelector('[data-lista="cte"]')!;
    expect(ctes.textContent).toMatch(/CT-e · carga 9700000001 · 03\/10\/2026/);
    expect(ctes.querySelector('[data-carga-sem-cte="c2"]')!.textContent).toBe("Carga 9700000002: sem CT-e da subcontratada.");
    // A carga que não sai do município não tem CT-e: não aparece como falta.
    expect(ctes.querySelector('[data-carga-sem-cte="c3"]')).toBeNull();
    expect(tela.querySelector("[data-mdfe-em-dobro]")).toBeNull();

    await clicar(tela.querySelector("[data-fechar-subcontratacao]")!);
    expect(alternou).toHaveBeenLastCalledWith(false);
    expect(tela.querySelector('[data-subcontratacao="resumo"]')).not.toBeNull();
  });

  it("registra o MDF-e (UF) e o CT-e (carga) dela, mostra a recusa da rota e exclui com confirmação", async () => {
    const pedidos = api({
      "/api/manifestos/v1/subcontratacao": { body: SUBCONTRATACAO },
      "POST /api/manifestos/v1/subcontratacao": [{ status: 400, body: { error: "A chave não foi emitida pelo CNPJ de Transportes Subcontratada." } }, { status: 201, body: { id: "d3" } }],
      "DELETE /api/manifestos/v1/subcontratacao/d2": { body: { success: true } },
    });
    const mudou = vi.fn();
    const tela = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar aoMudar={mudou} />);
    await ate(() => expect(tela.querySelector("[data-registrar-documento]")).not.toBeNull());
    const formulario = tela.querySelector("[data-registrar-documento]")!;

    // MDF-e: pede a UF, com as da viagem primeiro.
    expect(campo(tela, "collectionId")).toBeNull();
    expect([...campo<HTMLSelectElement>(tela, "unloadState").options].slice(0, 3).map((opcao) => opcao.value)).toEqual(["", "MG", "RJ"]);
    await digitar(campo<HTMLSelectElement>(tela, "unloadState"), "RJ");
    await digitar(campo(tela, "accessKey"), CHAVE_DO_MDFE);
    await digitar(campo(tela, "issuedAt"), "2026-10-05");
    await enviarFormulario(formulario);
    await ate(() => expect(tela.querySelector('[role="alert"]')?.textContent).toBe("A chave não foi emitida pelo CNPJ de Transportes Subcontratada."));
    expect(mudou).not.toHaveBeenCalled();

    // CT-e: pede a carga da viagem.
    await digitar(campo<HTMLSelectElement>(tela, "kind"), "CTE");
    expect(campo(tela, "unloadState")).toBeNull();
    expect([...campo<HTMLSelectElement>(tela, "collectionId").options].map((opcao) => opcao.textContent)).toEqual(["Escolha…", "9700000001 · Belo Horizonte - MG", "9700000002 · Rio de Janeiro - RJ", "9700000003 · São José do Rio Preto - SP"]);
    await digitar(campo<HTMLSelectElement>(tela, "collectionId"), "c2");
    await digitar(campo(tela, "accessKey"), CHAVE_DO_CTE);
    await enviarFormulario(formulario);
    await ate(() => expect(mudou).toHaveBeenCalledTimes(1));
    const enviados = pedidos.filter((pedido) => pedido.method === "POST").map((pedido) => pedido.body);
    expect(enviados[0]).toMatchObject({ kind: "MDFE", accessKey: CHAVE_DO_MDFE, unloadState: "RJ", issuedAt: "2026-10-05" });
    expect(enviados[1]).toMatchObject({ kind: "CTE", accessKey: CHAVE_DO_CTE, collectionId: "c2", issuedAt: "2026-10-05" });
    expect(campo(tela, "accessKey").value).toBe("");

    // Excluir pede confirmação: sem ela nada é enviado.
    const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const lixeira = () => tela.querySelector(`[data-documento-da-subcontratada="${CHAVE_DO_MDFE}"] [aria-label="Excluir documento"]`)!;
    await clicar(lixeira());
    expect(pedidos.some((pedido) => pedido.method === "DELETE")).toBe(false);
    await clicar(lixeira());
    await ate(() => expect(mudou).toHaveBeenCalledTimes(2));
    expect(confirmar).toHaveBeenCalledTimes(2);
    expect(pedidos.find((pedido) => pedido.method === "DELETE")!.url).toBe("/api/manifestos/v1/subcontratacao/d2");
  });

  it("quem só lê não registra nem exclui; MDF-e em dobro é avisado; fora do veículo dela a frase de quem emite não aparece", async () => {
    api({ "/api/manifestos/v1/subcontratacao": { body: { ...SUBCONTRATACAO, noVeiculoDela: false, ufsEmDobro: ["MG"] } } });
    const tela = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar={false} />);
    await ate(() => expect(tela.querySelector('[data-subcontratacao="documentos"]')).not.toBeNull());
    expect(tela.querySelector("[data-registrar-documento]")).toBeNull();
    expect(tela.querySelector('[aria-label="Excluir documento"]')).toBeNull();
    expect(tela.querySelector("[data-quem-emite]")).toBeNull();
    expect(tela.querySelector("[data-mdfe-em-dobro]")!.textContent).toBe(avisoDeMdfeEmDobro(["MG"]));
  });

  it("viagem sem transportadora contratada, sem acesso ou com erro: recolhido não ocupa a tela; aberto diz o motivo", async () => {
    api({
      "/api/manifestos/v1/subcontratacao": { body: { ...SUBCONTRATACAO, parceiro: null, mdfes: [], semCte: [] } },
      "/api/manifestos/v2/subcontratacao": { status: 403, body: { error: "Acesso negado" } },
    });
    const semParceiro = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar recolhido />);
    const negado = await montar(<DocumentosDaSubcontratada manifestId="v2" podeAlterar recolhido />);
    const aberto = await montar(<DocumentosDaSubcontratada manifestId="v1" podeAlterar />);
    const negadoAberto = await montar(<DocumentosDaSubcontratada manifestId="v2" podeAlterar />);
    await ate(() => expect(aberto.querySelector('[data-subcontratacao="sem-parceiro"]')).not.toBeNull());
    await ate(() => expect(negadoAberto.querySelector('[role="alert"]')?.textContent).toBe("Seu perfil não tem acesso aos documentos fiscais."));
    expect(semParceiro.innerHTML).toBe("");
    expect(negado.innerHTML).toBe("");
  });

  it("o recibo traz a seção dos documentos dela, com a chave em blocos e as cargas sem CT-e", async () => {
    const recibo: ReciboDeFrete = {
      empresa: { name: "Transportadora de Teste", logo: null },
      emitidoEm: "2026-10-12T15:00:00.000Z",
      parceiro: { nome: "Transportes Subcontratada", documento: "99777111000176", rntrc: "12345678", tipo: "TRANSPORTADORA" },
      viagem: { id: "v1", codigo: "ABCDEF", situacao: "FINISHED", saiuEm: null, finalizadaEm: null, placa: "SBC1A24", veiculo: "Truck", motorista: "João", origens: ["Rio Preto - SP"], destinos: ["Belo Horizonte - MG"] },
      contrato: { situacao: "ABERTO", forma: "FIXO", base: 1000, observacao: null, grossAmount: 1000, tollAmount: 0, otherAdditions: 0, discounts: 0, inss: 0, irrf: 0, sestSenat: 0, otherWithholdings: 0 },
      valores: { bruto: 1000, acrescimos: 0, descontos: 0, retencoes: 0, liquido: 1000, custo: 1000 },
      pagamentos: [],
      pago: 0,
      saldo: 1000,
      subcontratacao: {
        documentos: [
          { id: "d1:c1", tipo: "CTE", chave: CHAVE_DO_CTE, data: "2026-10-03T00:00:00.000Z", carga: "9700000001", uf: null },
          { id: "d2", tipo: "MDFE", chave: CHAVE_DO_MDFE, data: "2026-10-04T00:00:00.000Z", carga: null, uf: "MG" },
        ],
        cargasSemCte: ["9700000002"],
      },
    };
    const tela = await montar(<FolhaDoRecibo recibo={recibo} />);
    const secao = tela.querySelector('[data-secao="subcontratacao"]')!;
    expect(secao.querySelector("h2")!.textContent).toBe("Documentos da subcontratada");
    expect(secao.querySelector(`[data-documento="${CHAVE_DO_CTE}"]`)!.textContent).toMatch(/CT-e · carga 9700000001 · 03\/10\/2026.*3526 1099 7771 1100 0176 5700/);
    expect(secao.querySelector(`[data-documento="${CHAVE_DO_MDFE}"]`)!.textContent).toMatch(/MDF-e · descarga em MG · 04\/10\/2026/);
    expect(secao.querySelector("[data-sem-cte]")!.textContent).toBe("Sem CT-e da subcontratada: 9700000002.");

    const vazio = await montar(<FolhaDoRecibo recibo={{ ...recibo, subcontratacao: { documentos: [], cargasSemCte: [] } }} />);
    expect(vazio.querySelector('[data-secao="subcontratacao"]')!.textContent).toContain("Nenhum CT-e ou MDF-e da subcontratada registrado.");
    expect(vazio.querySelector("[data-sem-cte]")).toBeNull();
  });
});

/* ----------------------------------- Aba Frete --------------------------------- */

const CONTRATO = {
  id: "ct1",
  carrierId: "p1",
  calcMode: "POR_KM",
  calcBase: 2.5,
  grossAmount: 0,
  tollAmount: 0,
  otherAdditions: 0,
  discounts: 0,
  inss: 0,
  irrf: 0,
  sestSenat: 0,
  otherWithholdings: 0,
  status: "ABERTO",
  notes: null,
  carrier: { id: "p1", name: "Transportes Subcontratada" },
  payments: [],
  valores: { bruto: 0, acrescimos: 0, descontos: 0, retencoes: 0, liquido: 0, custo: 0 },
  pago: 0,
  adiantado: 0,
  saldo: 0,
  sugerido: 1050 as number | null,
};

const FRETE = {
  viagem: { id: "v1", status: "FINISHED", freteDasCargas: 2000, km: 420, entregas: 2 },
  parceiroDoVeiculo: { id: "p1", name: "Transportes Subcontratada" },
  contrato: CONTRATO,
  parceiros: [{ id: "p1", name: "Transportes Subcontratada", type: "TRANSPORTADORA", active: true, defaultCalcMode: "POR_KM", defaultCalcBase: 2.5 }],
  subcontratacao: null as { ctes: number; mdfes: number; semCte: { id: string; codigo: string }[] } | null,
};

describe("aba Frete: valor sugerido, documentos da subcontratada e aviso ao quitar", () => {
  it("contrato por km com a viagem já com km: mostra o sugerido ao lado do gravado e só muda com o botão", async () => {
    const depois = { ...FRETE, contrato: { ...CONTRATO, grossAmount: 1050, valores: { ...CONTRATO.valores, bruto: 1050, liquido: 1050, custo: 1050 }, saldo: 1050 } };
    const pedidos = api({ "/api/manifestos/v1/frete": [{ body: FRETE }, { body: depois }], "PUT /api/manifestos/v1/frete": { body: depois.contrato } });
    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector("[data-sugerido-diferente]")).not.toBeNull());
    expect(tela.querySelector("[data-sugerido-diferente]")!.textContent).toMatch(/A forma de cálculo dá R\$\s1\.050,00 hoje; o bruto gravado é R\$\s0,00\./);
    // Nada foi gravado só por abrir a aba.
    expect(pedidos.filter((pedido) => pedido.method !== "GET")).toHaveLength(0);

    const botao = tela.querySelector<HTMLButtonElement>("[data-usar-sugerido]")!;
    expect(botao.textContent).toBe("Usar o valor sugerido");
    await clicar(botao);
    await ate(() => expect(tela.querySelector("[data-sugerido-diferente]")).toBeNull());
    const gravado = pedidos.find((pedido) => pedido.method === "PUT")!;
    // O contrato vai como estava, só com o bruto sugerido.
    expect(gravado.body).toEqual({ carrierId: "p1", calcMode: "POR_KM", calcBase: "2,5", grossAmount: "1050", tollAmount: "", otherAdditions: "", discounts: "", inss: "", irrf: "", sestSenat: "", otherWithholdings: "", notes: "" });
    expect(tela.querySelector('[data-linha="Líquido"] dd')!.textContent).toMatch(/1\.050,00/);
  });

  it("quem só lê vê a diferença, sem o botão; a recusa da rota aparece e o valor continua o gravado", async () => {
    api({ "/api/manifestos/v1/frete": { body: FRETE } });
    const soLe = await montar(<FreteDaViagem manifestId="v1" podeAlterar={false} />);
    await ate(() => expect(soLe.querySelector("[data-sugerido-diferente]")).not.toBeNull());
    expect(soLe.querySelector("[data-usar-sugerido]")).toBeNull();

    api({ "/api/manifestos/v1/frete": { body: FRETE }, "PUT /api/manifestos/v1/frete": { status: 409, body: { error: "O líquido ficaria menor do que já foi pago." } } });
    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector("[data-usar-sugerido]")).not.toBeNull());
    await clicar(tela.querySelector("[data-usar-sugerido]")!);
    await ate(() => expect(tela.querySelector('[role="alert"]')?.textContent).toBe("O líquido ficaria menor do que já foi pago."));
    expect(tela.querySelector("[data-sugerido-diferente]")).not.toBeNull();
  });

  it("contrato com transportadora: o resumo diz os documentos dela e as cargas sem CT-e, e abre os documentos para quem lê o fiscal", async () => {
    const comDocumentos = { ...FRETE, contrato: { ...CONTRATO, sugerido: null }, subcontratacao: { ctes: 1, mdfes: 1, semCte: [{ id: "c2", codigo: "9700000002" }] } };
    api({ "/api/manifestos/v1/frete": { body: comDocumentos }, "/api/manifestos/v1/subcontratacao": { body: SUBCONTRATACAO } });

    // O financeiro puro não lê o fiscal? Lê (`fiscalVer`), mas quem não lê não ganha o botão.
    const semFiscal = await montar(<FreteDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(semFiscal.querySelector("[data-documentos-da-subcontratada]")).not.toBeNull());
    expect(semFiscal.querySelector("[data-documentos-da-subcontratada]")!.textContent).toBe("Subcontratada: 1 CT-e e 1 MDF-e dela registrados · sem CT-e dela: 9700000002");
    expect(semFiscal.querySelector("[data-abrir-documentos]")).toBeNull();

    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar veFiscal alteraFiscal={false} />);
    await ate(() => expect(tela.querySelector("[data-abrir-documentos]")).not.toBeNull());
    await clicar(tela.querySelector("[data-abrir-documentos]")!);
    await ate(() => expect(tela.querySelector('[data-frete="documentos"] [data-subcontratacao="documentos"]')).not.toBeNull());
    // Lê o fiscal e não escreve: vê os documentos, sem o formulário de registro.
    expect(tela.querySelector("[data-registrar-documento]")).toBeNull();
    await clicar(porTexto(tela.querySelector('[data-frete="documentos"]')!, "button", "Voltar")[0]);
    expect(tela.querySelector('[data-frete="resumo"]')).not.toBeNull();

    // Com agregado ou veículo próprio a linha não existe.
    api({ "/api/manifestos/v1/frete": { body: { ...FRETE, contrato: { ...CONTRATO, sugerido: null } } } });
    const semSubcontratada = await montar(<FreteDaViagem manifestId="v1" podeAlterar veFiscal />);
    await ate(() => expect(semSubcontratada.querySelector('[data-frete="resumo"]')).not.toBeNull());
    expect(semSubcontratada.querySelector("[data-documentos-da-subcontratada]")).toBeNull();
  });

  it("ao quitar com carga sem CT-e dela: o formulário avisa (sem bloquear) e o aviso da rota fica no resumo; adiantamento parcial não avisa", async () => {
    const semCte = [{ id: "c2", codigo: "9700000002" }];
    const contrato = { ...CONTRATO, calcMode: "FIXO", calcBase: 1000, grossAmount: 1000, sugerido: 1000, valores: { ...CONTRATO.valores, bruto: 1000, liquido: 1000, custo: 1000 }, saldo: 1000 };
    const antes = { ...FRETE, contrato, subcontratacao: { ctes: 1, mdfes: 0, semCte } };
    const aviso = avisoDeCargasSemCte(semCte)!;
    const pedidos = api({
      "/api/manifestos/v1/frete": { body: antes },
      "POST /api/manifestos/v1/frete/pagamentos": { status: 201, body: { pagamento: { id: "pg1" }, contrato: { ...contrato, status: "QUITADO" }, aviso } },
    });
    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector("[data-adiantar-frete]")).not.toBeNull());

    await clicar(tela.querySelector("[data-adiantar-frete]")!);
    await digitar(campo(tela, "amount"), "300");
    expect(tela.querySelector("[data-aviso-sem-cte]")).toBeNull();
    await digitar(campo(tela, "amount"), "1000");
    expect(tela.querySelector("[data-aviso-sem-cte]")!.textContent).toBe(aviso);

    // O aviso não impede: o pagamento é enviado, e o que a rota avisou fica no resumo (não é erro).
    await enviarFormulario(tela.querySelector('[data-frete="pagar"]')!);
    await ate(() => expect(tela.querySelector('[data-frete="resumo"]')).not.toBeNull());
    expect(pedidos.filter((pedido) => pedido.method === "POST")).toHaveLength(1);
    expect(tela.querySelector("[data-aviso-do-pagamento]")!.textContent).toBe(aviso);
    expect(tela.querySelector('[role="alert"]')).toBeNull();
  });
});

/* ------------------------- Sugestão do contrato no MDF-e ----------------------- */

const SUGESTAO: SugestaoParaOMdfe = {
  contratado: { nome: "Transportes Subcontratada", documento: "99777111000176" },
  pagador: { nome: "Minha Transportadora Ltda", documento: "99000108000141" },
  valor: 1050.5,
  adiantamento: 400,
  aPrazo: true,
  forma: "PIX",
  pix: "pix@subcontratada.br",
};

const CONFERENCIA: ConferenciaDoMdfe = { ufDeDescarga: "MG", pendencias: [], avisos: [], resumo: null, entradas: {}, mdfe: null };
const DA_VIAGEM: MdfesDaViagem = { pronta: true, faltas: [], ambiente: "PRODUCAO", damdfe: false, documentos: [CONFERENCIA], reboques: [] };
const ENDERECO_DO_MDFE = "/api/fiscal/mdfe/emissao?manifestId=v1";
const ENDERECO_DA_SUGESTAO = "/api/manifestos/v1/frete/sugestao-mdfe";

describe("pagamento do frete no MDF-e: sugestão do contrato", () => {
  const valorDe = (tela: HTMLElement, nome: string) => tela.querySelector<HTMLInputElement>(`[data-campo="${nome}"]`)!;

  async function abrir(veFrete: boolean, respostas: Record<string, Resposta> = {}) {
    const pedidos = api({ [ENDERECO_DO_MDFE]: { body: DA_VIAGEM }, "POST /api/fiscal/mdfe/conferencia": { body: CONFERENCIA }, ...respostas });
    const tela = await montar(<MdfeDaViagem manifestId="v1" podeAlterar veFrete={veFrete} />);
    await ate(() => expect(tela.querySelector("[data-informar]")).not.toBeNull());
    await clicar(tela.querySelector("[data-informar]")!);
    return { tela, pedidos };
  }

  it("quem lê o frete contratado vê a sugestão como exemplo nos campos em branco; nada vai para a rota até aceitar", async () => {
    const { tela, pedidos } = await abrir(true, { [ENDERECO_DA_SUGESTAO]: { body: { sugestao: SUGESTAO } } });
    await ate(() => expect(tela.querySelector("[data-sugestao-do-contrato]")).not.toBeNull());
    expect(tela.querySelector("[data-sugestao-do-contrato]")!.textContent).toMatch(/Sugestão do contrato de frete com Transportes Subcontratada: R\$\s1\.050,50, adiantamento pago de R\$\s400,00, a prazo, por Pix\./);

    // Os campos continuam em branco: a sugestão é o exemplo apagado do campo.
    expect(valorDe(tela, "valorDoFrete").value).toBe("");
    expect(valorDe(tela, "valorDoFrete").placeholder).toBe("1050,5");
    expect(valorDe(tela, "pagador").value).toBe("");
    expect(valorDe(tela, "pagador").placeholder).toBe("99000108000141");
    expect(valorDe(tela, "pix").placeholder).toBe("pix@subcontratada.br");

    // Conferir sem aceitar: o grupo de pagamento não vai.
    await clicar(tela.querySelector("[data-conferir]")!);
    await ate(() => expect(pedidos.some((pedido) => pedido.method === "POST")).toBe(true));
    expect((pedidos.find((pedido) => pedido.method === "POST")!.body!.entradas as Record<string, unknown>).pagamento).toBeUndefined();

    // Aceita: os campos são preenchidos e passam a ir no pedido.
    await clicar(tela.querySelector("[data-usar-sugestao]")!);
    expect(valorDe(tela, "valorDoFrete").value).toBe("1050,5");
    expect(valorDe(tela, "pagador").value).toBe("99000108000141");
    expect(valorDe(tela, "pix").value).toBe("pix@subcontratada.br");
    expect(valorDe(tela, "aPrazo").checked).toBe(true);
    expect(valorDe(tela, "adiantamento").value).toBe("400");
    expect(valorDe(tela, "vencimento").value).toBe("");
    await clicar(tela.querySelector("[data-conferir]")!);
    await ate(() => expect(pedidos.filter((pedido) => pedido.method === "POST")).toHaveLength(2));
    expect((pedidos.filter((pedido) => pedido.method === "POST")[1].body!.entradas as Record<string, unknown>).pagamento).toMatchObject({ documento: "99000108000141", valor: "1050,5", aPrazo: true, adiantamento: "400", conta: { pix: "pix@subcontratada.br" } });
  });

  it("quem não lê o frete contratado nem pergunta: os campos ficam em branco, sem exemplo e sem a linha da sugestão", async () => {
    // Sem resposta cadastrada para a rota da sugestão: se a tela a chamasse, o teste acusaria.
    const { tela, pedidos } = await abrir(false);
    expect(pedidos.map((pedido) => pedido.url)).toEqual([ENDERECO_DO_MDFE]);
    expect(tela.querySelector("[data-sugestao-do-contrato]")).toBeNull();
    expect(tela.querySelector("[data-usar-sugestao]")).toBeNull();
    for (const nome of ["pagador", "valorDoFrete", "pix"]) {
      expect(valorDe(tela, nome).value, nome).toBe("");
      expect(valorDe(tela, nome).placeholder, nome).toBe("");
    }
    expect(tela.textContent).not.toContain("1.050,50");
  });

  it("sem contrato (sugestão nula) ou com a rota recusando (403): a tela fica como sempre foi", async () => {
    const semContrato = await abrir(true, { [ENDERECO_DA_SUGESTAO]: { body: { sugestao: null } } });
    await ate(() => expect(semContrato.pedidos.some((pedido) => pedido.url === ENDERECO_DA_SUGESTAO)).toBe(true));
    expect(semContrato.tela.querySelector("[data-sugestao-do-contrato]")).toBeNull();
    expect(valorDe(semContrato.tela, "valorDoFrete").placeholder).toBe("");

    const recusada = await abrir(true, { [ENDERECO_DA_SUGESTAO]: { status: 403, body: { error: "Acesso negado" } } });
    await ate(() => expect(recusada.pedidos.some((pedido) => pedido.url === ENDERECO_DA_SUGESTAO)).toBe(true));
    expect(recusada.tela.querySelector("[data-sugestao-do-contrato]")).toBeNull();
    expect(valorDe(recusada.tela, "valorDoFrete").placeholder).toBe("");
  });
});

describe("aba MDF-e da viagem com veículo de parceiro", () => {
  const manifesto = (carrierId: string | null): Manifesto => ({
    id: "v1",
    status: "ASSEMBLING",
    createdAt: "2026-10-10T12:00:00.000Z",
    driver: { id: "m1", user: { name: "João" }, cpf: "52998224725", active: true },
    vehicle: { id: "ve1", plate: "SBC1A24", model: "Truck", type: "TRUCK", status: "AVAILABLE", carrierId },
    collections: [],
  });
  const tela = (carrierId: string | null) => <TelaDaViagem manifesto={manifesto(carrierId)} veAcerto={false} aprovaDespesa={false} veFiscal emiteFiscal abaInicial="MDF-e" onClose={() => {}} onChange={() => {}} />;

  it("mostra a linha da subcontratada acima do MDF-e; com os documentos dela abertos, o MDF-e próprio sai da frente", async () => {
    const pedidos = api({ [ENDERECO_DO_MDFE]: { body: DA_VIAGEM }, "/api/manifestos/v1/subcontratacao": { body: SUBCONTRATACAO } });
    const montada = await montar(tela("p1"));
    await ate(() => expect(montada.querySelector('[data-subcontratacao="resumo"]')).not.toBeNull());
    await ate(() => expect(montada.querySelector("[data-mdfe-da-viagem]")).not.toBeNull());
    // Quem não lê o frete contratado (o perfil deste teste) não pergunta pela sugestão do contrato.
    expect(pedidos.map((pedido) => pedido.url).sort()).toEqual(["/api/manifestos/v1/subcontratacao", ENDERECO_DO_MDFE].sort());

    await clicar(montada.querySelector("[data-abrir-subcontratacao]")!);
    expect(montada.querySelector('[data-subcontratacao="documentos"]')).not.toBeNull();
    expect(montada.querySelector("[data-mdfe-da-viagem]")).toBeNull();
    await clicar(montada.querySelector("[data-fechar-subcontratacao]")!);
    await ate(() => expect(montada.querySelector("[data-mdfe-da-viagem]")).not.toBeNull());
  });

  it("veículo próprio: a aba MDF-e fica como sempre foi, sem perguntar pela subcontratação", async () => {
    const pedidos = api({ [ENDERECO_DO_MDFE]: { body: DA_VIAGEM } });
    const montada = await montar(tela(null));
    await ate(() => expect(montada.querySelector("[data-mdfe-da-viagem]")).not.toBeNull());
    expect(pedidos.map((pedido) => pedido.url)).toEqual([ENDERECO_DO_MDFE]);
    expect(montada.querySelector("[data-subcontratacao]")).toBeNull();
  });
});

/* ----------------------- Formulário de minuta no celular ----------------------- */

describe("formulário de minuta: os blocos opcionais como etapas no celular", () => {
  const cliente = { id: "cli1", tradeName: "Cliente", companyName: "Cliente Ltda", active: true };
  const bloco = (tela: HTMLElement, nome: string) => tela.querySelector<HTMLElement>(`[data-bloco="${nome}"]`)!;
  const botao = (tela: HTMLElement, nome: string) => tela.querySelector<HTMLButtonElement>(`[data-secao="${nome}"]`)!;
  const conteudo = (tela: HTMLElement, nome: string) => tela.querySelector<HTMLElement>(`[data-conteudo-do-bloco="${nome}"]`);
  const escondidoNoCelular = (no: Element) => /(^| )hidden( |$)/.test(no.className) && /md:(block|grid|flex|inline)/.test(no.className);
  const titulo = (tela: HTMLElement) => tela.querySelector("[data-titulo-do-formulario]")!;
  /** O rodapé com "Salvar Minuta". */
  const rodape = (tela: HTMLElement) => porTexto(tela, "button", "Salvar Minuta")[0].parentElement!;

  async function abrirFormulario() {
    const pedidos = api({ "/api/coletas": { body: [] }, "/api/clientes": { body: [cliente] }, "/api/motoristas": { body: [] }, "POST /api/coletas": { status: 201, body: {} } });
    const tela = await montar(<ColetasPage />);
    await ate(() => expect(tela.querySelector('[aria-label="Buscar coletas"]')).not.toBeNull());
    await clicar(porTexto(tela, "button", "Nova Minuta")[0]);
    return { tela, pedidos };
  }

  it.each(["redespacho", "pedido", "endereco"] as const)("no celular, abrir \"%s\" vira uma etapa em tela cheia: o resto do formulário e o Salvar saem da frente, e Concluir volta", async (nome) => {
    telaDeCelular(true);
    const { tela } = await abrirFormulario();
    expect(tela.querySelector("[data-concluir-etapa]")).toBeNull();
    expect(titulo(tela).textContent).toBe("Emitir Nova Minuta");

    await clicar(botao(tela, nome));
    // O bloco aberto fica; os outros dois, o formulário principal e o rodapé de salvar somem no celular (e voltam no computador, pelas classes `md:`).
    expect(escondidoNoCelular(bloco(tela, nome))).toBe(false);
    expect(escondidoNoCelular(conteudo(tela, nome)!)).toBe(false);
    expect(escondidoNoCelular(botao(tela, nome))).toBe(true);
    for (const outro of ["redespacho", "pedido", "endereco"].filter((cada) => cada !== nome)) expect(escondidoNoCelular(bloco(tela, outro)), outro).toBe(true);
    for (const rotulo of ["Cliente (Pagador) *", "Alocar Motorista (Opcional)"]) expect(escondidoNoCelular(porTexto(tela, "label", rotulo)[0].parentElement!), rotulo).toBe(true);
    expect(escondidoNoCelular(porTexto(tela, "label", "Volumes *")[0].parentElement!.parentElement!)).toBe(true);
    expect(escondidoNoCelular(porTexto(tela, "h3", "Origem")[0].parentElement!.parentElement!)).toBe(true);
    expect(escondidoNoCelular(rodape(tela))).toBe(true);
    // O título do formulário, no celular, é o da etapa.
    expect(titulo(tela).querySelector(".md\\:hidden")!.textContent).toMatch(/^(Redespacho \/ subcontratação|Janela, prioridade e cubagem|Endereço da entrega)$/);

    await clicar(tela.querySelector("[data-concluir-etapa]")!);
    expect(tela.querySelector("[data-concluir-etapa]")).toBeNull();
    expect(escondidoNoCelular(rodape(tela))).toBe(false);
    for (const cada of ["redespacho", "pedido", "endereco"]) expect(escondidoNoCelular(bloco(tela, cada)), cada).toBe(false);
    // De volta ao formulário, o que foi aberto fica guardado e fora da frente: no celular o bloco não se estende na página.
    expect(botao(tela, nome).getAttribute("aria-expanded")).toBe("true");
    expect(escondidoNoCelular(conteudo(tela, nome)!)).toBe(true);
    expect(escondidoNoCelular(botao(tela, nome))).toBe(false);
  });

  it("no celular, o que se digita na etapa vai no pedido ao salvar depois de concluir", async () => {
    telaDeCelular(true);
    const { tela, pedidos } = await abrirFormulario();
    await clicar(botao(tela, "redespacho"));
    await digitar(tela.querySelector<HTMLSelectElement>("#coleta-servico")!, "REDISPATCH");
    await digitar(tela.querySelector<HTMLInputElement>("#coleta-shipperName")!, "Centro de Distribuição");
    await clicar(tela.querySelector("[data-concluir-etapa]")!);
    expect(botao(tela, "redespacho").textContent).toContain("Redespacho / subcontratação: Redespacho");

    await clicar(botao(tela, "endereco"));
    await digitar(tela.querySelector<HTMLInputElement>("#coleta-rua")!, "Rua das Flores");
    await clicar(tela.querySelector("[data-concluir-etapa]")!);

    const doRotulo = (texto: string, indice = 0) => porTexto(tela, "label", texto)[indice].parentElement!.querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!;
    await digitar(doRotulo("Cliente (Pagador)"), "cli1");
    await digitar(doRotulo("Remetente *"), "Remetente");
    await digitar(doRotulo("Destinatário *"), "Destinatário");
    await digitar(doRotulo("Cidade - UF *", 0), "Mirassol - SP");
    await digitar(doRotulo("Cidade - UF *", 1), "Uberaba - MG");
    await clicar(porTexto(tela, "button", "Salvar Minuta")[0]);
    await ate(() => expect(pedidos.some((pedido) => pedido.method === "POST")).toBe(true));
    expect(pedidos.find((pedido) => pedido.method === "POST")!.body).toMatchObject({ serviceType: "REDISPATCH", shipperName: "Centro de Distribuição", deliveryStreet: "Rua das Flores" });
  });

  it("no computador nada muda: o bloco abre e fecha no lugar, sem etapa", async () => {
    telaDeCelular(false);
    const { tela } = await abrirFormulario();
    await clicar(botao(tela, "redespacho"));
    expect(botao(tela, "redespacho").getAttribute("aria-expanded")).toBe("true");
    expect(tela.querySelector("[data-concluir-etapa]")).toBeNull();
    expect(titulo(tela).textContent).toBe("Emitir Nova Minuta");
    expect(escondidoNoCelular(rodape(tela))).toBe(false);
    for (const cada of ["redespacho", "pedido", "endereco"]) expect(escondidoNoCelular(bloco(tela, cada)), cada).toBe(false);
    // Dois blocos abertos ao mesmo tempo, como sempre foi.
    await clicar(botao(tela, "pedido"));
    expect(conteudo(tela, "pedido")).not.toBeNull();
    expect(conteudo(tela, "redespacho")).not.toBeNull();
    await clicar(botao(tela, "redespacho"));
    expect(botao(tela, "redespacho").getAttribute("aria-expanded")).toBe("false");
    expect(conteudo(tela, "redespacho")).toBeNull();
  });
});

/* ------------------------------- Lista de CT-e -------------------------------- */

describe("lista de CT-e: ações principais à vista e o resto no menu Mais", () => {
  const emitido = (trocas: Partial<CteEmitido> = {}): CteEmitido =>
    ({
      id: "cte1",
      numero: 40,
      serie: 1,
      chave: "35261099000108000141570010000000401000000409",
      situacao: "AUTHORIZED",
      ambiente: "PRODUCAO",
      protocolo: "135260000000001",
      autorizadoEm: "2026-10-10T12:00:00.000Z",
      cStat: 100,
      motivo: "Autorizado o uso do CT-e",
      semResposta: false,
      svc: null,
      ...trocas,
    }) as CteEmitido;

  const carga = (trocas: Partial<CargaParaCte> = {}): CargaParaCte =>
    ({
      id: "c1",
      trackingCode: "9700000001",
      status: "ROUTE",
      sender: "INDUSTRIA REMETENTE DE NOME MUITO COMPRIDO S/A",
      receiver: "COMERCIO DESTINATARIO DE NOME MUITO COMPRIDO LTDA",
      origin: "São José do Rio Preto - SP",
      destination: "Santana do Livramento - RS",
      volumes: 3,
      weight: 42.5,
      invoiceKey: null,
      invoiceValue: 1534.56,
      freightValue: 120,
      cteKey: null,
      cteNumber: null,
      cteStatus: null,
      client: { companyName: "Cliente de Teste de Razão Social Longa Ltda", tradeName: null, cnpj: "99000108000141" },
      emitido: emitido(),
      aResolver: [],
      comprovanteAceito: true,
      ...trocas,
    }) as CargaParaCte;

  const PRONTA = { body: { pronta: true, ambiente: "PRODUCAO", faltas: [], dacte: true } };

  async function abrir(cargas: CargaParaCte[]) {
    api({ "/api/fiscal/cte": { body: cargas }, "/api/fiscal/cte/situacao": PRONTA, "/api/fiscal/cte/emissao/cte1/eventos": { body: { eventos: [], podeCancelar: true } } });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelectorAll("tr[data-carga]")).toHaveLength(cargas.length));
    await ate(() => expect(tela.querySelector("[data-dacte]")).not.toBeNull());
    return tela;
  }
  const linha = (tela: HTMLElement, id: string) => tela.querySelector<HTMLElement>(`tr[data-carga="${id}"]`)!;
  const aVista = (tela: HTMLElement, id: string) => [...linha(tela, id).querySelector("[data-acoes]")!.children].map((no) => (no.matches("[data-mais]") ? "Mais" : no.textContent));
  const noMenu = (tela: HTMLElement, id: string) => [...linha(tela, id).querySelectorAll("[data-mais] [data-acao]")].map((no) => no.textContent);

  it("CT-e autorizado com seis ações: três à vista e três no menu; nenhuma quebra no meio da palavra", async () => {
    const tela = await abrir([carga()]);
    expect(aVista(tela, "c1")).toEqual(["Baixar XML", "Corrigir", "DACTE (PDF)", "Mais"]);
    expect(noMenu(tela, "c1")).toEqual(["Entrega na SEFAZ", "Conferir na SEFAZ", "Cancelar"]);
    for (const acao of linha(tela, "c1").querySelectorAll("[data-acoes] > :not([data-mais]), [data-mais] summary, [data-mais] [data-acao]")) {
      expect(acao.className, acao.textContent ?? "").toContain("whitespace-nowrap");
    }
    // O menu é um <details>: nasce fechado, abre no "Mais" e fecha ao escolher a ação ou ao clicar fora.
    const menu = linha(tela, "c1").querySelector<HTMLDetailsElement>("[data-mais]")!;
    expect(menu.tagName).toBe("DETAILS");
    expect(menu.open).toBe(false);
    expect(menu.querySelector("summary")!.textContent).toBe("Mais ▾");

    await act(async () => {
      menu.open = true;
    });
    await clicar(document.body);
    expect(menu.open).toBe(false);

    await act(async () => {
      menu.open = true;
    });
    await clicar(menu.querySelector('[data-acao="cancelar"]')!);
    expect(menu.open).toBe(false);
    expect(tela.querySelector('[role="dialog"][aria-label="Cancelar CT-e"]')).not.toBeNull();
  });

  it("o que fica à vista e o que vai para o menu em cada situação; uma ação secundária só não vira menu", async () => {
    const tela = await abrir([
      carga(),
      carga({ id: "c2", comprovanteAceito: false }),
      carga({ id: "c3", emitido: null }),
      carga({ id: "c4", emitido: emitido({ id: "cte4", situacao: "DRAFT", protocolo: null, autorizadoEm: null, semResposta: true }) }),
      carga({ id: "c5", emitido: emitido({ id: "cte5", situacao: "CANCELLED" }) }),
    ]);
    expect(noMenu(tela, "c2")).toEqual(["Conferir na SEFAZ", "Cancelar"]);
    // Não emitido: as duas ações cabem à vista, sem menu.
    expect(aVista(tela, "c3")).toEqual(["Conferir e emitir", "Registrar CT-e de fora"]);
    expect(linha(tela, "c3").querySelector("[data-mais]")).toBeNull();
    expect(aVista(tela, "c4")).toEqual(["Conferir e emitir", "Mais"]);
    expect(noMenu(tela, "c4")).toEqual(["Conferir na SEFAZ", "Registrar CT-e de fora"]);
    expect(aVista(tela, "c5")).toEqual(["Conferir e emitir", "Baixar XML", "Mais"]);
    expect(noMenu(tela, "c5")).toEqual(["Conferir na SEFAZ", "Registrar CT-e de fora"]);
  });

  it("texto cortado tem a dica com o texto inteiro; a rota quebra a linha no celular; a coluna Ações devolveu largura", async () => {
    const tela = await abrir([carga()]);
    const cortados = [...linha(tela, "c1").querySelectorAll<HTMLElement>("[title]")].map((no) => [no.getAttribute("title"), no.textContent]);
    expect(cortados).toEqual([
      ["Cliente de Teste de Razão Social Longa Ltda", "Cliente de Teste de Razão Social Longa Ltda"],
      ["INDUSTRIA REMETENTE DE NOME MUITO COMPRIDO S/A", "INDUSTRIA REMETENTE DE NOME MUITO COMPRIDO S/A"],
      ["COMERCIO DESTINATARIO DE NOME MUITO COMPRIDO LTDA", "COMERCIO DESTINATARIO DE NOME MUITO COMPRIDO LTDA"],
      ["São José do Rio Preto - SP", "São José do Rio Preto - SP"],
      ["Santana do Livramento - RS", "Santana do Livramento - RS"],
    ]);
    // Todo `truncate` da linha tem dica.
    for (const no of linha(tela, "c1").querySelectorAll("[class*='truncate']")) expect(no.getAttribute("title"), no.textContent ?? "").toBeTruthy();
    // A rota só corta no computador (`md:truncate`); no celular quebra a linha.
    for (const no of linha(tela, "c1").querySelectorAll('[data-rotulo="Rota"] span')) {
      expect(no.className).toContain("md:truncate");
      expect(no.className).toContain("break-words");
      expect(no.className).not.toMatch(/(^| )truncate( |$)/);
    }
    const larguras = [...tela.querySelectorAll("thead th")].map((th) => [th.textContent, /md:w-\[(\d+)%\]/.exec(th.className)?.[1]]);
    expect(larguras).toEqual([["Carga", "13"], ["Remetente e destinatário", "19"], ["Rota", "15"], ["Mercadoria e frete", "13"], ["CT-e", "19"], ["Ações", "21"]]);
    expect(larguras.reduce((soma, [, largura]) => soma + Number(largura), 0)).toBe(100);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import type { ConferenciaDoMdfe, MdfeEmitido, MdfesDaViagem, ResumoDoMdfe } from "../src/lib/mdfe";
import { FORMULARIO_EM_BRANCO, entradasDoFormulario, formularioDasEntradas } from "../src/app/dashboard/fiscal/mdfe/formulario";

/**
 * As telas do MDF-e: a aba "MDF-e" da viagem (conferir, informar e emitir) e a
 * lista (/dashboard/fiscal/mdfe), com as ações de encerrar, cancelar e incluir
 * condutor. As regras e as rotas são testadas em tests/mdfe.test.ts e
 * tests/mdfe-rotas.test.ts; aqui se confere o que cada tela mostra e o que ela
 * manda para a API. Nada aqui fala com servidor nenhum: o `fetch` é simulado.
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

import MdfePage from "../src/app/dashboard/fiscal/mdfe/page";
import { MdfeDaViagem } from "../src/app/dashboard/fiscal/mdfe/painel";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: Record<string, unknown> | undefined };

/** Respostas por "MÉTODO endereço" (o GET dispensa o método): fixas, ou calculadas na hora. Endereço sem resposta falha a chamada. */
function api(respostas: Record<string, Resposta | ((body: Record<string, unknown> | undefined) => Resposta)>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      pedidos.push({ url: String(url), method, body });
      const resposta = respostas[method === "GET" ? String(url) : `${method} ${String(url)}`];
      if (!resposta) throw new Error(`Chamada inesperada: ${method} ${String(url)}`);
      const { status, body: corpo } = typeof resposta === "function" ? resposta(body) : resposta;
      return new Response(JSON.stringify(corpo), { status: status ?? 200 });
    }),
  );
  return pedidos;
}

async function digitar(campo: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, valor: string) {
  const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const gravar = Object.getOwnPropertyDescriptor(prototipo, "value")!.set!;
  await act(async () => {
    gravar.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function enviar(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  estado.papel = "OPERATION";
});

const CHAVE = "35261099000108000141580010000000071482159371";
/** A mesma, com o tipo de emissão 2 (contingência) na posição 35 e o dígito refeito. */
const CHAVE_DE_CONTINGENCIA = "35261099000108000141580010000000072482159370";

const emitido = (extra: Partial<MdfeEmitido> = {}): MdfeEmitido => ({
  id: "m1",
  manifestId: "a1b2c3d4-0000-0000-0000-000000000000",
  viagem: "A1B2C3",
  ambiente: "HOMOLOGACAO",
  serie: 1,
  numero: 7,
  chave: CHAVE,
  situacao: "AUTHORIZED",
  tipoDeEmitente: "1",
  ufDeInicio: "SP",
  ufDeFim: "MG",
  placa: "ABC1D23",
  cStat: 100,
  motivo: "Autorizado o uso do MDF-e",
  protocolo: "935260000000001",
  emitidoEm: new Date().toISOString(),
  contingencia: false,
  transmitirAte: null,
  autorizadoEm: new Date().toISOString(),
  encerradoEm: null,
  canceladoEm: null,
  semResposta: false,
  atualizadoEm: new Date().toISOString(),
  eventos: [],
  ...extra,
});

const resumo: ResumoDoMdfe = {
  ambiente: "HOMOLOGACAO",
  serie: 1,
  numeroPrevisto: 7,
  tipoDeEmitente: "1",
  ufDeInicio: "SP",
  ufDeFim: "MG",
  carregamento: ["São José do Rio Preto"],
  percurso: [],
  opcoesDePercurso: [],
  descargas: [
    { municipio: "Belo Horizonte", documentos: 2 },
    { municipio: "Uberlândia", documentos: 1 },
  ],
  documentos: 3,
  valorDaCarga: 30000,
  pesoKg: 1500,
  placa: "ABC1D23",
  reboques: [],
  condutor: "João da Silva",
  lotacao: false,
};

const SEGURO_PADRAO = { responsavel: "1" as const, documento: null, seguradora: "Seguradora de Teste S/A", cnpjDaSeguradora: "99000502000180", apolice: "AP-1", averbacoes: [] };

const conferencia = (extra: Partial<ConferenciaDoMdfe> = {}): ConferenciaDoMdfe => ({
  ufDeDescarga: "MG",
  pendencias: [],
  avisos: [],
  resumo,
  entradas: { percurso: [], seguro: SEGURO_PADRAO, produto: { tipoDeCarga: "05", descricao: "Peças automotivas", ncm: null } },
  mdfe: null,
  ...extra,
});

const daViagem = (extra: Partial<MdfesDaViagem> = {}): MdfesDaViagem => ({ pronta: true, faltas: [], ambiente: "HOMOLOGACAO", damdfe: true, documentos: [conferencia()], reboques: [{ id: "r1", placa: "DEF4G56" }], ...extra });

const VIAGEM = "/api/fiscal/mdfe/emissao?manifestId=v1";

describe("formulário do MDF-e (ida e volta)", () => {
  it("em branco não manda grupo nenhum; o percurso só vai quando a pessoa mexeu", () => {
    expect(entradasDoFormulario(FORMULARIO_EM_BRANCO, false)).toEqual({});
    expect(entradasDoFormulario(FORMULARIO_EM_BRANCO, true)).toEqual({ percurso: [] });
    expect(entradasDoFormulario({ ...FORMULARIO_EM_BRANCO, percurso: "pr, sc" }, false)).toEqual({ percurso: ["PR", "SC"] });
  });

  it("monta CIOT, seguro, produto, lotação, pagamento a prazo, vale-pedágio, reboques e lacres", () => {
    const entradas = entradasDoFormulario(
      {
        ...FORMULARIO_EM_BRANCO,
        ciot: "123456789012",
        ciotDocumento: "99.000.108/0001-41",
        seguradora: "Seguradora X",
        cnpjDaSeguradora: "99000502000180",
        apolice: "AP-1",
        averbacoes: "AV-1, AV-2",
        produto: "Rolamentos",
        ncm: "84821010",
        cepDeCarregamento: "15035-000",
        cepDeDescarregamento: "30160-011",
        pagador: "99000303000171",
        valorDoFrete: "3000",
        aPrazo: true,
        adiantamento: "1000",
        vencimento: "2026-11-10",
        conta: "banco",
        banco: "001",
        agencia: "1234",
        valePedagioFornecedor: "99000502000180",
        valePedagioValor: "150,50",
        valePedagioCategoria: "04",
        reboque1: "r1",
        lacres: "L1; L2",
      },
      false,
    );
    expect(entradas).toMatchObject({
      ciots: [{ codigo: "123456789012", documento: "99.000.108/0001-41" }],
      seguro: { responsavel: "1", documento: null, seguradora: "Seguradora X", averbacoes: ["AV-1", "AV-2"] },
      produto: { tipoDeCarga: "05", descricao: "Rolamentos", ncm: "84821010" },
      lotacao: { cepDeCarregamento: "15035-000", cepDeDescarregamento: "30160-011" },
      pagamento: { documento: "99000303000171", valor: "3000", aPrazo: true, adiantamento: "1000", parcelas: [{ vencimento: "2026-11-10", valor: 2000 }], conta: { banco: "001", agencia: "1234" } },
      valePedagio: { categoria: "04", cnpjDoFornecedor: "99000502000180", valor: "150,50" },
      reboques: ["r1"],
      lacres: ["L1", "L2"],
    });
  });

  it("reabre com o que a conferência devolveu", () => {
    const form = formularioDasEntradas({
      percurso: ["PR", "SC"],
      ciots: [{ codigo: "123456789012", documento: "99000108000141" }],
      seguro: { ...SEGURO_PADRAO, averbacoes: ["AV-1"] },
      produto: { tipoDeCarga: "03", descricao: "Carne", ncm: "0201" },
      pagamento: { nome: null, documento: "99000303000171", valor: 850.5, aPrazo: false, conta: { pix: "chave" } },
      reboques: ["r1"],
    });
    expect(form).toMatchObject({ percurso: "PR, SC", ciot: "123456789012", seguradora: "Seguradora de Teste S/A", averbacoes: "AV-1", tipoDeCarga: "03", produto: "Carne", valorDoFrete: "850,5", conta: "pix", pix: "chave", reboque1: "r1" });
  });
});

describe("aba MDF-e da viagem", () => {
  it("empresa que não está pronta: explica o que falta, aponta para Empresa → Fiscal e não deixa emitir", async () => {
    api({
      [VIAGEM]: { body: daViagem({ pronta: false, ambiente: null, faltas: ["A empresa não tem certificado digital A1. Envie em Empresa → Fiscal."], documentos: [conferencia({ pendencias: ["A empresa não tem certificado digital A1. Envie em Empresa → Fiscal."] })] }) },
    });
    const tela = await montar(<MdfeDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector('[data-aviso-mdfe="falta"]')).not.toBeNull());
    expect(tela.querySelector("[data-aviso-mdfe]")!.textContent).toContain("A emissão de MDF-e ainda não está pronta nesta empresa.");
    expect(tela.querySelector('a[href="/dashboard/empresa"]')?.textContent).toBe("Abrir Empresa → Fiscal");
    expect(tela.querySelector<HTMLButtonElement>("[data-emitir]")!.disabled).toBe(true);
    expect(tela.textContent).not.toMatch(/Autorizado/);
  });

  it("um documento por UF: mostra o que vai, o que falta; a pessoa informa, confere e emite, e só então aparece autorizado", async () => {
    let autorizado = false;
    const comPendencia = conferencia({ pendencias: ["Informe o CIOT (ou, sem o código, o CPF ou CNPJ de quem o gerou): a SEFAZ exige o grupo do CIOT da transportadora (NT 2026.001, rejeição 684).", "Informe o número da averbação do seguro desta viagem."] });
    const pedidos = api({
      [VIAGEM]: () => ({ body: daViagem({ documentos: [autorizado ? conferencia({ pendencias: ["Esta viagem já tem MDF-e autorizado para esta UF neste ambiente."], mdfe: emitido() }) : comPendencia, conferencia({ ufDeDescarga: "RJ", resumo: { ...resumo, ufDeFim: "RJ", lotacao: true, documentos: 1 }, pendencias: ["MDF-e com um documento só é carga lotação: informe o NCM do produto predominante (rejeição 301)."] })] }) }),
      "POST /api/fiscal/mdfe/conferencia": () => ({ body: conferencia() }),
      "POST /api/fiscal/mdfe/emissao": () => {
        autorizado = true;
        return { body: { mdfe: emitido(), autorizado: true, mensagem: "MDF-e nº 7 autorizado em homologação (sem valor fiscal). Protocolo 935260000000001." } };
      },
    });
    const tela = await montar(<MdfeDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelectorAll("[data-documento]")).toHaveLength(2));
    expect(tela.querySelector('[data-aviso-mdfe="homologacao"]')!.textContent).toContain("MDF-e de teste, sem valor fiscal");

    const mg = tela.querySelector<HTMLElement>('[data-documento="MG"]')!;
    expect(mg.querySelector('[data-mdfe="nao-emitido"]')).not.toBeNull();
    const texto = mg.querySelector("[data-resumo]")!.textContent!;
    expect(texto).toContain("Homologação · 1 / 7");
    expect(texto).toContain("São José do Rio Preto (SP)");
    expect(texto).toContain("Belo Horizonte (2), Uberlândia (1)");
    expect(texto).toContain("direto");
    expect(texto).toMatch(/3 · R\$\s30\.000,00/);
    expect(texto).toContain("ABC1D23");
    expect(mg.querySelector("[data-pendencias]")!.textContent).toContain("Informe o CIOT");
    expect(mg.querySelector<HTMLButtonElement>("[data-emitir]")!.disabled).toBe(true);
    expect(mg.querySelector<HTMLButtonElement>("[data-emitir]")!.textContent).toBe("Emitir em homologação");
    // O do RJ é carga lotação.
    expect(tela.querySelector('[data-documento="RJ"] [data-pendencias]')!.textContent).toContain("carga lotação");

    // O formulário abre com o que o cadastro sugere (seguro padrão e produto dos CT-e).
    await clicar(mg.querySelector("[data-informar]")!);
    const campo = (nome: string) => mg.querySelector<HTMLInputElement>(`[data-campo="${nome}"]`)!;
    expect(campo("seguradora").value).toBe("Seguradora de Teste S/A");
    expect(campo("produto").value).toBe("Peças automotivas");
    // MDF-e com mais de um documento não pede CEP de lotação.
    expect(mg.querySelector('[data-campo="cepDeCarregamento"]')).toBeNull();
    await digitar(campo("ciot"), "123456789012");
    // O campo não perde o foco nem o que foi digitado ao digitar o seguinte.
    await digitar(campo("ciotDocumento"), "99000108000141");
    expect(campo("ciot").value).toBe("123456789012");
    await digitar(campo("averbacoes"), "AV-0001");

    await clicar(mg.querySelector("[data-conferir]")!);
    await ate(() => expect(mg.querySelector("[data-pendencias]")).toBeNull());
    const conferido = pedidos.find((pedido) => pedido.url === "/api/fiscal/mdfe/conferencia")!;
    expect(conferido.body).toMatchObject({
      manifestId: "v1",
      ufDeDescarga: "MG",
      entradas: { ciots: [{ codigo: "123456789012", documento: "99000108000141" }], seguro: { seguradora: "Seguradora de Teste S/A", averbacoes: ["AV-0001"] }, produto: { descricao: "Peças automotivas" } },
    });
    // O percurso não foi mexido: não vai (o servidor infere).
    expect((conferido.body!.entradas as Record<string, unknown>).percurso).toBeUndefined();

    const botao = mg.querySelector<HTMLButtonElement>("[data-emitir]")!;
    expect(botao.disabled).toBe(false);
    await clicar(botao);
    await ate(() => expect(mg.querySelector('[data-resultado="autorizado"]')).not.toBeNull());
    expect(mg.querySelector("[data-resultado]")!.textContent).toBe("MDF-e nº 7 autorizado em homologação (sem valor fiscal). Protocolo 935260000000001.");
    expect(pedidos.find((pedido) => pedido.url === "/api/fiscal/mdfe/emissao" && pedido.method === "POST")?.body).toEqual(conferido.body);
    await ate(() => expect(mg.querySelector('[data-mdfe="AUTHORIZED"]')).not.toBeNull());
    expect(mg.querySelector("[data-mdfe]")!.textContent).toBe("Autorizado nº 7 (homologação)");
    // Autorizado: somem o formulário e o botão de emitir; aparecem as ações.
    expect(mg.querySelector("[data-emitir]")).toBeNull();
    expect(mg.querySelector<HTMLAnchorElement>('[data-acao="xml"]')!.getAttribute("href")).toBe("/api/fiscal/mdfe/emissao/m1/xml");
    expect(mg.querySelector("[data-damdfe]")!.textContent).toBe("DAMDFE (PDF)");
    expect(mg.querySelector('[data-acao="encerrar"]')).not.toBeNull();
    expect(mg.querySelector('[data-acao="cancelar"]')).not.toBeNull();
    expect(mg.querySelector('[data-acao="condutor"]')).not.toBeNull();
  });

  it("rejeição e percurso a informar: mostra a resposta da SEFAZ e as opções de caminho, sem dizer autorizado", async () => {
    const semPercurso = conferencia({ ufDeDescarga: "GO", resumo: { ...resumo, ufDeFim: "GO", percurso: null, opcoesDePercurso: [["MG"], ["MS"]] }, pendencias: ["Informe as UFs do percurso entre SP e GO, na ordem da viagem: há mais de um caminho possível e o sistema não escolhe a rota."], entradas: {} });
    const pedidos = api({
      "/api/fiscal/mdfe/emissao?manifestId=v1": { body: daViagem({ documentos: [semPercurso] }) },
      "POST /api/fiscal/mdfe/conferencia": () => ({ body: { ...semPercurso, pendencias: [], resumo: { ...semPercurso.resumo, percurso: ["MS"] } } }),
      "POST /api/fiscal/mdfe/emissao": { body: { mdfe: emitido({ situacao: "REJECTED", cStat: 698, motivo: "Rejeição: Seguro da carga é obrigatório", protocolo: null, autorizadoEm: null }), autorizado: false, mensagem: "A SEFAZ rejeitou o MDF-e: 698 - Rejeição: Seguro da carga é obrigatório." } },
    });
    const tela = await montar(<MdfeDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector('[data-documento="GO"]')).not.toBeNull());
    const go = tela.querySelector<HTMLElement>('[data-documento="GO"]')!;
    expect(go.querySelector("[data-resumo]")!.textContent).toContain("informar");
    await clicar(go.querySelector("[data-informar]")!);
    await clicar(go.querySelector('[data-opcao-de-percurso="MS"]')!);
    expect(go.querySelector<HTMLInputElement>('[data-campo="percurso"]')!.value).toBe("MS");
    await clicar(go.querySelector("[data-conferir]")!);
    await ate(() => expect(go.querySelector("[data-pendencias]")).toBeNull());
    expect(pedidos.at(-1)?.body).toMatchObject({ ufDeDescarga: "GO", entradas: { percurso: ["MS"] } });

    await clicar(go.querySelector("[data-emitir]")!);
    await ate(() => expect(go.querySelector('[data-resultado="nao-autorizado"]')).not.toBeNull());
    expect(go.querySelector("[data-resultado]")!.textContent).toContain("698 - Rejeição: Seguro da carga é obrigatório");
    expect(go.querySelector("[data-mdfe]")!.textContent).toBe("Rejeitado (homologação)");
    expect(go.querySelector('[data-acao="xml"]')).toBeNull();
    expect(go.textContent).not.toMatch(/Autorizado/);
  });

  it("quem só lê o fiscal vê o documento e baixa, mas não emite nem envia evento; quem não lê vê o aviso de acesso", async () => {
    api({ [VIAGEM]: { body: daViagem({ documentos: [conferencia({ mdfe: emitido(), pendencias: [] })] }) } });
    const tela = await montar(<MdfeDaViagem manifestId="v1" podeAlterar={false} />);
    await ate(() => expect(tela.querySelector('[data-mdfe="AUTHORIZED"]')).not.toBeNull());
    expect(tela.querySelector('[data-acao="xml"]')).not.toBeNull();
    expect(tela.querySelector('[data-acao="encerrar"]')).toBeNull();
    expect(tela.querySelector("[data-emitir]")).toBeNull();
    await desmontarTudo();

    api({ [VIAGEM]: { status: 403, body: { error: "Acesso negado" } } });
    const negada = await montar(<MdfeDaViagem manifestId="v1" podeAlterar={false} />);
    await ate(() => expect(negada.querySelector('[role="alert"]')).not.toBeNull());
    expect(negada.textContent).toContain("Seu perfil não tem acesso aos documentos fiscais.");
  });

  it("contingência: só é oferecida depois de a SEFAZ não responder, pede confirmação, e o MDF-e aparece 'a transmitir', nunca 'autorizado'", async () => {
    const emContingencia = () =>
      emitido({ situacao: "CONTINGENCY", chave: CHAVE_DE_CONTINGENCIA, contingencia: true, cStat: null, motivo: null, protocolo: null, autorizadoEm: null, emitidoEm: "2026-10-10T14:30:00.000Z", transmitirAte: "2026-10-17T14:30:00.000Z" });
    let emitida = false;
    const pedidos = api({
      [VIAGEM]: () => ({ body: daViagem({ documentos: [emitida ? conferencia({ pendencias: ["Esta viagem tem MDF-e emitido em contingência para esta UF neste ambiente: transmita-o à SEFAZ."], mdfe: emContingencia() }) : conferencia()] }) }),
      "POST /api/fiscal/mdfe/emissao": (corpo) => {
        if (!corpo?.contingencia) return { status: 504, body: { error: "A SEFAZ não respondeu no tempo limite. A consulta de MDF-e não encerrados é feita antes de emitir: nada foi enviado. Tente de novo." } };
        emitida = true;
        return { body: { mdfe: emContingencia(), autorizado: false, mensagem: "MDF-e nº 7 emitido em contingência em homologação (sem valor fiscal): ainda NÃO está autorizado. Imprima o DAMDFE." } };
      },
    });
    const tela = await montar(<MdfeDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector('[data-documento="MG"]')).not.toBeNull());
    const mg = tela.querySelector<HTMLElement>('[data-documento="MG"]')!;
    // Antes de tentar emitir, a contingência nem aparece.
    expect(mg.querySelector("[data-oferta-de-contingencia]")).toBeNull();

    await clicar(mg.querySelector("[data-emitir]")!);
    await ate(() => expect(mg.querySelector('[role="alert"]')).not.toBeNull());
    const oferta = mg.querySelector<HTMLElement>("[data-oferta-de-contingencia]")!;
    expect(oferta.textContent).toContain("o MDF-e sai sem autorização");
    expect(oferta.textContent).toContain("transmitido em até 168 horas");
    const botao = oferta.querySelector<HTMLButtonElement>("[data-contingencia-emitir]")!;
    // Sem a confirmação o botão não liga: a contingência é escolha de quem emite.
    expect(botao.disabled).toBe(true);
    await clicar(oferta.querySelector('[data-campo="confirmaContingencia"]')!);
    expect(botao.disabled).toBe(false);
    await clicar(botao);
    await ate(() => expect(mg.querySelector('[data-resultado="contingencia"]')).not.toBeNull());
    expect(pedidos.filter((pedido) => pedido.method === "POST").map((pedido) => pedido.body?.contingencia)).toEqual([undefined, true]);
    expect(pedidos.find((pedido) => pedido.body?.contingencia === true)).toMatchObject({ url: "/api/fiscal/mdfe/emissao", body: { manifestId: "v1", ufDeDescarga: "MG" } });

    await ate(() => expect(mg.querySelector('[data-mdfe="CONTINGENCY"]')).not.toBeNull());
    expect(mg.querySelector("[data-mdfe]")!.textContent).toBe("Contingência nº 7, a transmitir (homologação)");
    expect(mg.querySelector("[data-prazo]")!.textContent).toMatch(/^Emitido em contingência, sem autorização da SEFAZ\. /);
    expect(mg.textContent).toContain("3526 1099 0001 0800 0141 5800 1000 0000 0724 8215 9370");
    // O que existe para ele: o DAMDFE de contingência e transmitir. Nada de XML autorizado, encerrar ou cancelar.
    expect(mg.querySelector("[data-damdfe]")).not.toBeNull();
    expect(mg.querySelector('[data-acao="transmitir"]')!.textContent).toBe("Transmitir à SEFAZ");
    for (const acao of ["xml", "encerrar", "cancelar", "condutor", "pagamento"]) expect(mg.querySelector(`[data-acao="${acao}"]`), acao).toBeNull();
    expect(mg.querySelector("[data-emitir]")).toBeNull();
    expect(mg.textContent).not.toMatch(/Autorizado nº/);
  });
});

describe("tela de MDF-e (lista)", () => {
  const PRONTA = { body: { pronta: true, ambiente: "HOMOLOGACAO", faltas: [], tipoDeEmitente: "1", damdfe: true } };
  const SEM_CONFIGURACAO = { status: 403, body: { error: "Acesso negado" } };

  it("lista vazia aponta para a viagem; sem permissão mostra o acesso negado", async () => {
    api({ "/api/fiscal/mdfe": { body: [] }, "/api/fiscal/mdfe/situacao": PRONTA, "/api/fiscal/mdfe/configuracao": SEM_CONFIGURACAO });
    const tela = await montar(<MdfePage />);
    await ate(() => expect(tela.textContent).toContain("Nenhum MDF-e emitido."));
    expect(tela.querySelector('a[href="/dashboard/manifestos"]')).not.toBeNull();
    expect(tela.querySelector('[data-aviso-mdfe="pronta"]')!.textContent).toContain("Emissão em homologação: MDF-e de teste, sem valor fiscal.");
    expect(tela.querySelector("[data-configuracao-do-mdfe]")).toBeNull();
    await desmontarTudo();

    api({ "/api/fiscal/mdfe": { status: 403, body: {} }, "/api/fiscal/mdfe/situacao": { status: 403, body: {} }, "/api/fiscal/mdfe/configuracao": SEM_CONFIGURACAO });
    const negada = await montar(<MdfePage />);
    await ate(() => expect(negada.textContent).toContain("Acesso negado"));
  });

  it("encerrar: pede data, UF e cidade, manda o evento e mostra o encerrado que a rota devolveu", async () => {
    let encerrado = false;
    const fechado = () => emitido({ situacao: "CLOSED", encerradoEm: new Date().toISOString(), eventos: [{ id: "e1", tipo: "110112", sequencia: 1, protocolo: "935260000000002", registradoEm: new Date().toISOString(), descricao: "Encerrado em Belo Horizonte/MG, em 11/10/2026" }] });
    const antigo = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const pedidos = api({
      "/api/fiscal/mdfe": () => ({ body: [encerrado ? fechado() : emitido({ autorizadoEm: antigo }), emitido({ id: "m2", numero: 8, situacao: "REJECTED", cStat: 611, motivo: "Rejeição: Existe MDFe não encerrado para esta placa", protocolo: null, autorizadoEm: null })] }),
      "/api/fiscal/mdfe/situacao": PRONTA,
      "/api/fiscal/mdfe/configuracao": SEM_CONFIGURACAO,
      "POST /api/fiscal/mdfe/emissao/m1/encerrar": () => {
        encerrado = true;
        return { body: fechado() };
      },
    });
    const tela = await montar(<MdfePage />);
    await ate(() => expect(tela.querySelectorAll("tr[data-mdfe-id]")).toHaveLength(2));
    const linha = tela.querySelector<HTMLElement>('tr[data-mdfe-id="m1"]')!;
    expect(linha.textContent).toContain("Viagem #A1B2C3");
    expect(linha.textContent).toContain("SP → MG");
    expect(linha.querySelector("[data-mdfe]")!.textContent).toBe("Autorizado nº 7 (homologação)");
    expect(linha.querySelector("[data-em-aberto]")!.textContent).toContain("Autorizado há 4 dias e ainda não encerrado");
    // O rejeitado mostra o motivo e não tem ação nenhuma.
    const rejeitado = tela.querySelector<HTMLElement>('tr[data-mdfe-id="m2"]')!;
    expect(rejeitado.querySelector("[data-rejeicao]")!.textContent).toBe("611 - Rejeição: Existe MDFe não encerrado para esta placa");
    expect(rejeitado.querySelector("[data-acao]")).toBeNull();

    await clicar(linha.querySelector('[data-acao="encerrar"]')!);
    const dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.textContent).toContain("O encerramento é obrigatório ao fim do último descarregamento");
    expect(dialogo.querySelector<HTMLSelectElement>('[data-campo="uf"]')!.value).toBe("MG");
    const botao = porTexto(dialogo, "button", "Encerrar o MDF-e na SEFAZ")[0] as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await digitar(dialogo.querySelector<HTMLInputElement>('[data-campo="dia"]')!, "2026-10-11");
    await digitar(dialogo.querySelector<HTMLInputElement>('[data-campo="cidade"]')!, "Belo Horizonte");
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(tela.querySelector('[role="dialog"]')).toBeNull());
    expect(pedidos.find((pedido) => pedido.method === "POST")).toMatchObject({ url: "/api/fiscal/mdfe/emissao/m1/encerrar", body: { dia: "2026-10-11", cidade: "Belo Horizonte", uf: "MG" } });
    await ate(() => expect(tela.querySelector('tr[data-mdfe-id="m1"] [data-mdfe="CLOSED"]')).not.toBeNull());
    const depois = tela.querySelector<HTMLElement>('tr[data-mdfe-id="m1"]')!;
    expect(depois.querySelector("[data-mdfe]")!.textContent).toBe("Encerrado nº 7 (homologação)");
    expect(depois.querySelector("[data-eventos]")!.textContent).toContain("Encerrado em Belo Horizonte/MG, em 11/10/2026");
    expect(depois.querySelector("[data-eventos]")!.textContent).toContain("protocolo 935260000000002");
    // Encerrado: o XML e o DAMDFE continuam; os eventos somem.
    expect(depois.querySelector('[data-acao="xml"]')).not.toBeNull();
    expect(depois.querySelector('[data-acao="encerrar"]')).toBeNull();
    expect(depois.querySelector('[data-acao="cancelar"]')).toBeNull();
  });

  it("cancelar pede a justificativa e a confirmação de que o veículo não saiu; fora do prazo, o botão fica desligado; a recusa da SEFAZ aparece", async () => {
    const pedidos = api({
      "/api/fiscal/mdfe": { body: [emitido(), emitido({ id: "m3", numero: 9, autorizadoEm: new Date(Date.now() - 30 * 3_600_000).toISOString() })] },
      "/api/fiscal/mdfe/situacao": PRONTA,
      "/api/fiscal/mdfe/configuracao": SEM_CONFIGURACAO,
      "POST /api/fiscal/mdfe/emissao/m1/cancelar": { status: 409, body: { error: "A SEFAZ recusou o cancelamento: 219 - Rejeição: Circulação do MDF-e verificada." } },
    });
    const tela = await montar(<MdfePage />);
    await ate(() => expect(tela.querySelectorAll("tr[data-mdfe-id]")).toHaveLength(2));

    await clicar(tela.querySelector('tr[data-mdfe-id="m3"] [data-acao="cancelar"]')!);
    let dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.querySelector("[data-fora-do-prazo]")!.textContent).toContain("O prazo de 24 horas já passou");
    await digitar(dialogo.querySelector("textarea")!, "Viagem cancelada pelo cliente antes da saída");
    await clicar(dialogo.querySelector('[data-campo="naoSaiu"]')!);
    expect((porTexto(dialogo, "button", "Cancelar o MDF-e na SEFAZ")[0] as HTMLButtonElement).disabled).toBe(true);
    await clicar(dialogo.querySelector('button[aria-label="Fechar"]')!);

    await clicar(tela.querySelector('tr[data-mdfe-id="m1"] [data-acao="cancelar"]')!);
    dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.querySelector("[data-fora-do-prazo]")).toBeNull();
    const botao = porTexto(dialogo, "button", "Cancelar o MDF-e na SEFAZ")[0] as HTMLButtonElement;
    await digitar(dialogo.querySelector("textarea")!, "Viagem cancelada pelo cliente antes da saída");
    // Sem a confirmação o botão não liga.
    expect(botao.disabled).toBe(true);
    await clicar(dialogo.querySelector('[data-campo="naoSaiu"]')!);
    expect(botao.disabled).toBe(false);
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(dialogo.querySelector('[role="alert"]')).not.toBeNull());
    expect(dialogo.querySelector('[role="alert"]')!.textContent).toContain("219 - Rejeição: Circulação do MDF-e verificada");
    expect(pedidos.at(-1)).toMatchObject({ url: "/api/fiscal/mdfe/emissao/m1/cancelar", body: { justificativa: "Viagem cancelada pelo cliente antes da saída", transporteNaoIniciado: true } });
    // A tela não marcou cancelado por conta própria.
    expect(tela.querySelector('tr[data-mdfe-id="m1"] [data-mdfe]')!.textContent).toBe("Autorizado nº 7 (homologação)");
  });

  it("incluir condutor, status da SEFAZ e não encerrados", async () => {
    const pedidos = api({
      "/api/fiscal/mdfe": { body: [emitido()] },
      "/api/fiscal/mdfe/situacao": PRONTA,
      "/api/fiscal/mdfe/configuracao": SEM_CONFIGURACAO,
      "/api/fiscal/mdfe/status-servico": { body: { ambiente: "HOMOLOGACAO", autorizador: "SVRS", emOperacao: true, cStat: 107, motivo: "Serviço em Operação" } },
      "/api/fiscal/mdfe/nao-encerrados": { body: { ambiente: "HOMOLOGACAO", cStat: 111, motivo: "MDF-e não encerrados localizados", mdfes: [{ chave: CHAVE, protocolo: "935260000000001", mdfe: { id: "m1", numero: 7, viagem: "A1B2C3", placa: "ABC1D23", ufDeFim: "MG", autorizadoEm: null } }, { chave: "35261099000108000141580010000000991000000995", protocolo: "935260000000099", mdfe: null }] } },
      "POST /api/fiscal/mdfe/emissao/m1/condutor": { body: emitido({ eventos: [{ id: "e2", tipo: "110114", sequencia: 1, protocolo: "935260000000003", registradoEm: new Date().toISOString(), descricao: "Condutor incluído: Maria de Souza" }] }) },
    });
    const tela = await montar(<MdfePage />);
    await ate(() => expect(tela.querySelector("tr[data-mdfe-id]")).not.toBeNull());

    await clicar(tela.querySelector("[data-consultar-sefaz]")!);
    await ate(() => expect(tela.querySelector("[data-status-sefaz]")).not.toBeNull());
    expect(tela.querySelector("[data-status-sefaz]")!.textContent).toBe("SEFAZ SVRS: 107 Serviço em Operação");
    await clicar(tela.querySelector("[data-consultar-abertos]")!);
    await ate(() => expect(tela.querySelector("[data-abertos-na-sefaz]")).not.toBeNull());
    const abertos = tela.querySelector("[data-abertos-na-sefaz]")!.textContent!;
    expect(abertos).toContain("111 MDF-e não encerrados localizados");
    expect(abertos).toContain("MDF-e nº 7 · viagem #A1B2C3 · ABC1D23 · descarga em MG");
    expect(abertos).toContain("Emitido fora deste sistema");

    await clicar(tela.querySelector('[data-acao="condutor"]')!);
    const dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    await digitar(dialogo.querySelector<HTMLInputElement>('[data-campo="nome"]')!, "Maria de Souza");
    await digitar(dialogo.querySelector<HTMLInputElement>('[data-campo="cpf"]')!, "111.444.777-35");
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(tela.querySelector('[role="dialog"]')).toBeNull());
    expect(pedidos.find((pedido) => pedido.method === "POST")).toMatchObject({ url: "/api/fiscal/mdfe/emissao/m1/condutor", body: { nome: "Maria de Souza", cpf: "111.444.777-35" } });
  });

  it("MDF-e em contingência na lista: o prazo, a última resposta e transmitir; rejeitado continua em contingência, e só vira autorizado com o que a rota devolve", async () => {
    const pendente = (extra: Partial<MdfeEmitido> = {}) =>
      emitido({ situacao: "CONTINGENCY", chave: CHAVE_DE_CONTINGENCIA, contingencia: true, cStat: null, motivo: null, protocolo: null, autorizadoEm: null, emitidoEm: "2026-10-10T14:30:00.000Z", transmitirAte: "2026-10-17T14:30:00.000Z", ...extra });
    let situacao: "pendente" | "rejeitado" | "autorizado" = "pendente";
    const rejeitado = () => pendente({ cStat: 611, motivo: "Rejeição: Existe MDFe não encerrado para esta placa" });
    const autorizado = () => emitido({ chave: CHAVE_DE_CONTINGENCIA, contingencia: true });
    const pedidos = api({
      "/api/fiscal/mdfe": () => ({ body: [situacao === "autorizado" ? autorizado() : situacao === "rejeitado" ? rejeitado() : pendente()] }),
      "/api/fiscal/mdfe/situacao": PRONTA,
      "/api/fiscal/mdfe/configuracao": SEM_CONFIGURACAO,
      "POST /api/fiscal/mdfe/emissao/m1/transmitir": () => {
        if (situacao === "pendente") {
          situacao = "rejeitado";
          return { body: { mdfe: rejeitado(), autorizado: false, mensagem: "A SEFAZ rejeitou a transmissão do MDF-e: 611 - Rejeição: Existe MDFe não encerrado para esta placa. O MDF-e continua emitido em contingência, sem autorização." } };
        }
        situacao = "autorizado";
        return { body: { mdfe: autorizado(), autorizado: true, mensagem: "MDF-e nº 7 (emitido em contingência) autorizado em homologação (sem valor fiscal). Protocolo 935260000000001." } };
      },
    });
    const tela = await montar(<MdfePage />);
    await ate(() => expect(tela.querySelector("tr[data-mdfe-id]")).not.toBeNull());
    const linha = () => tela.querySelector<HTMLElement>('tr[data-mdfe-id="m1"]')!;
    expect(linha().querySelector("[data-mdfe]")!.textContent).toBe("Contingência nº 7, a transmitir (homologação)");
    expect(linha().querySelector("[data-mdfe]")!.getAttribute("title")).toBe("Emitido em contingência, a transmitir");
    // O prazo de 168 horas: 10/10 às 11:30 de Brasília + 7 dias. Já passou ou não, a frase diz o dia.
    expect(linha().querySelector("[data-prazo]")!.textContent).toMatch(/17\/10\/2026,? 11:30/);
    expect(linha().querySelector("[data-em-aberto]")).toBeNull();
    expect(linha().querySelector('[data-acao="xml"]')).toBeNull();

    await clicar(linha().querySelector('[data-acao="transmitir"]')!);
    await ate(() => expect(linha().querySelector('[data-transmissao="nao-autorizado"]')).not.toBeNull());
    expect(linha().querySelector("[data-transmissao]")!.textContent).toContain("611 - Rejeição: Existe MDFe não encerrado para esta placa");
    await ate(() => expect(linha().querySelector("[data-ultima-transmissao]")).not.toBeNull());
    expect(linha().querySelector("[data-ultima-transmissao]")!.textContent).toBe("Última transmissão: 611 - Rejeição: Existe MDFe não encerrado para esta placa");
    // Continua em contingência: a tela não promove nada por conta própria.
    expect(linha().querySelector("[data-mdfe]")!.getAttribute("data-mdfe")).toBe("CONTINGENCY");

    await clicar(linha().querySelector('[data-acao="transmitir"]')!);
    await ate(() => expect(linha().querySelector('[data-mdfe="AUTHORIZED"]')).not.toBeNull());
    expect(linha().querySelector("[data-mdfe]")!.textContent).toBe("Autorizado nº 7 (homologação)");
    expect(linha().querySelector('[data-acao="xml"]')).not.toBeNull();
    expect(linha().querySelector('[data-acao="transmitir"]')).toBeNull();
    expect(pedidos.filter((pedido) => pedido.method === "POST").map((pedido) => pedido.url)).toEqual(["/api/fiscal/mdfe/emissao/m1/transmitir", "/api/fiscal/mdfe/emissao/m1/transmitir"]);
  });

  it("pagamento: a janela diz em uma linha quando o evento se aplica; informa (110116) e, com ele já registrado, altera (110118), também no MDF-e encerrado", async () => {
    const eventoDePagamento = { id: "e3", tipo: "110116", sequencia: 1, protocolo: "935260000000004", registradoEm: new Date().toISOString(), descricao: "Pagamento informado: R$ 1.850,75, viagem 2 de 4" };
    let informado = false;
    const pedidos = api({
      "/api/fiscal/mdfe": () => ({ body: [informado ? emitido({ situacao: "CLOSED", encerradoEm: new Date().toISOString(), eventos: [eventoDePagamento] }) : emitido()] }),
      "/api/fiscal/mdfe/situacao": PRONTA,
      "/api/fiscal/mdfe/configuracao": SEM_CONFIGURACAO,
      "POST /api/fiscal/mdfe/emissao/m1/pagamento": (corpo) => {
        if (corpo?.viagens && (corpo.viagens as { numero: string }).numero === "9") return { status: 409, body: { error: "O evento de pagamento só vale para MDF-e cujo veículo de tração é de TAC agregado (proprietário cadastrado no veículo com esse tipo): a SEFAZ rejeita os demais (723)." } };
        informado = true;
        return { body: emitido({ eventos: [eventoDePagamento] }) };
      },
      "PUT /api/fiscal/mdfe/emissao/m1/pagamento": { body: emitido({ situacao: "CLOSED", eventos: [eventoDePagamento, { ...eventoDePagamento, id: "e4", tipo: "110118", descricao: "Pagamento alterado: R$ 2.000,00" }] }) },
    });
    const tela = await montar(<MdfePage />);
    await ate(() => expect(tela.querySelector("tr[data-mdfe-id]")).not.toBeNull());

    await clicar(tela.querySelector('[data-acao="pagamento"]')!);
    let dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.getAttribute("aria-label")).toBe("Informar pagamento do MDF-e");
    expect(dialogo.querySelector("[data-quando]")!.textContent).toBe(
      "Só para veículo de TAC agregado, quando o frete é pago depois, no fim do período (MOC do MDF-e, item 6.5): quem informou o pagamento na emissão não precisa deste evento.",
    );
    const botao = porTexto(dialogo, "button", "Informar o pagamento na SEFAZ")[0] as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    const campo = (nome: string) => dialogo.querySelector<HTMLInputElement>(`[data-campo="${nome}"]`)!;
    await digitar(campo("quantidade"), "4");
    await digitar(campo("numero"), "9");
    await digitar(campo("pagador"), "99.000.108/0001-41");
    await digitar(campo("valorDoFrete"), "1850,75");
    await digitar(campo("pix"), "52998224725");
    expect(botao.disabled).toBe(false);
    // A recusa da rota (veículo que não é de TAC agregado) aparece na janela, que continua aberta.
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(dialogo.querySelector('[role="alert"]')).not.toBeNull());
    expect(dialogo.querySelector('[role="alert"]')!.textContent).toContain("TAC agregado");

    await digitar(campo("numero"), "2");
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(tela.querySelector('[role="dialog"]')).toBeNull());
    expect(pedidos.filter((pedido) => pedido.method === "POST").at(-1)).toMatchObject({
      url: "/api/fiscal/mdfe/emissao/m1/pagamento",
      body: { viagens: { quantidade: "4", numero: "2" }, pagamento: { documento: "99.000.108/0001-41", valor: "1850,75", aPrazo: false, conta: { pix: "52998224725" } } },
    });

    // Agora o MDF-e está encerrado e já tem o pagamento: a ação continua, e passa a ser a alteração.
    await ate(() => expect(tela.querySelector('tr[data-mdfe-id="m1"] [data-mdfe="CLOSED"]')).not.toBeNull());
    expect(tela.querySelector("[data-eventos]")!.textContent).toContain("Pagamento informado: R$ 1.850,75, viagem 2 de 4");
    expect(tela.querySelector('[data-acao="encerrar"]')).toBeNull();
    await clicar(tela.querySelector('[data-acao="pagamento"]')!);
    dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.getAttribute("aria-label")).toBe("Alterar pagamento do MDF-e");
    expect(dialogo.querySelector("[data-quando]")!.textContent).toBe("Para corrigir os dados do pagamento do frete já informado à SEFAZ para um contratante (MOC do MDF-e, item 6.7).");
    expect(dialogo.querySelector('[data-campo="quantidade"]')).toBeNull();
    await digitar(campo("pagador"), "99000108000141");
    await digitar(campo("valorDoFrete"), "2000");
    await digitar(campo("pix"), "52998224725");
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(tela.querySelector('[role="dialog"]')).toBeNull());
    expect(pedidos.find((pedido) => pedido.method === "PUT")).toMatchObject({ url: "/api/fiscal/mdfe/emissao/m1/pagamento", body: { pagamento: { documento: "99000108000141", valor: "2000", aPrazo: false, conta: { pix: "52998224725" } } } });
    expect((pedidos.find((pedido) => pedido.method === "PUT")!.body as Record<string, unknown>).viagens).toBeUndefined();
  });

  it("quem só lê o fiscal não vê transmitir nem pagamento", async () => {
    estado.papel = "EXPEDITION";
    api({
      "/api/fiscal/mdfe": {
        body: [emitido(), emitido({ id: "m2", numero: 8, situacao: "CONTINGENCY", chave: CHAVE_DE_CONTINGENCIA, contingencia: true, protocolo: null, autorizadoEm: null, cStat: null, motivo: null, transmitirAte: "2026-10-17T14:30:00.000Z" })],
      },
      "/api/fiscal/mdfe/situacao": PRONTA,
      "/api/fiscal/mdfe/configuracao": SEM_CONFIGURACAO,
    });
    const tela = await montar(<MdfePage />);
    await ate(() => expect(tela.querySelectorAll("tr[data-mdfe-id]")).toHaveLength(2));
    expect(tela.querySelector('[data-acao="pagamento"]')).toBeNull();
    expect(tela.querySelector('[data-acao="transmitir"]')).toBeNull();
    // O DAMDFE de contingência e o prazo continuam visíveis para quem lê.
    expect(tela.querySelector('tr[data-mdfe-id="m2"] [data-damdfe]')).not.toBeNull();
    expect(tela.querySelector('tr[data-mdfe-id="m2"] [data-prazo]')).not.toBeNull();
  });

  it("configuração (só para o administrador): abre com o que está gravado e salva série, tipo de emitente e seguro", async () => {
    estado.papel = "ADMIN";
    const gravada = { disponivel: true, ambiente: "HOMOLOGACAO", serie: 1, proximoNumero: 8, tipoDeEmitente: "1", seguradora: null, cnpjDaSeguradora: null, apolice: null };
    const pedidos = api({
      "/api/fiscal/mdfe": { body: [] },
      "/api/fiscal/mdfe/situacao": PRONTA,
      "/api/fiscal/mdfe/configuracao": { body: gravada },
      "PUT /api/fiscal/mdfe/configuracao": (body) => ({ body: { ...gravada, seguradora: body?.seguradora, cnpjDaSeguradora: "99000502000180", apolice: body?.apolice } }),
    });
    const tela = await montar(<MdfePage />);
    await ate(() => expect(tela.querySelector("[data-configuracao-do-mdfe]")).not.toBeNull());
    const secao = tela.querySelector<HTMLElement>("[data-configuracao-do-mdfe]")!;
    expect(secao.textContent).toContain("série 1 · próximo nº 8 · Transportadora");
    await clicar(secao.querySelector("[data-abrir-configuracao]")!);
    expect(secao.querySelector<HTMLInputElement>('[data-campo="proximoNumero"]')!.value).toBe("8");
    await digitar(secao.querySelector<HTMLInputElement>('[data-campo="seguradora"]')!, "Seguradora X");
    await digitar(secao.querySelector<HTMLInputElement>('[data-campo="cnpjDaSeguradora"]')!, "99.000.502/0001-80");
    await digitar(secao.querySelector<HTMLInputElement>('[data-campo="apolice"]')!, "AP-9");
    await enviar(secao.querySelector("form")!);
    await ate(() => expect(secao.querySelector('[role="status"]')).not.toBeNull());
    expect(secao.querySelector('[role="status"]')!.textContent).toBe("Configuração salva.");
    expect(pedidos.find((pedido) => pedido.method === "PUT")?.body).toEqual({ serie: "1", proximoNumero: "8", tipoDeEmitente: "1", seguradora: "Seguradora X", cnpjDaSeguradora: "99.000.502/0001-80", apolice: "AP-9" });
  });
});

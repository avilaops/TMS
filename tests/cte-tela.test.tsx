// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { EXPLICACAO_DO_ICMS, FISCAL_INDISPONIVEL, IBSCBS_COM_ESTORNO, IBSCBS_CST_400, type ConferenciaDoCte, type CteEmitido, type DadosFiscais, type FiscalDaEmpresa, type ResumoDoCte } from "../src/lib/cte";
import type { CargaParaCte } from "../src/lib/nfe";

/**
 * As telas da emissão de CT-e: a lista e o "conferir e emitir"
 * (/dashboard/fiscal/cte) e os dados fiscais com o certificado (Empresa →
 * Fiscal). As regras e as rotas são testadas em tests/cte.test.ts e
 * tests/cte-rotas.test.ts; aqui se confere o que cada tela mostra e o que ela
 * manda para a API. Nada aqui fala com servidor nenhum: o `fetch` é simulado.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}));

import CtePage from "../src/app/dashboard/fiscal/cte/page";
import EmpresaPage from "../src/app/dashboard/empresa/page";

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
});

const CHAVE_CTE = "35261011222333000181570010000000401482159377";

const carga = (extra: Partial<CargaParaCte> = {}): CargaParaCte => ({
  id: "c1",
  trackingCode: "1234567890",
  status: "ROUTE",
  sender: "Fábrica de Tintas",
  receiver: "Mercado Bom Preço",
  origin: "São José do Rio Preto - SP",
  destination: "Mirassol - SP",
  volumes: 3,
  weight: 42.5,
  invoiceKey: "35261099444333000181550010000012341123456780",
  invoiceValue: 1534.56,
  freightValue: 120,
  cteKey: null,
  cteNumber: null,
  cteStatus: "PENDING",
  updatedAt: "2026-10-09T12:00:00.000Z",
  client: { id: "cli1", companyName: "Fábrica de Tintas LTDA", tradeName: "Fábrica de Tintas", cnpj: "99444333000181" },
  emitido: null,
  ...extra,
});

const emitido = (extra: Partial<CteEmitido> = {}): CteEmitido => ({
  id: "cte1",
  ambiente: "HOMOLOGACAO",
  serie: 1,
  numero: 40,
  chave: CHAVE_CTE,
  situacao: "AUTHORIZED",
  cStat: 100,
  motivo: "Autorizado o uso do CT-e",
  protocolo: "135260000000001",
  autorizadoEm: new Date().toISOString(),
  canceladoEm: null,
  semResposta: false,
  atualizadoEm: new Date().toISOString(),
  ...extra,
});

const resumo: ResumoDoCte = {
  ambiente: "HOMOLOGACAO",
  serie: 1,
  numeroPrevisto: 40,
  cfop: "5353",
  emitente: { nome: "Transportadora de Teste Ltda", documento: "11.222.333/0001-81", ie: "123456789012", endereco: "Rua das Flores, 120 - Centro, Mirassol - SP" },
  remetente: { nome: "Fábrica de Tintas LTDA", documento: "99.444.333/0001-81", ie: "110042490114", endereco: "Av. Brasil, 1500 - Distrito Industrial, São José do Rio Preto - SP" },
  destinatario: { nome: "Mercado Bom Preço", documento: "07.526.557/0001-00", ie: null, endereco: "Rua Um, 10 - Centro, Mirassol - SP" },
  tomador: { papel: "REMETENTE", nome: "Fábrica de Tintas LTDA", documento: "99.444.333/0001-81", contribuinte: "1" },
  origem: "São José do Rio Preto - SP",
  destino: "Mirassol - SP",
  valorDaPrestacao: 120,
  valorDaCarga: 1534.56,
  icms: { situacao: "00", grupo: "ICMS00", base: 120, aliquota: 12, valor: 14.4, retido: false },
  ibsCbs: { cst: "000", classe: "000001", base: 105.6, ibs: 0.11, cbs: 0.95 },
  peso: 42.5,
  volumes: 3,
  chavesDeNfe: ["35261099444333000181550010000012341123456780"],
};

const conferencia = (extra: Partial<ConferenciaDoCte> = {}): ConferenciaDoCte => ({ pronta: true, pendencias: [], avisos: ["Em homologação, a SEFAZ exige que o nome do remetente e do destinatário seja a frase dela."], resumo, cte: null, ...extra });

const PRONTA = { body: { pronta: true, ambiente: "HOMOLOGACAO", faltas: [], dacte: true } };
const CONFERIR = "/api/fiscal/cte/emissao?collectionId=c1";

describe("tela de CT-e", () => {
  it("empresa sem dados fiscais nem certificado: explica o que falta e aponta para Empresa → Fiscal; o registro manual continua", async () => {
    const registrada = carga({ cteNumber: 501, cteKey: "35261099444333000343570010000005011123456783", cteStatus: "ISSUED" });
    const pedidos = api({
      "/api/fiscal/cte": { body: [carga(), carga({ id: "c2", trackingCode: "1234567891", status: "DELIVERED", invoiceKey: null, freightValue: null })] },
      "/api/fiscal/cte/situacao": { body: { pronta: false, ambiente: null, dacte: true, faltas: ["Os dados fiscais do emitente não foram preenchidos. Preencha em Empresa → Fiscal.", "A empresa não tem certificado digital A1. Envie em Empresa → Fiscal."] } },
      "POST /api/fiscal/cte": (body) => ({ body: body?.cteKey ? registrada : carga() }),
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelectorAll("tr[data-carga]")).toHaveLength(2));
    await ate(() => expect(tela.querySelector('[data-aviso-cte="falta"]')).not.toBeNull());

    const aviso = tela.querySelector<HTMLElement>("[data-aviso-cte]")!;
    expect(aviso.textContent).toContain("A emissão de CT-e ainda não está pronta nesta empresa.");
    expect(aviso.textContent).toContain("A empresa não tem certificado digital A1.");
    expect(aviso.querySelector('a[href="/dashboard/empresa"]')?.textContent).toBe("Abrir Empresa → Fiscal");
    expect(tela.querySelectorAll('[data-cte="nao-emitido"]')).toHaveLength(2);
    expect(tela.querySelectorAll("tr[data-carga]")[1].textContent).toContain("Falta: chave da NF-e, valor do frete");
    // Nada na tela diz "autorizado" sem a rota ter dito.
    expect(tela.textContent).not.toMatch(/Autorizado/);

    // O registro manual de um CT-e de outro sistema continua como era.
    await clicar(porTexto(tela, "button", "Registrar CT-e de fora")[0]);
    const dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.textContent).toContain("nada é enviado à SEFAZ");
    await digitar(dialogo.querySelector("input")!, "501");
    await digitar(dialogo.querySelector("textarea")!, registrada.cteKey!);
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(tela.querySelector('[data-cte="registrado"]')).not.toBeNull());
    expect(pedidos.at(-1)).toMatchObject({ method: "POST", url: "/api/fiscal/cte", body: { collectionId: "c1", cteNumber: "501", cteKey: registrada.cteKey } });
    expect(tela.querySelector('[data-cte="registrado"]')!.textContent).toBe("Registrado nº 501");
    // Carga com CT-e de fora não oferece a emissão.
    expect(tela.querySelectorAll("tr[data-carga]")[0].querySelector('[data-acao="conferir"]')).toBeNull();

    await clicar(porTexto(tela, "button", "Alterar registro")[0]);
    await clicar(porTexto(tela, '[role="dialog"] button', "Desfazer o registro")[0]);
    await ate(() => expect(tela.querySelector('[data-cte="registrado"]')).toBeNull());
    expect(pedidos.at(-1)?.body).toEqual({ collectionId: "c1", cteNumber: null, cteKey: null });
  });

  it("conferir e emitir em homologação: mostra o que vai no documento e, autorizado, o selo, o XML e o cancelamento", async () => {
    let autorizado = false;
    const pedidos = api({
      "/api/fiscal/cte": () => ({ body: [carga(autorizado ? { emitido: emitido() } : {})] }),
      "/api/fiscal/cte/situacao": PRONTA,
      [CONFERIR]: () => ({ body: conferencia(autorizado ? { pendencias: ["Esta carga já tem CT-e autorizado neste ambiente."], cte: emitido() } : {}) }),
      "/api/fiscal/cte/emissao/cte1/dacte": { status: 502, body: { error: "O serviço fiscal não conseguiu gerar o DACTE deste CT-e." } },
      "POST /api/fiscal/cte/emissao": () => {
        autorizado = true;
        return { body: { cte: emitido(), autorizado: true, mensagem: "CT-e nº 40 autorizado em homologação (sem valor fiscal). Protocolo 135260000000001." } };
      },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-aviso-cte="pronta"]')).not.toBeNull());
    expect(tela.querySelector("[data-aviso-cte]")!.textContent).toContain("Emissão em homologação: CT-e de teste, sem valor fiscal.");

    await clicar(tela.querySelector('[data-acao="conferir"]')!);
    const dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    await ate(() => expect(dialogo.querySelector("[data-resumo]")).not.toBeNull());
    const texto = dialogo.querySelector("[data-resumo]")!.textContent!;
    expect(texto).toContain("Homologação · 1 / 40");
    expect(texto).toContain("5353");
    expect(texto).toContain("Fábrica de Tintas LTDA · 99.444.333/0001-81");
    expect(texto).toContain("o remetente · contribuinte");
    expect(texto).toMatch(/R\$\s120,00/);
    expect(texto).toMatch(/12% de R\$\s120,00 = R\$\s14,40/);
    expect(texto).toMatch(/000 - Tributação integral · R\$\s0,11 \/ R\$\s0,95/);
    expect(dialogo.querySelector("[data-avisos]")!.textContent).toContain("Em homologação");
    expect(dialogo.querySelector("[data-pendencias]")).toBeNull();

    const botao = dialogo.querySelector<HTMLButtonElement>("[data-emitir]")!;
    expect(botao.textContent).toBe("Emitir em homologação");
    expect(botao.disabled).toBe(false);
    await clicar(botao);
    await ate(() => expect(dialogo.querySelector('[data-resultado="autorizado"]')).not.toBeNull());
    expect(dialogo.querySelector("[data-resultado]")!.textContent).toBe("CT-e nº 40 autorizado em homologação (sem valor fiscal). Protocolo 135260000000001.");
    expect(pedidos.find((p) => p.method === "POST")).toMatchObject({ url: "/api/fiscal/cte/emissao", body: { collectionId: "c1" } });
    // Depois de autorizado, emitir de novo fica desligado.
    await ate(() => expect(dialogo.querySelector<HTMLButtonElement>("[data-emitir]")!.disabled).toBe(true));

    await clicar(dialogo.querySelector('button[aria-label="Fechar"]')!);
    await ate(() => expect(tela.querySelector('[data-cte="AUTHORIZED"]')).not.toBeNull());
    expect(tela.querySelector('[data-cte="AUTHORIZED"]')!.textContent).toBe("Autorizado nº 40 (homologação)");
    expect(tela.querySelector<HTMLAnchorElement>('[data-acao="xml"]')!.getAttribute("href")).toBe("/api/fiscal/cte/emissao/cte1/xml");
    expect(tela.querySelector('[data-acao="cancelar"]')).not.toBeNull();
    expect(tela.querySelector('[data-acao="conferir"]')).toBeNull();
    expect(tela.querySelector('[data-acao="registrar"]')).toBeNull();
    // O DACTE só aparece para o autorizado, e a recusa do serviço aparece na tela.
    expect(tela.querySelector("[data-dacte]")!.textContent).toBe("DACTE (PDF)");
    await clicar(tela.querySelector("[data-dacte]")!);
    await ate(() => expect(tela.querySelector('tr[data-carga] [role="alert"]')?.textContent).toBe("O serviço fiscal não conseguiu gerar o DACTE deste CT-e."));
    expect(pedidos.at(-1)).toMatchObject({ method: "GET", url: "/api/fiscal/cte/emissao/cte1/dacte" });
  });

  it("com pendência, o botão de emitir fica desligado e a tela diz o que resolver", async () => {
    const pedidos = api({
      "/api/fiscal/cte": { body: [carga()] },
      "/api/fiscal/cte/situacao": PRONTA,
      [CONFERIR]: { body: conferencia({ pronta: false, pendencias: ["A empresa não tem certificado digital A1. Envie em Empresa → Fiscal.", "A carga está sem valor de frete: é o valor da prestação do CT-e."], resumo: { ...resumo, valorDaPrestacao: null, icms: null, ibsCbs: null } }) },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="conferir"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="conferir"]')!);
    const dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    await ate(() => expect(dialogo.querySelector("[data-pendencias]")).not.toBeNull());
    expect([...dialogo.querySelectorAll("[data-pendencias] li")].map((li) => li.textContent)).toEqual([
      "A empresa não tem certificado digital A1. Envie em Empresa → Fiscal.",
      "A carga está sem valor de frete: é o valor da prestação do CT-e.",
    ]);
    expect(dialogo.querySelector('a[href="/dashboard/empresa"]')).not.toBeNull();
    expect(dialogo.querySelector<HTMLButtonElement>("[data-emitir]")!.disabled).toBe(true);
    expect(dialogo.textContent).toContain("a cotar");
    expect(pedidos.some((p) => p.method === "POST")).toBe(false);
  });

  it("rejeição e falha de rede aparecem com a mensagem da SEFAZ, e nada vira autorizado", async () => {
    let tentativa = 0;
    const rejeitado = emitido({ situacao: "REJECTED", cStat: 481, motivo: "Rejeição: IE deve ser informada para tomador Contribuinte", protocolo: null, autorizadoEm: null });
    api({
      "/api/fiscal/cte": () => ({ body: [carga(tentativa > 0 ? { emitido: rejeitado } : {})] }),
      "/api/fiscal/cte/situacao": PRONTA,
      [CONFERIR]: () => ({ body: conferencia(tentativa > 0 ? { cte: rejeitado } : {}) }),
      "POST /api/fiscal/cte/emissao": () => {
        tentativa += 1;
        return tentativa === 1
          ? { body: { cte: rejeitado, autorizado: false, mensagem: "A SEFAZ rejeitou o CT-e: 481 - Rejeição: IE deve ser informada para tomador Contribuinte." } }
          : { status: 504, body: { error: "A SEFAZ não respondeu no tempo limite. O CT-e ficou sem resposta: emitir de novo começa consultando a SEFAZ pela chave, sem duplicar." } };
      },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="conferir"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="conferir"]')!);
    const dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    await ate(() => expect(dialogo.querySelector<HTMLButtonElement>("[data-emitir]")!.disabled).toBe(false));
    await clicar(dialogo.querySelector("[data-emitir]")!);
    await ate(() => expect(dialogo.querySelector('[data-resultado="nao-autorizado"]')).not.toBeNull());
    expect(dialogo.querySelector("[data-resultado]")!.textContent).toContain("481 - Rejeição: IE deve ser informada");
    await ate(() => expect(tela.querySelector('[data-cte="REJECTED"]')).not.toBeNull());
    expect(tela.querySelector("tr[data-carga]")!.textContent).toContain("481 - Rejeição: IE deve ser informada para tomador Contribuinte");

    await clicar(dialogo.querySelector("[data-emitir]")!);
    await ate(() => expect(dialogo.querySelector('[role="alert"]')).not.toBeNull());
    expect(dialogo.querySelector('[role="alert"]')!.textContent).toContain("A SEFAZ não respondeu no tempo limite.");
    expect(tela.textContent).not.toMatch(/Autorizado|autorizado em/);
    expect(tela.querySelector('[data-acao="xml"]')).toBeNull();
    expect(tela.querySelector('[data-acao="cancelar"]')).toBeNull();
  });

  it("cancelar: pede a justificativa de 15 letras ou mais e mostra a recusa da SEFAZ", async () => {
    let cancelado = false;
    const pedidos = api({
      "/api/fiscal/cte": () => ({ body: [carga({ emitido: emitido(cancelado ? { situacao: "CANCELLED", canceladoEm: new Date().toISOString() } : {}) })] }),
      "/api/fiscal/cte/situacao": PRONTA,
      "POST /api/fiscal/cte/emissao/cte1/cancelar": (body) => {
        if (String(body?.justificativa).includes("fora do prazo")) return { status: 409, body: { error: "A SEFAZ recusou o cancelamento: 220 - Rejeição: CTe autorizado há mais de 7 dias (168 horas)." } };
        cancelado = true;
        return { body: emitido({ situacao: "CANCELLED" }) };
      },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="cancelar"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="cancelar"]')!);
    const dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.textContent).toContain("Cancelar CT-e nº 40");
    const botao = porTexto(dialogo, "button", "Cancelar o CT-e na SEFAZ")[0] as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await digitar(dialogo.querySelector("textarea")!, "curta");
    expect(botao.disabled).toBe(true);

    await digitar(dialogo.querySelector("textarea")!, "Pedido feito fora do prazo");
    expect(botao.disabled).toBe(false);
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(dialogo.querySelector('[role="alert"]')).not.toBeNull());
    expect(dialogo.querySelector('[role="alert"]')!.textContent).toContain("220 - Rejeição");
    expect(tela.querySelector('[data-cte="AUTHORIZED"]')).not.toBeNull();

    await digitar(dialogo.querySelector("textarea")!, "Carga recusada pelo destinatário");
    await enviar(dialogo.querySelector("form")!);
    await ate(() => expect(tela.querySelector('[data-cte="CANCELLED"]')).not.toBeNull());
    expect(pedidos.at(-2)).toMatchObject({ method: "POST", url: "/api/fiscal/cte/emissao/cte1/cancelar", body: { justificativa: "Carga recusada pelo destinatário" } });
    expect(tela.querySelector('[role="dialog"]')).toBeNull();
    expect(tela.querySelector('[data-cte="CANCELLED"]')!.textContent).toBe("Cancelado nº 40 (homologação)");
    // Cancelado: o XML continua disponível e a carga pode receber outro CT-e.
    expect(tela.querySelector('[data-acao="xml"]')).not.toBeNull();
    expect(tela.querySelector('[data-acao="conferir"]')).not.toBeNull();
    expect(tela.querySelector('[data-acao="cancelar"]')).toBeNull();
  });

  it("fora do prazo de 7 dias o cancelamento fica desligado; a consulta ao serviço mostra a resposta da SEFAZ", async () => {
    api({
      "/api/fiscal/cte": { body: [carga({ emitido: emitido({ ambiente: "PRODUCAO", autorizadoEm: new Date(Date.now() - 8 * 86_400_000).toISOString() }) })] },
      "/api/fiscal/cte/situacao": { body: { pronta: true, ambiente: "PRODUCAO", faltas: [], dacte: false } },
      "/api/fiscal/cte/status-servico": { body: { ambiente: "PRODUCAO", autorizador: "SP", emOperacao: true, cStat: 107, motivo: "Serviço em Operação" } },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-aviso-cte="pronta"]')).not.toBeNull());
    expect(tela.querySelector("[data-aviso-cte]")!.textContent).toContain("Emissão em produção: CT-e com valor fiscal.");
    expect(tela.querySelector('[data-cte="AUTHORIZED"]')!.textContent).toBe("Autorizado nº 40");
    // Com o serviço de DACTE desligado, o botão não aparece.
    expect(tela.querySelector("[data-dacte]")).toBeNull();

    await clicar(tela.querySelector("[data-consultar-sefaz]")!);
    await ate(() => expect(tela.querySelector("[data-status-sefaz]")).not.toBeNull());
    expect(tela.querySelector("[data-status-sefaz]")!.textContent).toBe("SEFAZ SP: 107 Serviço em Operação");

    await clicar(tela.querySelector('[data-acao="cancelar"]')!);
    const dialogo = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.querySelector("[data-fora-do-prazo]")).not.toBeNull();
    await digitar(dialogo.querySelector("textarea")!, "Carga recusada pelo destinatário");
    expect((porTexto(dialogo, "button", "Cancelar o CT-e na SEFAZ")[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("sessão expirada e perfil sem acesso", async () => {
    api({ "/api/fiscal/cte": { status: 401, body: { error: "Não autorizado" } }, "/api/fiscal/cte/situacao": { status: 401, body: {} } });
    const semSessao = await montar(<CtePage />);
    await ate(() => expect(semSessao.textContent).toContain("Sessão expirada"));
    await desmontarTudo();
    api({ "/api/fiscal/cte": { status: 403, body: { error: "Acesso negado" } }, "/api/fiscal/cte/situacao": { status: 403, body: {} } });
    const semAcesso = await montar(<CtePage />);
    await ate(() => expect(semAcesso.textContent).toContain("Acesso negado"));
  });
});

/* ------------------------------ Empresa → Fiscal ------------------------------ */

const DADOS: DadosFiscais = {
  cnpj: "11222333000181",
  ie: "123456789012",
  razaoSocial: "Transportadora de Teste Ltda",
  fantasia: null,
  logradouro: "Rua das Flores",
  numero: "120",
  complemento: null,
  bairro: "Centro",
  codigoMunicipio: "3530300",
  cidade: "Mirassol",
  uf: "SP",
  cep: "15130000",
  telefone: null,
  rntrc: "12345678",
  regime: "3",
  serie: 1,
  proximoNumero: 41,
  ambiente: "HOMOLOGACAO",
  cfopDentro: "5353",
  cfopFora: "6353",
  icms: "00",
  aliquota: 12,
  reducaoDaBase: null,
  reducaoNaInterestadual: false,
  ibsCbsCst: "000",
  ibsCbsClasse: "000001",
  ibsUf: 0.1,
  ibsMunicipio: 0,
  cbs: 0.9,
  pis: 0,
  cofins: 0,
};

const CERTIFICADO = { titular: "TRANSPORTADORA DE TESTE LTDA:11222333000181", cnpj: "11222333000181", validoDe: "2026-01-01T00:00:00.000Z", validoAte: "2027-01-01T00:00:00.000Z", vencido: false, confere: "MESMO_CNPJ" as const, enviadoEm: "2026-10-10T12:00:00.000Z" };

/** As outras seções da tela da Empresa, que não são o assunto destes testes. */
const RESTO_DA_EMPRESA = {
  "/api/empresa": { body: { name: "Transportadora de Teste", logo: null } },
  "/api/empresa/cobranca": { body: { multaPct: 2, jurosPct: 1, pix: null } },
  "/api/empresa/gateway": { body: { disponivel: true, configurado: false, accessTokenFinal: null, webhookSecretFinal: null, webhook: "https://tms.exemplo.br/api/pagamentos/mercado-pago/teste" } },
  "/api/empresa/webhook": { body: { url: null, entregas: [] } },
};

describe("Empresa → Fiscal", () => {
  const secao = (tela: HTMLElement) => tela.querySelector<HTMLElement>('section[aria-label="Fiscal"]')!;
  const campo = (tela: HTMLElement, nome: string) => secao(tela).querySelector<HTMLInputElement | HTMLSelectElement>(`[data-campo="${nome}"]`)!;

  it("a aba Fiscal entra no menu do celular, e a seção abre com os dados salvos e as alíquotas de IBS/CBS", async () => {
    api({ ...RESTO_DA_EMPRESA, "/api/empresa/fiscal": { body: { disponivel: true, dados: DADOS, certificado: null } satisfies FiscalDaEmpresa } });
    const tela = await montar(<EmpresaPage />);
    await ate(() => expect(secao(tela)).not.toBeNull());
    expect([...tela.querySelectorAll('[role="tablist"][aria-label="Parte"] [role="tab"]')].map((aba) => aba.textContent)).toEqual(["Identidade", "Cobrança", "Integração", "Fiscal"]);
    // No celular a seção só aparece na aba dela.
    expect(secao(tela).className).toContain("hidden md:block");
    await clicar(tela.querySelector('[data-aba="fiscal"]')!);
    expect(secao(tela).className).not.toContain("hidden md:block");
    expect([...secao(tela).querySelectorAll("[data-parte-fiscal]")].map((parte) => parte.textContent)).toEqual(["Emitente", "Tributos", "Certificado"]);

    expect(campo(tela, "cnpj").value).toBe("11222333000181");
    expect(campo(tela, "cidade").value).toBe("Mirassol");
    expect(campo(tela, "proximoNumero").value).toBe("41");
    expect(campo(tela, "ibsCbsCst").value).toBe("000");
    expect(campo(tela, "ibsCbsClasse").value).toBe("000001");
    expect([campo(tela, "ibsUf").value, campo(tela, "ibsMunicipio").value, campo(tela, "cbs").value]).toEqual(["0,1", "0", "0,9"]);
    expect(secao(tela).querySelector("[data-sem-certificado]")).not.toBeNull();
    expect(secao(tela).querySelector("[data-confirmar-producao]")).toBeNull();
  });

  it("salva o formulário; passar a produção pede o CNPJ digitado de novo, e a recusa do servidor aparece", async () => {
    const pedidos = api({
      ...RESTO_DA_EMPRESA,
      "/api/empresa/fiscal": { body: { disponivel: true, dados: DADOS, certificado: null } },
      "PUT /api/empresa/fiscal": (body) =>
        body?.ambiente === "PRODUCAO" && body.confirmacaoDoCnpj !== "11.222.333/0001-81"
          ? { status: 400, body: { error: "Para emitir em produção, digite o CNPJ do emitente no campo de confirmação." } }
          : { body: { disponivel: true, dados: { ...DADOS, ambiente: body?.ambiente, proximoNumero: Number(body?.proximoNumero) }, certificado: null } },
    });
    const tela = await montar(<EmpresaPage />);
    await ate(() => expect(secao(tela)).not.toBeNull());
    const form = secao(tela).querySelector<HTMLFormElement>("[data-form-fiscal]")!;

    await digitar(campo(tela, "proximoNumero"), "50");
    await enviar(form);
    await ate(() => expect(secao(tela).querySelector('[role="status"]')?.textContent).toBe("Dados fiscais salvos."));
    expect(pedidos.at(-1)).toMatchObject({ method: "PUT", url: "/api/empresa/fiscal", body: { cnpj: "11222333000181", proximoNumero: "50", ambiente: "HOMOLOGACAO", ibsCbsCst: "000", ibsCbsClasse: "000001", ibsUf: "0,1", cbs: "0,9" } });

    await digitar(campo(tela, "ambiente"), "PRODUCAO");
    expect(secao(tela).querySelector("[data-confirmar-producao]")!.textContent).toContain("Produção emite CT-e com valor fiscal");
    await digitar(campo(tela, "confirmacaoDoCnpj"), "outro");
    await enviar(form);
    await ate(() => expect(secao(tela).querySelector('[role="alert"]')?.textContent).toContain("digite o CNPJ do emitente"));
    await digitar(campo(tela, "confirmacaoDoCnpj"), "11.222.333/0001-81");
    await enviar(form);
    await ate(() => expect(secao(tela).querySelector('[role="status"]')?.textContent).toBe("Dados fiscais salvos."));
    // Já em produção, o campo de confirmação some.
    expect(secao(tela).querySelector("[data-confirmar-producao]")).toBeNull();
  });

  it("tributos: CFOP e classificação em lista, a explicação do ICMS, a redução só na situação 20, e a configuração antiga com CST 400 pede a correção", async () => {
    const pedidos = api({
      ...RESTO_DA_EMPRESA,
      "/api/empresa/fiscal": { body: { disponivel: true, dados: { ...DADOS, ibsCbsCst: "400", ibsCbsClasse: "400001", cfopDentro: "5102" }, certificado: null } },
      "PUT /api/empresa/fiscal": { body: { disponivel: true, dados: DADOS, certificado: null } },
    });
    const tela = await montar(<EmpresaPage />);
    await ate(() => expect(secao(tela)).not.toBeNull());
    const opcoes = (nome: string) => [...campo(tela, nome).querySelectorAll("option")].map((opcao) => opcao.value);

    // O que estava gravado e deixou de valer aparece marcado, com o pedido de correção.
    expect(campo(tela, "ibsCbsCst").value).toBe("400");
    expect(secao(tela).querySelector("[data-ibscbs-invalido]")!.textContent).toBe(IBSCBS_CST_400);
    expect(opcoes("ibsCbsCst")).toEqual(["", "400", "000", "200", "410"]);
    expect(campo(tela, "cfopDentro").value).toBe("5102");
    expect(campo(tela, "cfopDentro").querySelector("option")!.textContent).toContain("não vale mais");
    expect(opcoes("cfopFora")).toEqual(["6351", "6352", "6353", "6354", "6355", "6356", "6357", "6359", "6360"]);

    // Trocar o CST troca a classificação pela primeira que vale com ele, e o aviso some.
    await digitar(campo(tela, "ibsCbsCst"), "200");
    expect(opcoes("ibsCbsClasse")).toEqual(["200001", "200020", "200050"]);
    expect(campo(tela, "ibsCbsClasse").value).toBe("200001");
    expect(secao(tela).querySelector("[data-ibscbs-invalido]")).toBeNull();
    await digitar(campo(tela, "ibsCbsCst"), "410");
    expect(opcoes("ibsCbsClasse")).toHaveLength(8);
    // A 410026 exige o estorno de crédito, que o sistema não monta.
    await digitar(campo(tela, "ibsCbsClasse"), "410026");
    expect(secao(tela).querySelector("[data-ibscbs-invalido]")!.textContent).toBe(IBSCBS_COM_ESTORNO);
    await digitar(campo(tela, "ibsCbsCst"), "000");
    await digitar(campo(tela, "cfopDentro"), "5353");

    // A explicação acompanha a situação do ICMS; a redução da base só existe na 20.
    const explicacao = () => secao(tela).querySelector("[data-explicacao-icms]")!.textContent!;
    expect(explicacao()).toContain(EXPLICACAO_DO_ICMS["00"]);
    expect(explicacao()).toContain("interestadual (7% ou 12%), calculada pelo sistema");
    expect(secao(tela).querySelector('[data-campo="reducaoDaBase"]')).toBeNull();
    expect(opcoes("icms")).toEqual(["00", "20", "40", "41", "60", "90", "SN"]);
    await digitar(campo(tela, "icms"), "60");
    expect(explicacao()).toContain(EXPLICACAO_DO_ICMS["60"]);
    // Situação sem alíquota não fala da interestadual.
    await digitar(campo(tela, "icms"), "40");
    expect(explicacao()).toBe(EXPLICACAO_DO_ICMS["40"]);
    await digitar(campo(tela, "icms"), "20");
    expect(explicacao()).toContain(EXPLICACAO_DO_ICMS["20"]);
    await digitar(campo(tela, "reducaoDaBase"), "20");
    // A caixa da redução na interestadual só existe na situação 20, nasce desmarcada e explica o que acontece.
    const caixa = () => secao(tela).querySelector<HTMLInputElement>('[data-campo="reducaoNaInterestadual"]');
    expect(caixa()!.checked).toBe(false);
    expect(secao(tela).querySelector("[data-reducao-na-interestadual]")!.textContent).toContain("Desmarcado, o CT-e para outro estado não é emitido");
    await clicar(caixa()!);
    expect(caixa()!.checked).toBe(true);

    await enviar(secao(tela).querySelector<HTMLFormElement>("[data-form-fiscal]")!);
    await ate(() => expect(secao(tela).querySelector('[role="status"]')?.textContent).toBe("Dados fiscais salvos."));
    expect(pedidos.at(-1)).toMatchObject({ method: "PUT", body: { icms: "20", aliquota: "12", reducaoDaBase: "20", reducaoNaInterestadual: "true", cfopDentro: "5353", cfopFora: "6353", ibsCbsCst: "000", ibsCbsClasse: "000001" } });

    // Sair da situação 20 limpa a redução.
    await digitar(campo(tela, "icms"), "20");
    await digitar(campo(tela, "reducaoDaBase"), "15");
    await clicar(caixa()!);
    await digitar(campo(tela, "icms"), "00");
    expect(caixa()).toBeNull();
    await enviar(secao(tela).querySelector<HTMLFormElement>("[data-form-fiscal]")!);
    await ate(() => expect(pedidos.at(-1)).toMatchObject({ body: { icms: "00", reducaoDaBase: "", reducaoNaInterestadual: "false" } }));
  });

  it("envia o certificado em base64 com a senha, limpa a senha da tela e mostra só titular, CNPJ e validade; remover apaga", async () => {
    const pedidos = api({
      ...RESTO_DA_EMPRESA,
      "/api/empresa/fiscal": { body: { disponivel: true, dados: DADOS, certificado: null } },
      "PUT /api/empresa/fiscal/certificado": (body) =>
        body?.senha === "errada" ? { status: 400, body: { error: "Não foi possível abrir o certificado: a senha não confere ou o arquivo não é um .pfx/.p12 válido." } } : { body: { disponivel: true, dados: DADOS, certificado: CERTIFICADO } },
      "DELETE /api/empresa/fiscal/certificado": { body: { disponivel: true, dados: DADOS, certificado: null } },
    });
    const tela = await montar(<EmpresaPage />);
    await ate(() => expect(secao(tela)).not.toBeNull());
    const bloco = secao(tela).querySelector<HTMLElement>("[data-certificado]")!;
    const arquivo = new File([new Uint8Array([48, 130, 1, 2, 255])], "empresa.pfx", { type: "application/x-pkcs12" });
    const entrada = bloco.querySelector<HTMLInputElement>('[data-campo="arquivo"]')!;
    Object.defineProperty(entrada, "files", { configurable: true, value: [arquivo] });
    await act(async () => {
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await digitar(bloco.querySelector<HTMLInputElement>('[data-campo="senha"]')!, "errada");
    await enviar(bloco.querySelector("form")!);
    await ate(() => expect(secao(tela).querySelector('[role="alert"]')?.textContent).toContain("a senha não confere"));
    expect(bloco.querySelector("[data-certificado-guardado]")).toBeNull();

    await digitar(bloco.querySelector<HTMLInputElement>('[data-campo="senha"]')!, "senha-certa");
    await enviar(bloco.querySelector("form")!);
    await ate(() => expect(bloco.querySelector("[data-certificado-guardado]")).not.toBeNull());
    expect(pedidos.at(-1)).toMatchObject({ method: "PUT", url: "/api/empresa/fiscal/certificado", body: { arquivo: "MIIBAv8=", senha: "senha-certa" } });
    expect(bloco.querySelector("[data-certificado-guardado]")!.textContent).toContain("TRANSPORTADORA DE TESTE LTDA:11222333000181");
    expect(bloco.querySelector("[data-certificado-guardado]")!.textContent).toContain("CNPJ 11222333000181 · válido até 01/01/2027 · confere com o emitente");
    // A senha sai da tela assim que é guardada, e a tela não mostra nada do arquivo.
    expect(bloco.querySelector<HTMLInputElement>('[data-campo="senha"]')!.value).toBe("");
    expect(tela.textContent).not.toContain("senha-certa");
    expect(tela.textContent).not.toContain("MIIBAv8=");

    await clicar(porTexto(bloco, "button", "Remover")[0]);
    await ate(() => expect(bloco.querySelector("[data-sem-certificado]")).not.toBeNull());
    expect(pedidos.at(-1)).toMatchObject({ method: "DELETE", url: "/api/empresa/fiscal/certificado" });
  });

  it("sem a chave de dados no servidor, a tela explica; certificado vencido ou de outro CNPJ aparece em vermelho", async () => {
    api({ ...RESTO_DA_EMPRESA, "/api/empresa/fiscal": { body: { disponivel: false, dados: DADOS, certificado: null } } });
    const semChave = await montar(<EmpresaPage />);
    await ate(() => expect(secao(semChave)).not.toBeNull());
    expect(secao(semChave).querySelector("[data-fiscal-indisponivel]")!.textContent).toBe(FISCAL_INDISPONIVEL);
    expect(secao(semChave).querySelector('[data-campo="senha"]')).toBeNull();
    await desmontarTudo();

    api({ ...RESTO_DA_EMPRESA, "/api/empresa/fiscal": { body: { disponivel: true, dados: DADOS, certificado: { ...CERTIFICADO, vencido: true } } } });
    const vencido = await montar(<EmpresaPage />);
    await ate(() => expect(secao(vencido)?.querySelector("[data-certificado-guardado]")).not.toBeNull());
    expect(secao(vencido).querySelector("[data-certificado-guardado]")!.textContent).toContain("· Vencido");
    expect(secao(vencido).querySelector("[data-certificado-guardado]")!.className).toContain("text-red-800");
  });
});

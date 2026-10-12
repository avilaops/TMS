// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar } from "./tela";
import { QUANDO_REGISTRAR_A_ENTREGA, SEM_COMPROVANTE_ACEITO, fraseDoCampoProibido, type ConferenciaDoCte, type CteEmitido, type EventoDoCte, type EventosDoCte } from "../src/lib/cte";
import type { CargaParaCte } from "../src/lib/nfe";

/**
 * A tela de CT-e (/dashboard/fiscal/cte) no que é dos eventos: "Corrigir"
 * (carta de correção), "Entrega na SEFAZ" (comprovante de entrega), "Conferir
 * na SEFAZ", a emissão pela SVC e o CT-e que ficou para resolver. As regras e
 * as rotas são testadas em tests/cte-eventos.test.ts e
 * tests/cte-eventos-rotas.test.ts; aqui se confere o que a tela mostra e o que
 * ela manda para a API. O `fetch` é simulado.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));

import CtePage from "../src/app/dashboard/fiscal/cte/page";

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

async function digitar(campo: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const gravar = Object.getOwnPropertyDescriptor(prototipo, "value")!.set!;
  await act(async () => {
    gravar.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

const emitido = (extra: Partial<CteEmitido> = {}): CteEmitido => ({
  id: "cte1",
  ambiente: "PRODUCAO",
  serie: 1,
  numero: 40,
  chave: "35261099000108000141570010000000401482159377",
  situacao: "AUTHORIZED",
  cStat: 100,
  motivo: "Autorizado o uso do CT-e",
  protocolo: "135260000000001",
  autorizadoEm: new Date().toISOString(),
  canceladoEm: null,
  semResposta: false,
  atualizadoEm: new Date().toISOString(),
  svc: null,
  ...extra,
});

const carga = (extra: Partial<CargaParaCte> = {}): CargaParaCte => ({
  id: "c1",
  trackingCode: "1234567890",
  status: "DELIVERED",
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
  emitido: emitido(),
  aResolver: [],
  comprovanteAceito: false,
  ...extra,
});

const evento = (extra: Partial<EventoDoCte> = {}): EventoDoCte => ({ id: "ev1", tipo: "110110", sequencia: 1, protocolo: "135260000000009", registradoEm: "2026-10-12T15:00:00.000Z", descricao: "compl/xObs: Entregar no depósito 2", canceladoEm: null, deFora: false, ...extra });
const SEM_ENTREGA = { situacao: "INDISPONIVEL" as const, motivo: SEM_COMPROVANTE_ACEITO, recebedor: null, entregueEm: null, imagem: null, protocolo: null };
const eventos = (extra: Partial<EventosDoCte> = {}): EventosDoCte => ({ cte: emitido(), eventos: [], entrega: SEM_ENTREGA, ...extra });

const PRONTA = { body: { pronta: true, ambiente: "PRODUCAO", faltas: [], dacte: false } };
const EVENTOS = "/api/fiscal/cte/emissao/cte1/eventos";
const dialogoDe = (tela: HTMLElement) => tela.querySelector<HTMLElement>('[role="dialog"]')!;

describe("tela de CT-e: eventos, SVC e conferência", () => {
  it("as ações da linha: Corrigir e Conferir na SEFAZ no autorizado (também no da SVC); Entrega na SEFAZ só com comprovante aprovado; nada disso no rascunho", async () => {
    api({
      "/api/fiscal/cte": {
        body: [
          carga(),
          carga({ id: "c2", comprovanteAceito: true }),
          carga({ id: "c3", comprovanteAceito: true, emitido: emitido({ id: "cte3", svc: "SVC-RS" }) }),
          carga({ id: "c4", emitido: emitido({ id: "cte4", situacao: "DRAFT", protocolo: null, autorizadoEm: null, cStat: null, motivo: null }) }),
          carga({ id: "c5", emitido: emitido({ id: "cte5", situacao: "DRAFT", protocolo: null, autorizadoEm: null, semResposta: true }) }),
        ],
      },
      "/api/fiscal/cte/situacao": PRONTA,
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelectorAll("tr[data-carga]")).toHaveLength(5));
    const acoes = (id: string) => [...tela.querySelectorAll(`tr[data-carga="${id}"] [data-acao]`)].map((no) => no.getAttribute("data-acao"));
    expect(acoes("c1")).toEqual(["xml", "corrigir", "sefaz", "cancelar"]);
    expect(acoes("c2")).toEqual(["xml", "corrigir", "entrega", "sefaz", "cancelar"]);
    // O CT-e da SVC tem as mesmas ações: a carta de correção e o comprovante dele vão para a SEFAZ de origem.
    expect(acoes("c3")).toEqual(["xml", "corrigir", "entrega", "sefaz", "cancelar"]);
    expect(tela.querySelector('tr[data-carga="c3"] [data-cte]')!.textContent).toBe("Autorizado nº 40, SVC-RS");
    expect(acoes("c4")).toEqual(["conferir", "registrar"]);
    // O envio sem resposta pode ser conferido na SEFAZ sem reenviar nada.
    expect(acoes("c5")).toEqual(["conferir", "sefaz", "registrar"]);
    // Rótulos curtos, num contêiner que quebra a linha: a linha não estoura a largura do celular.
    // As principais ficam à vista; as outras, no menu "Mais" (o desenho do menu é testado em tests/subcontratacao-tela.test.tsx).
    const contem = tela.querySelector('tr[data-carga="c2"] [data-acoes]')!;
    expect(contem.className).toContain("flex-wrap");
    expect([...contem.children].map((no) => (no.matches("[data-mais]") ? "Mais" : no.textContent))).toEqual(["Baixar XML", "Corrigir", "Mais"]);
    expect([...contem.querySelectorAll("[data-mais] [data-acao]")].map((no) => no.textContent)).toEqual(["Entrega na SEFAZ", "Conferir na SEFAZ", "Cancelar"]);
  });

  it("Corrigir: mostra as cartas registradas, barra o campo proibido antes de enviar e manda as correções", async () => {
    let registradas: EventoDoCte[] = [evento()];
    const pedidos = api({
      "/api/fiscal/cte": { body: [carga()] },
      "/api/fiscal/cte/situacao": PRONTA,
      [EVENTOS]: () => ({ body: eventos({ eventos: registradas }) }),
      "POST /api/fiscal/cte/emissao/cte1/correcao": () => {
        registradas = [...registradas, evento({ id: "ev2", sequencia: 2, descricao: "ide/retira: 0; infQ/qCarga (item 2): 44.0000" })];
        return { body: eventos({ eventos: registradas }) };
      },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="corrigir"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="corrigir"]')!);
    const dialogo = dialogoDe(tela);
    await ate(() => expect(dialogo.querySelector("[data-eventos]")).not.toBeNull());
    expect(dialogo.querySelector("h2")!.textContent).toBe("Corrigir CT-e nº 40");
    expect(dialogo.querySelector("[data-eventos]")!.textContent).toContain("Carta de correção nº 1");
    expect(dialogo.querySelector("[data-eventos]")!.textContent).toContain("prot. 135260000000009");
    expect(dialogo.querySelector("[data-eventos]")!.textContent).toContain("compl/xObs: Entregar no depósito 2");

    const botao = dialogo.querySelector<HTMLButtonElement>("[data-registrar-carta]")!;
    expect(botao.disabled).toBe(true);
    const campos = (indice: number) => [...dialogo.querySelectorAll<HTMLInputElement>(`[data-correcao="${indice}"] input`)];
    await digitar(campos(0)[0], "vPrest");
    await digitar(campos(0)[1], "vTPrest");
    await digitar(campos(0)[2], "900.00");
    // O valor da prestação não se corrige por carta: a tela diz e não deixa enviar.
    expect(dialogo.querySelector('[role="alert"]')!.textContent).toBe(fraseDoCampoProibido("vPrest", "vTPrest"));
    expect(botao.disabled).toBe(true);

    await digitar(campos(0)[0], "ide");
    await digitar(campos(0)[1], "retira");
    await digitar(campos(0)[2], "0");
    expect(dialogo.querySelector('[role="alert"]')).toBeNull();
    await clicar(dialogo.querySelector("[data-mais-correcao]")!);
    await digitar(campos(1)[0], "infQ");
    await digitar(campos(1)[1], "qCarga");
    await digitar(campos(1)[2], "44.0000");
    await digitar(campos(1)[3], "2");
    expect(botao.disabled).toBe(false);
    await clicar(botao);
    await ate(() => expect(dialogo.querySelector('[data-resultado="registrada"]')).not.toBeNull());
    expect(pedidos.find((p) => p.method === "POST")).toMatchObject({
      url: "/api/fiscal/cte/emissao/cte1/correcao",
      body: { correcoes: [{ grupo: "ide", campo: "retira", valor: "0", item: "" }, { grupo: "infQ", campo: "qCarga", valor: "44.0000", item: "2" }] },
    });
    expect(dialogo.querySelectorAll("[data-evento]")).toHaveLength(2);
    // O formulário volta a uma correção em branco.
    expect(dialogo.querySelectorAll("[data-correcao]")).toHaveLength(1);
    expect(campos(0)[0].value).toBe("");
  });

  it("Corrigir: a recusa da SEFAZ aparece e nada é dado como registrado", async () => {
    api({
      "/api/fiscal/cte": { body: [carga()] },
      "/api/fiscal/cte/situacao": PRONTA,
      [EVENTOS]: { body: eventos() },
      "POST /api/fiscal/cte/emissao/cte1/correcao": { status: 409, body: { error: "A SEFAZ recusou a carta de correção: 681 - Rejeição: Informação não pode ser alterada por carta de correção." } },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="corrigir"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="corrigir"]')!);
    const dialogo = dialogoDe(tela);
    await ate(() => expect(dialogo.textContent).toContain("Nenhuma carta de correção registrada para este CT-e."));
    const campos = [...dialogo.querySelectorAll<HTMLInputElement>('[data-correcao="0"] input')];
    await digitar(campos[0], "compl");
    await digitar(campos[1], "xObs");
    await digitar(campos[2], "Entregar no depósito 2");
    await clicar(dialogo.querySelector("[data-registrar-carta]")!);
    await ate(() => expect(dialogo.querySelector('[role="alert"]')?.textContent).toContain("A SEFAZ recusou a carta de correção: 681"));
    expect(dialogo.querySelector("[data-resultado]")).toBeNull();
    expect(dialogo.querySelector("[data-evento]")).toBeNull();
    // O que a pessoa digitou continua na tela.
    expect(campos[2].value).toBe("Entregar no depósito 2");
  });

  it("Entrega na SEFAZ: diz quando registrar, mostra quem recebeu, registra, e depois oferece cancelar o comprovante", async () => {
    const disponivel = { situacao: "DISPONIVEL" as const, motivo: null, recebedor: "Maria Recebedora", entregueEm: "2026-10-11T18:45:00.000Z", imagem: "foto do canhoto", protocolo: null };
    const registrada = { ...disponivel, situacao: "REGISTRADA" as const, protocolo: "135260000000021" };
    const daEntrega = evento({ id: "ev5", tipo: "110180", descricao: "Entregue a Maria Recebedora em 11/10/2026, 15:45 (foto do canhoto)", protocolo: "135260000000021" });
    const pedidos = api({
      "/api/fiscal/cte": { body: [carga({ comprovanteAceito: true })] },
      "/api/fiscal/cte/situacao": PRONTA,
      [EVENTOS]: { body: eventos({ entrega: disponivel }) },
      "POST /api/fiscal/cte/emissao/cte1/entrega": { body: eventos({ entrega: registrada, eventos: [daEntrega] }) },
      "DELETE /api/fiscal/cte/emissao/cte1/entrega": { body: eventos({ entrega: disponivel, eventos: [{ ...daEntrega, canceladoEm: "2026-10-12T16:00:00.000Z" }, evento({ id: "ev6", tipo: "110181", descricao: "Cancelado o comprovante de entrega de protocolo 135260000000021" })] }) },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="entrega"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="entrega"]')!);
    const dialogo = dialogoDe(tela);
    await ate(() => expect(dialogo.querySelector('[data-entrega="DISPONIVEL"]')).not.toBeNull());
    expect(dialogo.querySelector("[data-quando-registrar]")!.textContent).toBe(QUANDO_REGISTRAR_A_ENTREGA);
    const texto = dialogo.querySelector("[data-entrega]")!.textContent!;
    expect(texto).toContain("Maria Recebedora");
    expect(texto).toMatch(/11\/10\/26,? 15:45/);
    expect(texto).toContain("Não registrada");
    expect(texto).toContain("foto do canhoto");

    await clicar(dialogo.querySelector("[data-registrar-entrega]")!);
    await ate(() => expect(dialogo.querySelector('[data-entrega="REGISTRADA"]')).not.toBeNull());
    expect(pedidos.at(-1)).toMatchObject({ method: "POST", url: "/api/fiscal/cte/emissao/cte1/entrega", body: undefined });
    expect(dialogo.querySelector("[data-entrega]")!.textContent).toContain("Registrada · prot. 135260000000021");
    expect(dialogo.querySelector("[data-registrar-entrega]")).toBeNull();
    expect(dialogo.querySelector("[data-eventos]")!.textContent).toContain("Comprovante de entrega nº 1");

    await clicar(dialogo.querySelector("[data-cancelar-entrega]")!);
    await ate(() => expect(dialogo.querySelector('[data-entrega="DISPONIVEL"]')).not.toBeNull());
    expect(pedidos.at(-1)).toMatchObject({ method: "DELETE", url: "/api/fiscal/cte/emissao/cte1/entrega" });
    expect([...dialogo.querySelectorAll("[data-evento]")].map((no) => no.textContent)).toEqual([expect.stringContaining("Comprovante de entrega nº 1 (cancelado)"), expect.stringContaining("Cancelamento do comprovante de entrega nº 1")]);
  });

  it("Entrega na SEFAZ: sem o que enviar, o botão fica desligado e a tela diz por quê", async () => {
    const pedidos = api({
      "/api/fiscal/cte": { body: [carga({ comprovanteAceito: true })] },
      "/api/fiscal/cte/situacao": PRONTA,
      [EVENTOS]: { body: eventos({ entrega: { ...SEM_ENTREGA, motivo: "O comprovante aprovado não tem imagem." } }) },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="entrega"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="entrega"]')!);
    const dialogo = dialogoDe(tela);
    await ate(() => expect(dialogo.querySelector("[data-impedimento]")).not.toBeNull());
    expect(dialogo.querySelector("[data-impedimento]")!.textContent).toBe("O comprovante aprovado não tem imagem.");
    expect(dialogo.querySelector<HTMLButtonElement>("[data-registrar-entrega]")!.disabled).toBe(true);
    expect(pedidos.some((p) => p.method !== "GET")).toBe(false);
  });

  it("Conferir na SEFAZ: consulta ao abrir, mostra o que a SEFAZ respondeu e os eventos, e a lista passa a mostrar a situação nova", async () => {
    let cancelado = false;
    const pedidos = api({
      "/api/fiscal/cte": () => ({ body: [carga(cancelado ? { emitido: emitido({ situacao: "CANCELLED", canceladoEm: new Date().toISOString() }) } : {})] }),
      "/api/fiscal/cte/situacao": PRONTA,
      "POST /api/fiscal/cte/emissao/cte1/situacao": () => {
        cancelado = true;
        return {
          body: {
            cte: emitido({ situacao: "CANCELLED" }),
            mensagem: "A SEFAZ informa que o CT-e nº 40 está CANCELADO (101 - Cancelamento de CT-e homologado): a situação foi atualizada. 1 evento(s) que este sistema não tinha foram gravados.",
            eventos: [evento({ tipo: "110111", descricao: "Cancelamento (registrado fora deste sistema)", deFora: true })],
            novos: 1,
          },
        };
      },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="sefaz"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="sefaz"]')!);
    const dialogo = dialogoDe(tela);
    await ate(() => expect(dialogo.querySelector("[data-situacao-na-sefaz]")).not.toBeNull());
    expect(pedidos.filter((p) => p.method === "POST")).toEqual([{ url: "/api/fiscal/cte/emissao/cte1/situacao", method: "POST", body: undefined }]);
    expect(dialogo.querySelector('[data-situacao-na-sefaz="CANCELLED"]')!.textContent).toContain("está CANCELADO (101 - Cancelamento de CT-e homologado)");
    expect(dialogo.querySelector("[data-eventos]")!.textContent).toContain("Cancelamento nº 1");
    expect(dialogo.querySelector("[data-eventos]")!.textContent).toContain("registrado fora deste sistema");
    await ate(() => expect(tela.querySelector('tr[data-carga] [data-cte="CANCELLED"]')).not.toBeNull());
  });

  it("Conferir na SEFAZ: sem resposta, a tela diz que nada mudou", async () => {
    api({
      "/api/fiscal/cte": { body: [carga()] },
      "/api/fiscal/cte/situacao": PRONTA,
      "POST /api/fiscal/cte/emissao/cte1/situacao": { status: 504, body: { error: "A SEFAZ não respondeu no tempo limite. Nada mudou neste sistema: tente conferir de novo." } },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="sefaz"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="sefaz"]')!);
    const dialogo = dialogoDe(tela);
    await ate(() => expect(dialogo.querySelector('[role="alert"]')).not.toBeNull());
    expect(dialogo.querySelector('[role="alert"]')!.textContent).toContain("Nada mudou neste sistema");
    expect(dialogo.querySelector("[data-situacao-na-sefaz]")).toBeNull();
  });

  it("emitir pela SVC: só aparece quando a rota oferece; pede a justificativa de 15 letras e manda o pedido explícito", async () => {
    const semResposta = emitido({ situacao: "DRAFT", protocolo: null, autorizadoEm: null, semResposta: true, cStat: null, motivo: "A SEFAZ não respondeu no tempo limite." });
    const conferencia = (oferecida: boolean): ConferenciaDoCte => ({ pronta: true, pendencias: [], avisos: [], resumo: null, cte: semResposta, svc: { nome: "SVC-RS", oferecida } });
    let oferecida = false;
    const pedidos = api({
      "/api/fiscal/cte": { body: [carga({ emitido: semResposta })] },
      "/api/fiscal/cte/situacao": PRONTA,
      "/api/fiscal/cte/emissao?collectionId=c1": () => ({ body: conferencia(oferecida) }),
      "POST /api/fiscal/cte/emissao": (body) => ({ body: { cte: emitido({ numero: 41, svc: "SVC-RS" }), autorizado: true, mensagem: `CT-e nº 41 autorizado pela SVC-RS. Protocolo 135260000000031. ${body?.svc ? "" : "ERRO: sem svc"}` } }),
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="conferir"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="conferir"]')!);
    await ate(() => expect(dialogoDe(tela).querySelector("[data-emitir]")).not.toBeNull());
    await ate(() => expect(dialogoDe(tela).querySelector("[data-ultima-resposta]")).not.toBeNull());
    // Sem a oferta da rota, não há como pedir a SVC.
    expect(dialogoDe(tela).querySelector("[data-alternar-svc]")).toBeNull();
    await clicar(dialogoDe(tela).querySelector('button[aria-label="Fechar"]')!);

    oferecida = true;
    await clicar(tela.querySelector('[data-acao="conferir"]')!);
    const dialogo = dialogoDe(tela);
    await ate(() => expect(dialogo.querySelector("[data-alternar-svc]")).not.toBeNull());
    expect(dialogo.querySelector("[data-alternar-svc]")!.textContent).toBe("A SEFAZ não responde? Emitir pela SVC-RS (contingência)");
    // Enquanto a pessoa não pede, o botão é o da emissão normal.
    expect(dialogo.querySelector("[data-emitir-svc]")).toBeNull();
    await clicar(dialogo.querySelector("[data-alternar-svc]")!);
    const botao = dialogo.querySelector<HTMLButtonElement>("[data-emitir-svc]")!;
    expect(botao.textContent).toBe("Emitir pela SVC-RS");
    expect(botao.disabled).toBe(true);
    expect(dialogo.querySelector("[data-emitir]")).toBeNull();
    await digitar(dialogo.querySelector<HTMLTextAreaElement>("[data-svc] textarea")!, "curta");
    expect(botao.disabled).toBe(true);
    await digitar(dialogo.querySelector<HTMLTextAreaElement>("[data-svc] textarea")!, "SEFAZ de origem fora do ar desde as 14h");
    expect(botao.disabled).toBe(false);
    await clicar(botao);
    await ate(() => expect(dialogo.querySelector('[data-resultado="autorizado"]')).not.toBeNull());
    expect(pedidos.find((p) => p.method === "POST")).toMatchObject({ url: "/api/fiscal/cte/emissao", body: { collectionId: "c1", svc: { justificativa: "SEFAZ de origem fora do ar desde as 14h" } } });
    expect(dialogo.querySelector("[data-resultado]")!.textContent).toContain("CT-e nº 41 autorizado pela SVC-RS.");
  });

  it("o CT-e que ficou para resolver aparece na linha: o envio sem resposta com Conferir na SEFAZ, e o autorizado em dobro com Cancelar", async () => {
    const orfao = emitido({ id: "cte-orfao", numero: 39, situacao: "DRAFT", protocolo: null, autorizadoEm: null, semResposta: true });
    const emDobro = emitido({ id: "cte-dobro", numero: 38 });
    const pedidos = api({
      "/api/fiscal/cte": { body: [carga({ emitido: emitido({ svc: "SVC-RS" }), aResolver: [orfao, emDobro] })] },
      "/api/fiscal/cte/situacao": PRONTA,
      "POST /api/fiscal/cte/emissao/cte-orfao/situacao": { body: { cte: orfao, mensagem: 'A SEFAZ não tem o CT-e nº 39 (217 - Rejeição: CTe não consta na base de dados da SEFAZ). Ele continua "sem resposta".', eventos: [], novos: 0 } },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelectorAll("[data-a-resolver]")).toHaveLength(2));
    expect(tela.querySelector('[data-a-resolver="cte-orfao"]')!.textContent).toBe("O envio anterior (nº 39) ficou sem resposta. Conferir na SEFAZ");
    expect(tela.querySelector('[data-a-resolver="cte-dobro"]')!.textContent).toBe("O CT-e nº 38 também foi autorizado: cancele-o. Cancelar o nº 38");

    await clicar(tela.querySelector('[data-acao="conferir-outro"]')!);
    await ate(() => expect(dialogoDe(tela).querySelector("[data-situacao-na-sefaz]")).not.toBeNull());
    expect(dialogoDe(tela).querySelector("h2")!.textContent).toBe("CT-e nº 39 na SEFAZ");
    expect(pedidos.find((p) => p.method === "POST")!.url).toBe("/api/fiscal/cte/emissao/cte-orfao/situacao");
    await clicar(dialogoDe(tela).querySelector('button[aria-label="Fechar"]')!);

    // O cancelamento aberto por aqui é o do CT-e em dobro, não o da linha.
    await clicar(tela.querySelector('[data-acao="cancelar-outro"]')!);
    expect(dialogoDe(tela).querySelector("h2")!.textContent).toBe("Cancelar CT-e nº 38");
  });
});

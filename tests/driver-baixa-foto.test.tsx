// @vitest-environment jsdom
import { Suspense, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHOTO_MESSAGE, PHOTO_TOO_BIG } from "../src/lib/comprovantes";
import { FILA_INDISPONIVEL } from "../src/lib/offline-queue";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

/**
 * Telas do motorista ligadas ao comprovante: a baixa (quem recebeu, fotos por
 * tipo, ressalva, o que o perfil da empresa exige), a tentativa de entrega sem
 * sucesso e a lista "Comprovantes para refazer" da tela inicial.
 *
 * A redução da foto (`canvas`) não existe no jsdom: `reduzirFoto` é trocada
 * por uma função que o teste comanda. A conta das dimensões e a regra de cada
 * coisa estão em `tests/comprovante-padrao.test.ts`.
 */

const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
const foto = vi.hoisted(() => ({ reduzir: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navegacao }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "user-ana" } }, status: "authenticated" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock("../src/lib/foto", async (original) => ({ ...(await original<typeof import("../src/lib/foto")>()), reduzirFoto: foto.reduzir }));

import DeliveryProofPage from "../src/app/driver/entregas/[id]/baixa/page";
import InsucessoDoMotorista from "../src/app/driver/entregas/[id]/insucesso/page";
import OcorrenciaDoMotorista from "../src/app/driver/entregas/[id]/ocorrencia/page";
import RefazerComprovante from "../src/app/driver/entregas/[id]/refazer/page";
import DriverHome from "../src/app/driver/page";
import { FotoRecusada } from "../src/lib/foto";
import { lembrarPerfil } from "../src/lib/comprovantes-motorista";

const FOTO_1 = "data:image/jpeg;base64,/9j/AAAA";
const FOTO_2 = "data:image/jpeg;base64,/9j/BBBB";

type Pedido = { url: string; method: string; body: Record<string, unknown> | null };

/** Servidor de mentira: responde por caminho e guarda o que a tela mandou. */
function servidor(respostas: Record<string, { status?: number; body: unknown } | Error>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const caminho = String(url);
      pedidos.push({ url: caminho, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const resposta = respostas[caminho];
      if (!resposta) throw new Error(`Chamada inesperada: ${caminho}`);
      if (resposta instanceof Error) throw resposta;
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
  return pedidos;
}

const PERFIL = (perfil: string, refazer: unknown[] = []) => ({ "/api/driver/comprovantes": { body: { perfil, refazer } } });

async function abrir(Pagina: (props: { params: Promise<{ id: string }> }) => React.ReactNode, espera: string) {
  const params = Promise.resolve({ id: "coleta-1" });
  const tela = await montar(
    <Suspense fallback="carregando">
      <Pagina params={params} />
    </Suspense>,
  );
  await ate(() => expect(tela.querySelector(espera)).not.toBeNull());
  return tela;
}

/** Digita num campo controlado pelo React. */
async function digitar(campo: Element | null, valor: string) {
  if (!campo) throw new Error("Campo não encontrado");
  const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** O motorista tira a foto no cartão do tipo. */
async function fotografar(tela: HTMLElement, tipo: string) {
  const input = tela.querySelector(`[data-cartao-de-foto="${tipo}"] input[type="file"]`) as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" })] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const cartao = (tela: HTMLElement, tipo: string) => tela.querySelector(`[data-cartao-de-foto="${tipo}"]`) as HTMLElement | null;
const miniaturas = (tela: HTMLElement, tipo: string) => [...(cartao(tela, tipo)?.querySelectorAll("img") ?? [])].map((img) => img.getAttribute("src"));
const final = (tela: HTMLElement, seletor = "[data-finalizar]") => tela.querySelector(seletor) as HTMLButtonElement;
const alertas = (tela: HTMLElement) => [...tela.querySelectorAll('[role="alert"]')].map((no) => no.textContent);
const enviados = (pedidos: Pedido[], trecho: string) => pedidos.filter((pedido) => pedido.method === "POST" && pedido.url.includes(trecho));

async function preencherQuemRecebeu(tela: HTMLElement) {
  await clicar(tela.querySelector('[data-relacao="PORTARIA"]')!);
  await digitar(tela.querySelector("#receiverName"), "João Porteiro");
  await digitar(tela.querySelector("#receiverDoc"), "12345678900");
}

beforeEach(() => {
  navegacao.push.mockReset();
  navegacao.back.mockReset();
  foto.reduzir.mockReset();
  foto.reduzir.mockResolvedValue(FOTO_1);
  localStorage.clear();
  lembrarPerfil("LIVRE");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

describe("tela de baixa: blocos e o que falta", () => {
  it("abre com quem recebeu em botões, nome e documento, os cartões de foto, e ressalva e assinatura recolhidas", async () => {
    servidor(PERFIL("LIVRE"));
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");

    expect([...tela.querySelectorAll("[data-relacao]")].map((botao) => botao.textContent)).toEqual(["Destinatário", "Funcionário", "Portaria", "Familiar", "Vizinho", "Outro"]);
    expect(tela.querySelector("select")).toBeNull();
    expect(cartao(tela, "ENTREGA")?.textContent).toContain("Foto da entrega");
    expect(cartao(tela, "CANHOTO")?.textContent).toContain("Foto do canhoto");
    expect(cartao(tela, "AVARIA")).toBeNull();
    expect(tela.querySelector("[data-abrir-ressalva]")?.textContent).toContain("Entrega com ressalva");
    expect(tela.querySelector("[data-abrir-assinatura]")?.textContent).toContain("Colher assinatura na tela");
    expect(tela.querySelector("canvas")).toBeNull();
    // A câmera traseira, em cada cartão.
    for (const input of tela.querySelectorAll('input[type="file"]')) expect(input.getAttribute("capture")).toBe("environment");

    // O botão final diz o que falta, e não fica desligado.
    expect(final(tela).textContent).toBe("Falta quem recebeu, o nome e o documento");
    expect(final(tela).disabled).toBe(false);
  });

  it("perfil LIVRE: com quem recebeu, nome e documento já dá para finalizar, sem foto; o envio vai no formato novo", async () => {
    const pedidos = servidor({ ...PERFIL("LIVRE"), "/api/driver/entregas/coleta-1/baixa": { body: { success: true } } });
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    await preencherQuemRecebeu(tela);
    expect(final(tela).textContent).toBe("Finalizar entrega");

    await clicar(final(tela));
    await ate(() => expect(navegacao.push).toHaveBeenCalledWith("/driver"));
    expect(enviados(pedidos, "/baixa").map((pedido) => pedido.body)).toEqual([
      { receiverName: "João Porteiro", receiverDoc: "12345678900", receiverRelation: "PORTARIA", photos: [], signatureBase64: "", exception: null, latitude: null, longitude: null },
    ]);
  });

  it("perfil B2B: o canhoto aparece como obrigatório, o botão diz que falta, e tocar nele não envia", async () => {
    const pedidos = servidor({ ...PERFIL("B2B"), "/api/driver/entregas/coleta-1/baixa": { body: { success: true } } });
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    await ate(() => expect(tela.querySelector('[data-perfil="B2B"]')).not.toBeNull());
    expect(cartao(tela, "CANHOTO")?.textContent).toContain("Obrigatória");
    expect(cartao(tela, "ENTREGA")?.textContent).not.toContain("Obrigatória");

    await preencherQuemRecebeu(tela);
    expect(final(tela).textContent).toBe("Falta a foto do canhoto assinado");
    await clicar(final(tela));
    expect(alertas(tela)).toEqual(["Falta a foto do canhoto assinado."]);
    expect(enviados(pedidos, "/baixa")).toEqual([]);

    await fotografar(tela, "CANHOTO");
    await ate(() => expect(miniaturas(tela, "CANHOTO")).toEqual([FOTO_1]));
    expect(final(tela).textContent).toBe("Finalizar entrega");
    await clicar(final(tela));
    await ate(() => expect(enviados(pedidos, "/baixa")).toHaveLength(1));
    expect(enviados(pedidos, "/baixa")[0].body?.photos).toEqual([{ kind: "CANHOTO", dataUrl: FOTO_1 }]);
  });

  it("perfil ECOMMERCE lembrado no aparelho: vale mesmo sem resposta do servidor (sem sinal)", async () => {
    lembrarPerfil("ECOMMERCE");
    servidor({ "/api/driver/comprovantes": new Error("sem rede") });
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    expect(cartao(tela, "ENTREGA")?.textContent).toContain("Obrigatória");
    await preencherQuemRecebeu(tela);
    expect(final(tela).textContent).toBe("Falta a foto da entrega");
  });
});

describe("tela de baixa: fotos", () => {
  it("a foto reduzida vira miniatura, com trocar e remover; cabe uma segunda do mesmo tipo e não uma terceira", async () => {
    servidor(PERFIL("LIVRE"));
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");

    await fotografar(tela, "ENTREGA");
    await ate(() => expect(miniaturas(tela, "ENTREGA")).toEqual([FOTO_1]));
    expect(foto.reduzir).toHaveBeenCalledTimes(1);
    expect(porTexto(cartao(tela, "ENTREGA")!, "button", "Trocar")).toHaveLength(1);
    expect(porTexto(cartao(tela, "ENTREGA")!, "button", "Remover")).toHaveLength(1);

    // Trocar substitui a mesma posição.
    foto.reduzir.mockResolvedValue(FOTO_2);
    await clicar(porTexto(cartao(tela, "ENTREGA")!, "button", "Trocar")[0]);
    await fotografar(tela, "ENTREGA");
    await ate(() => expect(miniaturas(tela, "ENTREGA")).toEqual([FOTO_2]));

    // Outra foto do mesmo tipo: até duas.
    foto.reduzir.mockResolvedValue(FOTO_1);
    await clicar(porTexto(cartao(tela, "ENTREGA")!, "button", "Outra foto")[0]);
    await fotografar(tela, "ENTREGA");
    await ate(() => expect(miniaturas(tela, "ENTREGA")).toEqual([FOTO_2, FOTO_1]));
    expect(porTexto(cartao(tela, "ENTREGA")!, "button", "Outra foto")).toHaveLength(0);

    await clicar(porTexto(cartao(tela, "ENTREGA")!, "button", "Remover")[0]);
    expect(miniaturas(tela, "ENTREGA")).toEqual([FOTO_1]);
  });

  it("foto que o navegador não abre (HEIC sem suporte): avisa com a mensagem do formato e não guarda nada", async () => {
    servidor(PERFIL("LIVRE"));
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    foto.reduzir.mockRejectedValue(new FotoRecusada(PHOTO_MESSAGE));

    await fotografar(tela, "CANHOTO");
    await ate(() => expect(alertas(tela)).toEqual([PHOTO_MESSAGE]));
    expect(miniaturas(tela, "CANHOTO")).toEqual([]);
  });

  it("foto recusada na troca não apaga a que já estava boa; a seguinte, boa, limpa o aviso", async () => {
    servidor(PERFIL("LIVRE"));
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    await fotografar(tela, "CANHOTO");
    await ate(() => expect(miniaturas(tela, "CANHOTO")).toEqual([FOTO_1]));

    foto.reduzir.mockRejectedValue(new FotoRecusada(PHOTO_TOO_BIG));
    await clicar(porTexto(cartao(tela, "CANHOTO")!, "button", "Trocar")[0]);
    await fotografar(tela, "CANHOTO");
    await ate(() => expect(alertas(tela)).toEqual([PHOTO_TOO_BIG]));
    expect(miniaturas(tela, "CANHOTO")).toEqual([FOTO_1]);

    foto.reduzir.mockResolvedValue(FOTO_2);
    await clicar(porTexto(cartao(tela, "CANHOTO")!, "button", "Trocar")[0]);
    await fotografar(tela, "CANHOTO");
    await ate(() => expect(miniaturas(tela, "CANHOTO")).toEqual([FOTO_2]));
    expect(alertas(tela)).toEqual([]);
  });

  it("sem arquivo escolhido (câmera cancelada) nada muda", async () => {
    servidor(PERFIL("LIVRE"));
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    const input = cartao(tela, "ENTREGA")!.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(foto.reduzir).not.toHaveBeenCalled();
    expect(miniaturas(tela, "ENTREGA")).toEqual([]);
    expect(alertas(tela)).toEqual([]);
  });
});

describe("tela de baixa: ressalva e fila offline", () => {
  it("a ressalva abre atrás do botão; avaria pede a foto da avaria ('+ Avaria' só aparece com a ressalva); tirar a ressalva tira a foto", async () => {
    const pedidos = servidor({ ...PERFIL("LIVRE"), "/api/driver/entregas/coleta-1/baixa": { body: { success: true } } });
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    await preencherQuemRecebeu(tela);

    await clicar(tela.querySelector("[data-abrir-ressalva]")!);
    expect(cartao(tela, "AVARIA")?.textContent).toContain("+ Avaria");
    expect(final(tela).textContent).toBe("Falta o tipo da ressalva e a descrição da ressalva");

    await clicar(tela.querySelector('[data-ressalva-tipo="AVARIA"]')!);
    await digitar(tela.querySelector('textarea[aria-label="Descrição da ressalva"]'), "Caixa amassada no canto.");
    expect(final(tela).textContent).toBe("Falta a foto da avaria");
    expect(cartao(tela, "AVARIA")?.textContent).toContain("Obrigatória");

    // Falta de volume não tem o que fotografar.
    await clicar(tela.querySelector('[data-ressalva-tipo="FALTA"]')!);
    expect(final(tela).textContent).toBe("Finalizar entrega");
    await clicar(tela.querySelector('[data-ressalva-tipo="AVARIA"]')!);

    await fotografar(tela, "AVARIA");
    await ate(() => expect(miniaturas(tela, "AVARIA")).toEqual([FOTO_1]));
    expect(final(tela).textContent).toBe("Finalizar entrega");

    await clicar(final(tela));
    await ate(() => expect(enviados(pedidos, "/baixa")).toHaveLength(1));
    expect(enviados(pedidos, "/baixa")[0].body).toMatchObject({
      photos: [{ kind: "AVARIA", dataUrl: FOTO_1 }],
      exception: { type: "AVARIA", note: "Caixa amassada no canto." },
    });
  });

  it("tirar a ressalva remove a foto da avaria do envio", async () => {
    const pedidos = servidor({ ...PERFIL("LIVRE"), "/api/driver/entregas/coleta-1/baixa": { body: { success: true } } });
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    await preencherQuemRecebeu(tela);
    await clicar(tela.querySelector("[data-abrir-ressalva]")!);
    await fotografar(tela, "AVARIA");
    await ate(() => expect(miniaturas(tela, "AVARIA")).toEqual([FOTO_1]));

    await clicar(porTexto(tela, "button", "Tirar ressalva")[0]);
    expect(cartao(tela, "AVARIA")).toBeNull();
    await clicar(final(tela));
    await ate(() => expect(enviados(pedidos, "/baixa")).toHaveLength(1));
    expect(enviados(pedidos, "/baixa")[0].body).toMatchObject({ photos: [], exception: null });
  });

  it("a assinatura abre atrás do botão e continua opcional", async () => {
    servidor(PERFIL("B2B"));
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    await clicar(tela.querySelector("[data-abrir-assinatura]")!);
    expect(tela.querySelector("canvas")).not.toBeNull();
    expect(tela.textContent).toContain("Assinatura na tela (opcional)");
    expect(final(tela).textContent).not.toContain("assinatura");
    await clicar(porTexto(tela, "button", "Sem assinatura")[0]);
    expect(tela.querySelector("canvas")).toBeNull();
  });

  it("recusa do servidor (falta o canhoto) aparece na tela, que continua preenchida", async () => {
    servidor({ ...PERFIL("LIVRE"), "/api/driver/entregas/coleta-1/baixa": { status: 400, body: { error: "Falta a foto do canhoto assinado." } } });
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    await preencherQuemRecebeu(tela);
    await clicar(final(tela));
    await ate(() => expect(alertas(tela)).toEqual(["Falta a foto do canhoto assinado."]));
    expect(navegacao.push).not.toHaveBeenCalled();
    expect((tela.querySelector("#receiverName") as HTMLInputElement).value).toBe("João Porteiro");
  });

  it("sem sinal e sem conseguir guardar no aparelho: avisa que a baixa NÃO foi salva e não sai da tela", async () => {
    // O jsdom não tem IndexedDB: é a fila que não consegue guardar.
    const pedidos = servidor(PERFIL("LIVRE"));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const tela = await abrir(DeliveryProofPage, "[data-finalizar]");
    await preencherQuemRecebeu(tela);
    await fotografar(tela, "ENTREGA");
    await ate(() => expect(miniaturas(tela, "ENTREGA")).toEqual([FOTO_1]));

    await clicar(final(tela));
    await ate(() => expect(alertas(tela)).toEqual([FILA_INDISPONIVEL]));
    expect(FILA_INDISPONIVEL).toContain("NÃO foi salva");
    expect(navegacao.push).not.toHaveBeenCalled();
    expect(enviados(pedidos, "/baixa")).toEqual([]);
    // O que ele colheu continua na tela.
    expect(miniaturas(tela, "ENTREGA")).toEqual([FOTO_1]);
    expect(final(tela).disabled).toBe(false);
  });
});

describe("tela de tentativa de entrega sem sucesso", () => {
  const ROTA = "/api/driver/entregas/coleta-1/ocorrencia";

  it("abre em 'Não entreguei' com os motivos padronizados; a ocorrência comum fica na outra aba", async () => {
    servidor(PERFIL("LIVRE"));
    const tela = await abrir(InsucessoDoMotorista, "[data-registrar]");
    expect(tela.querySelector('[data-modo="insucesso"]')?.getAttribute("aria-selected")).toBe("true");
    expect([...tela.querySelectorAll("[data-motivo]")].map((botao) => botao.textContent)).toEqual([
      "Ausente",
      "Endereço não localizado",
      "Recusou receber",
      "Estabelecimento fechado",
      "Mudou-se",
      "Área de risco",
      "Outro",
    ]);
    expect(cartao(tela, "FACHADA")?.textContent).toContain("Foto da fachada");
    expect(final(tela, "[data-registrar]").textContent).toBe("Falta o motivo");

    await clicar(tela.querySelector('[data-modo="ocorrencia"]')!);
    expect(tela.querySelectorAll("[data-tipo]")).toHaveLength(6);
    expect(cartao(tela, "FACHADA")).toBeNull();
  });

  it("perfil LIVRE: motivo basta; envia motivo, observação, chave da tentativa e mostra o contador", async () => {
    const pedidos = servidor({ ...PERFIL("LIVRE"), [ROTA]: { status: 201, body: { success: true, number: 12, attempts: 2 } } });
    const tela = await abrir(InsucessoDoMotorista, "[data-registrar]");
    await clicar(tela.querySelector('[data-motivo="AUSENTE"]')!);
    await digitar(tela.querySelector('[data-campo="note"]'), "Vizinho disse que volta às 18h.");
    expect(final(tela, "[data-registrar]").textContent).toBe("Registrar tentativa sem sucesso");

    await clicar(final(tela, "[data-registrar]"));
    await ate(() => expect(tela.querySelector('[role="status"]')?.textContent).toContain("Tentativa registrada (chamado nº 12)"));
    expect(tela.querySelector('[role="status"]')?.textContent).toContain("2 tentativas sem sucesso");
    expect(tela.querySelector('[role="status"]')?.textContent).toContain("continua na sua viagem");

    const [envio] = enviados(pedidos, "/ocorrencia");
    expect(envio.body).toMatchObject({ reason: "AUSENTE", note: "Vizinho disse que volta às 18h.", photos: [], latitude: null, longitude: null });
    expect(typeof envio.body?.key).toBe("string");
    expect(String(envio.body?.key).length).toBeGreaterThan(8);
  });

  it("perfil ECOMMERCE: a foto da fachada é obrigatória; 'Outro' pede a descrição", async () => {
    const pedidos = servidor({ ...PERFIL("ECOMMERCE"), [ROTA]: { status: 201, body: { success: true, number: 3, attempts: 1 } } });
    const tela = await abrir(InsucessoDoMotorista, "[data-registrar]");
    await ate(() => expect(cartao(tela, "FACHADA")?.textContent).toContain("Obrigatória"));

    await clicar(tela.querySelector('[data-motivo="OUTRO"]')!);
    expect(final(tela, "[data-registrar]").textContent).toBe("Falta a descrição e a foto da fachada");
    await clicar(final(tela, "[data-registrar]"));
    expect(alertas(tela)).toEqual(["Falta a descrição e a foto da fachada."]);
    expect(enviados(pedidos, "/ocorrencia")).toEqual([]);

    await digitar(tela.querySelector('[data-campo="note"]'), "Rua interditada pela prefeitura.");
    await fotografar(tela, "FACHADA");
    await ate(() => expect(miniaturas(tela, "FACHADA")).toEqual([FOTO_1]));
    await clicar(final(tela, "[data-registrar]"));
    await ate(() => expect(enviados(pedidos, "/ocorrencia")).toHaveLength(1));
    expect(enviados(pedidos, "/ocorrencia")[0].body).toMatchObject({ reason: "OUTRO", photos: [{ kind: "FACHADA", dataUrl: FOTO_1 }] });
  });

  it("tentar de novo depois de uma falha manda a mesma chave, para o servidor não gravar duas", async () => {
    const respostas: Record<string, { status?: number; body: unknown } | Error> = { ...PERFIL("LIVRE"), [ROTA]: new Error("sem rede") };
    const pedidos = servidor(respostas);
    const tela = await abrir(InsucessoDoMotorista, "[data-registrar]");
    await clicar(tela.querySelector('[data-motivo="FECHADO"]')!);

    await clicar(final(tela, "[data-registrar]"));
    await ate(() => expect(alertas(tela)).toHaveLength(1));
    respostas[ROTA] = { status: 201, body: { success: true, number: 1, attempts: 1 } };
    await clicar(final(tela, "[data-registrar]"));
    await ate(() => expect(tela.querySelector('[role="status"]')).not.toBeNull());

    const chaves = enviados(pedidos, "/ocorrencia").map((pedido) => pedido.body?.key);
    expect(chaves).toHaveLength(2);
    expect(chaves[0]).toBe(chaves[1]);
  });

  it("a tela de ocorrência abre na ocorrência comum e envia o corpo de sempre", async () => {
    const pedidos = servidor({ ...PERFIL("LIVRE"), [ROTA]: { status: 201, body: { success: true, id: "o1", number: 7 } } });
    const tela = await abrir(OcorrenciaDoMotorista, "[data-registrar]");
    expect(tela.querySelector('[data-modo="ocorrencia"]')?.getAttribute("aria-selected")).toBe("true");
    await clicar(tela.querySelector('[data-tipo="DAMAGE"]')!);
    await digitar(tela.querySelector('[data-campo="description"]'), "Caixa chegou amassada.");
    await clicar(final(tela, "[data-registrar]"));
    await ate(() => expect(tela.querySelector('[role="status"]')?.textContent).toContain("Ocorrência registrada (chamado nº 7)"));
    expect(enviados(pedidos, "/ocorrencia")[0].body).toEqual({ type: "DAMAGE", description: "Caixa chegou amassada." });
  });
});

describe("comprovantes para refazer", () => {
  const DEVOLVIDO = {
    collectionId: "coleta-1",
    receiver: "Loja Centro",
    destination: "Ribeirão Preto - SP",
    receiverName: "Maria Souza",
    receiverDoc: "12345678900",
    exceptionType: null,
    rejectionId: "dev-1",
    reason: "Canhoto ilegível: tire outra foto, de perto.",
    rejectedAt: "2026-10-08T15:30:00.000Z",
  };

  it("a tela inicial lista os devolvidos com o motivo e o atalho para refazer; sem nenhum, a lista não aparece", async () => {
    servidor({ "/api/driver/manifestos": { body: [] }, ...PERFIL("LIVRE", [DEVOLVIDO]) });
    const tela = await montar(<DriverHome />);
    await ate(() => expect(tela.querySelector("[data-comprovantes-para-refazer]")).not.toBeNull());
    const lista = tela.querySelector("[data-comprovantes-para-refazer]")!;
    expect(lista.textContent).toContain("Comprovantes para refazer (1)");
    expect(lista.textContent).toContain("Loja Centro");
    expect(lista.textContent).toContain("Canhoto ilegível: tire outra foto, de perto.");
    expect(lista.querySelector("a")?.getAttribute("href")).toBe("/driver/entregas/coleta-1/refazer");

    await desmontarTudo();
    servidor({ "/api/driver/manifestos": { body: [] }, ...PERFIL("LIVRE") });
    const vazia = await montar(<DriverHome />);
    await ate(() => expect(vazia.textContent).toContain("Nenhuma viagem atribuída"));
    expect(vazia.querySelector("[data-comprovantes-para-refazer]")).toBeNull();
  });

  it("refazer: mostra o motivo, exige foto nova (e a do perfil), e envia respondendo à devolução", async () => {
    const pedidos = servidor({ ...PERFIL("B2B", [DEVOLVIDO]), "/api/driver/entregas/coleta-1/refazer": { body: { success: true } } });
    const tela = await abrir(RefazerComprovante, "[data-enviar]");
    expect(tela.querySelector("[data-motivo]")?.textContent).toContain("Canhoto ilegível: tire outra foto, de perto.");
    expect((tela.querySelector('[data-campo="receiverName"]') as HTMLInputElement).value).toBe("Maria Souza");
    expect(final(tela, "[data-enviar]").textContent).toBe("Falta pelo menos uma foto nova e a foto do canhoto assinado");
    await clicar(final(tela, "[data-enviar]"));
    expect(enviados(pedidos, "/refazer")).toEqual([]);

    await fotografar(tela, "CANHOTO");
    await ate(() => expect(miniaturas(tela, "CANHOTO")).toEqual([FOTO_1]));
    expect(final(tela, "[data-enviar]").textContent).toBe("Enviar fotos novas");
    await clicar(final(tela, "[data-enviar]"));
    await ate(() => expect(tela.querySelector('[role="status"]')?.textContent).toContain("Fotos novas enviadas"));
    expect(enviados(pedidos, "/refazer").map((pedido) => pedido.body)).toEqual([
      { rejectionId: "dev-1", photos: [{ kind: "CANHOTO", dataUrl: FOTO_1 }], receiverName: "Maria Souza", receiverDoc: "12345678900" },
    ]);
  });

  it("comprovante que não está na lista do motorista: a tela diz isso, sem formulário", async () => {
    servidor(PERFIL("LIVRE"));
    const tela = await abrir(RefazerComprovante, '[role="status"]');
    await ate(() => expect(tela.textContent).toContain("Este comprovante não está na sua lista para refazer."));
    expect(tela.querySelector("form")).toBeNull();
  });
});

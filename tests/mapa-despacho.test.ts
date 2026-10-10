import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O despachante (`iniciarDespacho`) com a localização de endereços: ela corre à
 * parte e nem a falha nem a demora do serviço de fora seguram o resto (eventos,
 * conferência de cobranças e push). Sem banco: o que o despachante chama é
 * trocado por registros.
 */

const chamadas = vi.hoisted(() => ({
  localizar: vi.fn(),
  push: vi.fn(async () => 0),
  conferir: vi.fn(async () => 0),
  lote: vi.fn(async () => [] as unknown[]),
  vencidos: vi.fn(async () => 0),
  mdfesEmAberto: vi.fn(async () => 0),
}));

vi.mock("../src/lib/geo-db", () => ({ localizarEnderecosPendentes: chamadas.localizar }));
vi.mock("../src/lib/notificacoes-push", () => ({ enviarPushPendentes: chamadas.push }));
vi.mock("../src/lib/cobranca-gateway-db", () => ({ conferirCobrancasEmAberto: chamadas.conferir }));
// O aviso de MDF-e autorizado e não encerrado roda na mesma cadência da varredura (src/lib/mdfe-db.ts).
vi.mock("../src/lib/mdfe-db", () => ({ avisarMdfesEmAberto: chamadas.mdfesEmAberto }));
vi.mock("../src/lib/prisma", () => ({ sistema: { $queryRaw: chamadas.lote, $executeRaw: chamadas.vencidos } }));

const VOLTA_MS = 15_000;
const global = globalThis as { tmsDespachante?: ReturnType<typeof setInterval> };

describe("despachante: a localização de endereços não derruba o resto", () => {
  let erros: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    for (const chamada of Object.values(chamadas)) chamada.mockClear();
    erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (global.tmsDespachante) clearInterval(global.tmsDespachante);
    delete global.tmsDespachante;
    erros.mockRestore();
    vi.useRealTimers();
    vi.resetModules();
  });

  const ligar = async () => {
    const { iniciarDespacho } = await import("../src/lib/eventos");
    iniciarDespacho();
  };

  it("a cada volta roda eventos, cobranças, push e a localização", async () => {
    chamadas.localizar.mockResolvedValue({ localizadas: 1, semResultado: 0, consultas: 1, erro: null });
    await ligar();
    await vi.advanceTimersByTimeAsync(VOLTA_MS);
    expect(chamadas.localizar).toHaveBeenCalledTimes(1);
    expect(chamadas.vencidos).toHaveBeenCalledTimes(1);
    expect(chamadas.lote).toHaveBeenCalledTimes(1);
    expect(chamadas.conferir).toHaveBeenCalledTimes(1);
    expect(chamadas.mdfesEmAberto).toHaveBeenCalledTimes(1);
    expect(chamadas.push).toHaveBeenCalledTimes(1);
    expect(erros).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(VOLTA_MS);
    expect(chamadas.localizar).toHaveBeenCalledTimes(2);
    expect(chamadas.push).toHaveBeenCalledTimes(2);
  });

  it("a localização quebrando (banco, erro inesperado) é registrada e o resto segue", async () => {
    chamadas.localizar.mockRejectedValue(new Error("caiu"));
    await ligar();
    await vi.advanceTimersByTimeAsync(VOLTA_MS * 2);
    expect(chamadas.localizar).toHaveBeenCalledTimes(2);
    expect(chamadas.lote).toHaveBeenCalledTimes(2);
    expect(chamadas.push).toHaveBeenCalledTimes(2);
    expect(erros).toHaveBeenCalledWith("Erro ao localizar endereços de entrega:", "caiu");
  });

  it("o serviço de localização fora do ar é avisado no registro, sem parar nada", async () => {
    chamadas.localizar.mockResolvedValue({ localizadas: 0, semResultado: 0, consultas: 0, erro: "Resposta 503" });
    await ligar();
    await vi.advanceTimersByTimeAsync(VOLTA_MS);
    expect(erros).toHaveBeenCalledWith("Localização de endereços em pausa por 10 minutos:", "Resposta 503");
    expect(chamadas.push).toHaveBeenCalledTimes(1);
  });

  it("a localização demorando não segura eventos nem push, e não é disparada em dobro", async () => {
    // Nunca responde.
    chamadas.localizar.mockReturnValue(new Promise(() => undefined));
    await ligar();
    await vi.advanceTimersByTimeAsync(VOLTA_MS * 3);
    expect(chamadas.localizar).toHaveBeenCalledTimes(1);
    expect(chamadas.lote).toHaveBeenCalledTimes(3);
    expect(chamadas.push).toHaveBeenCalledTimes(3);
  });

  it("o resto quebrando também não impede a localização", async () => {
    chamadas.localizar.mockResolvedValue({ localizadas: 0, semResultado: 0, consultas: 0, erro: null });
    chamadas.lote.mockRejectedValueOnce(new Error("banco fora"));
    chamadas.push.mockRejectedValueOnce(new Error("push fora"));
    await ligar();
    await vi.advanceTimersByTimeAsync(VOLTA_MS * 2);
    expect(chamadas.localizar).toHaveBeenCalledTimes(2);
    expect(chamadas.push).toHaveBeenCalledTimes(2);
  });
});

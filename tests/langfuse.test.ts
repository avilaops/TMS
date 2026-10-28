import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const end = vi.fn();
  const update = vi.fn(() => ({ end }));
  return {
    end, update,
    observation: vi.fn(() => ({ update })),
    flush: vi.fn<() => Promise<void>>(async () => undefined),
    start: vi.fn(),
    shutdown: vi.fn(async () => undefined),
    processor: vi.fn(),
  };
});
vi.mock("@langfuse/tracing", () => ({ startObservation: mocks.observation }));
vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: vi.fn(function (options: unknown) {
    mocks.processor(options);
    return { forceFlush: mocks.flush };
  }),
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: vi.fn(function () { return { start: mocks.start, shutdown: mocks.shutdown }; }),
}));

let listeners: ReturnType<typeof process.listeners>;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.flush.mockResolvedValue(undefined);
  mocks.start.mockImplementation(() => undefined);
  listeners = process.listeners("beforeExit");
  vi.stubEnv("LANGFUSE_ENABLED", "true");
  vi.stubEnv("LANGFUSE_PUBLIC_KEY", "public-fixture");
  vi.stubEnv("LANGFUSE_SECRET_KEY", "secret-fixture");
  vi.stubEnv("LANGFUSE_BASE_URL", "https://langfuse.example.test");
});
afterEach(() => {
  for (const listener of process.listeners("beforeExit")) {
    if (!listeners.includes(listener)) process.removeListener("beforeExit", listener);
  }
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("observabilidade fiscal opcional", () => {
  it.each(["LANGFUSE_ENABLED", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"])("fica desligada sem %s", async (variavel) => {
    vi.stubEnv(variavel, "");
    const { observarFerramentaFiscal } = await import("../src/lib/langfuse");
    const executar = vi.fn(async () => "resultado");
    expect(await observarFerramentaFiscal("gerar_danfe", executar)).toBe("resultado");
    expect(executar).toHaveBeenCalledTimes(1);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.observation).not.toHaveBeenCalled();
  });

  it("exporta somente nome e estado fixos; preserva o resultado", async () => {
    const { observarFerramentaFiscal } = await import("../src/lib/langfuse");
    const resultado = { xml: "conteudo-confidencial", pdf_base64: "pdf-confidencial" };
    expect(await observarFerramentaFiscal("gerar_dacte", async () => resultado)).toBe(resultado);
    expect(mocks.observation).toHaveBeenCalledWith("tms.fiscal.gerar_dacte", {
      metadata: { application: "tms", tool: "fiscal_gerar_dacte" },
    }, { asType: "tool" });
    expect(mocks.update).toHaveBeenCalledWith({ level: "DEFAULT", statusMessage: "Fiscal tool completed" });
    expect(JSON.stringify([mocks.observation.mock.calls, mocks.update.mock.calls])).not.toContain("confidencial");
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    const options = mocks.processor.mock.calls[0][0] as {
      shouldExportSpan: (params: { otelSpan: { name: string } }) => boolean;
    };
    expect(options.shouldExportSpan({ otelSpan: { name: "http.request" } })).toBe(false);
    expect(options.shouldExportSpan({ otelSpan: { name: "tms.fiscal.gerar_dacte" } })).toBe(true);
  });

  it("preserva a exceção sem capturar sua mensagem", async () => {
    const { observarFerramentaFiscal } = await import("../src/lib/langfuse");
    const erro = new Error("XML e token confidenciais");
    const executar = vi.fn(async () => { throw erro; });
    await expect(observarFerramentaFiscal("gerar_damdfe", executar)).rejects.toBe(erro);
    expect(executar).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({ level: "ERROR", statusMessage: "Fiscal tool failed" });
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain("confidenciais");
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it("reconhece isError do protocolo sem copiar conteúdo", async () => {
    const { observarFerramentaFiscal } = await import("../src/lib/langfuse");
    const resposta = { isError: true, content: [{ text: "confidencial" }] };
    expect(await observarFerramentaFiscal("gerar_danfe", async () => resposta)).toBe(resposta);
    expect(mocks.update).toHaveBeenCalledWith({ level: "ERROR", statusMessage: "Fiscal tool failed" });
  });

  it("falhas de início ou exportação não repetem a ferramenta", async () => {
    mocks.start.mockImplementation(() => { throw new Error("indisponivel"); });
    const { observarFerramentaFiscal } = await import("../src/lib/langfuse");
    const executar = vi.fn(async () => "ok");
    expect(await observarFerramentaFiscal("gerar_danfe", executar)).toBe("ok");
    expect(executar).toHaveBeenCalledTimes(1);
    expect(mocks.observation).not.toHaveBeenCalled();
  });

  it("limita a espera pelo exportador e inicializa uma única vez", async () => {
    vi.useFakeTimers();
    mocks.flush.mockImplementation(() => new Promise(() => undefined));
    const { iniciarLangfuse, observarFerramentaFiscal } = await import("../src/lib/langfuse");
    await Promise.all([iniciarLangfuse(), iniciarLangfuse()]);
    const operacao = observarFerramentaFiscal("gerar_danfe", async () => "ok");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await operacao).toBe("ok");
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});

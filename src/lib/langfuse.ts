/** Observabilidade fiscal opcional; nenhum conteúdo fiscal entra no SDK. */
type FerramentaFiscal = "gerar_danfe" | "gerar_dacte" | "gerar_damdfe";
type Runtime = {
  startObservation: typeof import("@langfuse/tracing").startObservation;
  flush: () => Promise<void>;
};

let inicializacao: Promise<Runtime | undefined> | undefined;

export function iniciarLangfuse(): Promise<Runtime | undefined> {
  if (process.env.LANGFUSE_ENABLED !== "true" || !process.env.LANGFUSE_PUBLIC_KEY?.trim()
    || !process.env.LANGFUSE_SECRET_KEY?.trim() || !process.env.LANGFUSE_BASE_URL?.trim()) {
    return Promise.resolve(undefined);
  }
  return inicializacao ??= criarRuntime().catch(() => undefined);
}

async function criarRuntime(): Promise<Runtime | undefined> {
  const baseUrl = new URL(process.env.LANGFUSE_BASE_URL!);
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) return;
  const [{ NodeSDK }, { LangfuseSpanProcessor }, { startObservation }] = await Promise.all([
    import("@opentelemetry/sdk-node"), import("@langfuse/otel"), import("@langfuse/tracing"),
  ]);
  const processor = new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: baseUrl.toString(),
    timeout: 3,
    mediaUploadEnabled: false,
    shouldExportSpan: ({ otelSpan }) => otelSpan.instrumentationScope.name === "langfuse-sdk"
      && ["tms.fiscal.gerar_danfe", "tms.fiscal.gerar_dacte", "tms.fiscal.gerar_damdfe"].includes(otelSpan.name),
  });
  const sdk = new NodeSDK({
    autoDetectResources: false,
    instrumentations: [],
    spanProcessors: [processor],
  });
  sdk.start();
  // Cada chamada também descarrega seu lote: não dependemos do sinal de saída
  // do Next para preservar observações, nem substituímos seus handlers.
  process.once("beforeExit", () => { void sdk.shutdown().catch(() => undefined); });
  return { startObservation, flush: () => limitarEspera(processor.forceFlush()) };
}

async function limitarEspera(pendente: Promise<void>): Promise<void> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([pendente, new Promise<void>((resolve) => { relogio = setTimeout(resolve, 3_000); })]);
  } finally {
    clearTimeout(relogio);
  }
}

/** Uma falha de telemetria nunca repete nem altera a execução fiscal. */
export async function observarFerramentaFiscal(
  ferramenta: FerramentaFiscal,
  executar: () => Promise<unknown>,
): Promise<unknown> {
  const runtime = await iniciarLangfuse();
  let observacao: ReturnType<Runtime["startObservation"]> | undefined;
  try {
    observacao = runtime?.startObservation(`tms.fiscal.${ferramenta}`, {
      input: { content: "omitted" },
      metadata: { application: "tms", tool: `fiscal_${ferramenta}` },
    }, { asType: "tool" });
  } catch { /* Telemetria indisponível: a ferramenta continua. */ }
  let falhou = true;
  try {
    const resultado = await executar();
    falhou = typeof resultado === "object" && resultado !== null && "isError" in resultado && resultado.isError === true;
    return resultado;
  } finally {
    try {
      observacao?.update({
        output: { status: falhou ? "failed" : "completed" },
        level: falhou ? "ERROR" : "DEFAULT",
        statusMessage: falhou ? "Fiscal tool failed" : "Fiscal tool completed",
      }).end();
      if (observacao && runtime) await runtime.flush();
    } catch { /* Não expõe erros do exportador nem altera a resposta fiscal. */ }
  }
}

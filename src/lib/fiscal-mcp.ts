/**
 * Cliente do servidor fiscal da casa ("MCP Fiscal Brasil"), só para o que o TMS
 * usa dele: gerar o DANFE em PDF a partir do XML de uma NF-e, o DACTE a partir
 * do XML de um CT-e autorizado e o DAMDFE a partir do XML de um MDF-e autorizado.
 *
 * O servidor fala MCP por HTTP (JSON-RPC em `POST`, resposta em JSON ou em
 * `text/event-stream` com uma linha `data: {json}`). A conversa tem três
 * passos: `initialize` (devolve o cabeçalho `mcp-session-id`),
 * `notifications/initialized` e `tools/call`; no fim, um `DELETE` encerra a
 * sessão, para ela não ficar aberta no servidor. Não há dependência nova: é
 * `fetch` e um leitor pequeno da resposta.
 *
 * Variáveis de ambiente:
 * - `FISCAL_MCP_URL`: o endereço (ex.: `https://fiscal.avilaops.com/mcp`). Sem
 *   ela o recurso fica desligado: as rotas respondem 503 e as telas não mostram
 *   o botão.
 * - `FISCAL_MCP_TOKEN` (opcional): vai como `Authorization: Bearer`, para
 *   quando o servidor passar a exigir autenticação.
 * - `FISCAL_MCP_TIMEOUT_MS` (opcional): o tempo máximo da conversa, em
 *   milissegundos, no lugar do padrão de 20 segundos.
 *
 * Só o servidor importa este arquivo.
 */

/** Tempo máximo da conversa inteira (os três passos), em milissegundos. */
export const TEMPO_LIMITE_MS = 20_000;

/** O tempo limite em vigor: o da variável de ambiente, se for um número de 100 ms a 2 minutos; senão o padrão. */
export function tempoLimite(): number {
  const configurado = Number(process.env.FISCAL_MCP_TIMEOUT_MS);
  return Number.isFinite(configurado) && configurado >= 100 && configurado <= 120_000 ? configurado : TEMPO_LIMITE_MS;
}

/** O PDF não passa disto: um DANFE tem poucas páginas, e a resposta vem de fora. */
export const LIMITE_DO_PDF_BYTES = 10 * 1024 * 1024;

export const DANFE_DESLIGADO = "A geração de DANFE não está ligada neste sistema.";
export const DANFE_TEMPO_ESGOTADO = "O serviço fiscal demorou demais para responder. Tente de novo em instantes.";
export const DANFE_FORA_DO_AR = "Não foi possível falar com o serviço fiscal. Tente de novo em instantes.";
export const DANFE_RECUSADO = "O serviço fiscal não conseguiu gerar o DANFE desta nota.";

export type MotivoDaFalha = "desligado" | "tempo" | "servico" | "ferramenta";

/** Falha ao gerar o DANFE. A mensagem é para a tela; o detalhe, só para o log do servidor. */
export class FiscalMcpError extends Error {
  constructor(
    readonly motivo: MotivoDaFalha,
    message: string,
    readonly detalhe?: string,
  ) {
    super(message);
    this.name = "FiscalMcpError";
  }
}

/** O status HTTP que a rota devolve para cada falha. */
export const STATUS_DA_FALHA: Record<MotivoDaFalha, number> = {
  desligado: 503,
  tempo: 504,
  servico: 502,
  ferramenta: 502,
};

/** O endereço configurado, ou `null` quando o recurso está desligado (ausente ou que não é http/https). */
export function enderecoDoFiscal(): string | null {
  const valor = process.env.FISCAL_MCP_URL?.trim();
  if (!valor) return null;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** O recurso está ligado? É o que as telas perguntam (pela resposta das rotas) antes de mostrar o botão. */
export const danfeLigado = () => enderecoDoFiscal() !== null;

/** Nome do arquivo no download: a chave, como no XML. */
export const nomeDoArquivoDanfe = (chave: string) => `${chave.replace(/\D/g, "")}-danfe.pdf`;

type RespostaRpc = { id?: unknown; result?: unknown; error?: { message?: unknown } };

const ehObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);

function lerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/**
 * A resposta JSON-RPC com o `id` pedido, tirada do corpo. O corpo é um JSON
 * só ou um fluxo de eventos (`event: message` / `data: {json}`), em que podem
 * vir avisos do servidor antes da resposta.
 */
export function respostaRpc(corpo: string, tipo: string | null, id: number): RespostaRpc | null {
  const candidatos: unknown[] = (tipo ?? "").includes("text/event-stream")
    ? corpo
        .split(/\r?\n/)
        .filter((linha) => linha.startsWith("data:"))
        .map((linha) => lerJson(linha.slice(5).trim()))
    : [lerJson(corpo)];
  const achada = candidatos.find((candidato) => ehObjeto(candidato) && candidato.id === id);
  return ehObjeto(achada) ? (achada as RespostaRpc) : null;
}

const TEXTO_MAXIMO_DO_ERRO = 300;

/** O primeiro texto do `content` de um resultado de ferramenta. */
function textoDoResultado(resultado: Record<string, unknown>): string | null {
  const conteudo = Array.isArray(resultado.content) ? resultado.content : [];
  const parte = conteudo.find((item) => ehObjeto(item) && item.type === "text" && typeof item.text === "string");
  return ehObjeto(parte) ? (parte.text as string) : null;
}

/**
 * O PDF do resultado de `gerar_danfe`. O servidor devolve o mesmo objeto em
 * `structuredContent` e, como texto JSON, em `content[0].text`:
 * `{ "pdf_base64": "...", "nome_arquivo": "...", "chave_acesso": "...", ... }`.
 * Resultado com `isError` ou sem um PDF de verdade vira `FiscalMcpError`.
 */
export function pdfDoResultado(resultado: unknown): Buffer {
  if (!ehObjeto(resultado)) throw new FiscalMcpError("servico", DANFE_FORA_DO_AR, "resultado ausente");

  const texto = textoDoResultado(resultado);
  if (resultado.isError === true) {
    throw new FiscalMcpError("ferramenta", DANFE_RECUSADO, (texto ?? "erro sem texto").slice(0, TEXTO_MAXIMO_DO_ERRO));
  }

  const estruturado = ehObjeto(resultado.structuredContent) ? resultado.structuredContent : null;
  const doTexto = texto ? lerJson(texto) : null;
  const dados = estruturado && typeof estruturado.pdf_base64 === "string" ? estruturado : ehObjeto(doTexto) ? doTexto : null;
  const base64 = dados && typeof dados.pdf_base64 === "string" ? dados.pdf_base64 : null;
  if (!base64) {
    throw new FiscalMcpError("ferramenta", DANFE_RECUSADO, (texto ?? "resultado sem pdf_base64").slice(0, TEXTO_MAXIMO_DO_ERRO));
  }
  // Conta pelo tamanho do texto antes de decodificar: base64 ocupa 4 caracteres a cada 3 bytes.
  if (base64.length > (LIMITE_DO_PDF_BYTES / 3) * 4 + 4) {
    throw new FiscalMcpError("ferramenta", DANFE_RECUSADO, "PDF maior que o limite");
  }

  const pdf = Buffer.from(base64, "base64");
  // O conteúdo veio de fora e vai para o navegador como PDF: só passa o que começa como PDF.
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new FiscalMcpError("ferramenta", DANFE_RECUSADO, "o conteúdo devolvido não é um PDF");
  }
  return pdf;
}

const VERSAO_DO_PROTOCOLO = "2025-03-26";

/**
 * Gera o DANFE (PDF) do XML de uma NF-e no serviço fiscal.
 *
 * Lança `FiscalMcpError` com o motivo: `desligado` (sem `FISCAL_MCP_URL`),
 * `tempo` (a conversa passou do limite), `servico` (rede, status HTTP ou
 * resposta fora do protocolo) e `ferramenta` (o serviço respondeu, mas recusou
 * o XML ou não devolveu um PDF).
 */
export async function gerarDanfe(xml: string, opcoes: { tempoLimiteMs?: number } = {}): Promise<Buffer> {
  return pdfDoResultado(await chamarFerramenta("gerar_danfe", xml, opcoes));
}

/* ----------------------------------- DACTE ----------------------------------- */

export const DACTE_DESLIGADO = "A geração de DACTE não está ligada neste sistema.";
export const DACTE_RECUSADO = "O serviço fiscal não conseguiu gerar o DACTE deste CT-e.";
export const DACTE_SEM_PROTOCOLO = "O serviço fiscal não reconheceu o protocolo de autorização deste CT-e: o DACTE não foi gerado.";

/** Nome do arquivo no download. O de homologação diz no nome que não tem valor fiscal. */
export const nomeDoArquivoDacte = (chave: string, homologacao: boolean) =>
  `${chave.replace(/[^0-9A-Za-z]/g, "")}-dacte${homologacao ? "-HOMOLOGACAO-SEM-VALOR-FISCAL" : ""}.pdf`;

/** O resultado da ferramenta diz que o documento (CT-e ou MDF-e) tem protocolo de autorização (cStat 100)? */
function autorizadoNoResultado(resultado: unknown): boolean {
  if (!ehObjeto(resultado)) return false;
  const estruturado = ehObjeto(resultado.structuredContent) ? resultado.structuredContent : null;
  const texto = textoDoResultado(resultado);
  const doTexto = texto ? lerJson(texto) : null;
  const dados = estruturado ?? (ehObjeto(doTexto) ? doTexto : null);
  return dados?.autorizado === true;
}

/**
 * Gera o DACTE (PDF) do arquivo de um CT-e autorizado (`cteProc`) no serviço
 * fiscal (ferramenta `gerar_dacte`). O PDF só é devolvido quando o serviço
 * confirma que o XML traz o protocolo de autorização: este sistema não entrega
 * DACTE de CT-e sem protocolo. As falhas são as de `gerarDanfe`, com as frases
 * do DACTE.
 */
export async function gerarDacte(xml: string, opcoes: { tempoLimiteMs?: number } = {}): Promise<Buffer> {
  try {
    const resultado = await chamarFerramenta("gerar_dacte", xml, opcoes);
    const pdf = pdfDoResultado(resultado);
    if (!autorizadoNoResultado(resultado)) throw new FiscalMcpError("ferramenta", DACTE_SEM_PROTOCOLO, "autorizado diferente de true");
    return pdf;
  } catch (erro) {
    if (!(erro instanceof FiscalMcpError)) throw erro;
    const frase = erro.motivo === "desligado" ? DACTE_DESLIGADO : erro.message === DANFE_RECUSADO ? DACTE_RECUSADO : erro.message;
    throw new FiscalMcpError(erro.motivo, frase, erro.detalhe);
  }
}

/** A resposta de uma rota de documento auxiliar (DACTE ou DAMDFE): o PDF como anexo, ou o erro em JSON com o status do motivo. */
async function respostaDoDocumento(oQue: "DACTE" | "DAMDFE", gerar: () => Promise<Buffer>, nomeDoArquivo: string): Promise<Response> {
  try {
    const pdf = await gerar();
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nomeDoArquivo}"`,
        "Content-Length": String(pdf.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (erro) {
    if (!(erro instanceof FiscalMcpError)) throw erro;
    if (erro.motivo !== "desligado") console.error(`${oQue} não gerado (${erro.motivo}):`, erro.detalhe ?? erro.message);
    return Response.json({ error: erro.message }, { status: STATUS_DA_FALHA[erro.motivo] });
  }
}

/** A resposta da rota de DACTE: o PDF como anexo, ou o erro em JSON com o status do motivo. */
export const respostaDoDacte = (chave: string, xml: string, homologacao: boolean): Promise<Response> =>
  respostaDoDocumento("DACTE", () => gerarDacte(xml), nomeDoArquivoDacte(chave, homologacao));

/* ----------------------------------- DAMDFE ---------------------------------- */

export const DAMDFE_DESLIGADO = "A geração de DAMDFE não está ligada neste sistema.";
export const DAMDFE_RECUSADO = "O serviço fiscal não conseguiu gerar o DAMDFE deste MDF-e.";
export const DAMDFE_SEM_PROTOCOLO = "O serviço fiscal não reconheceu o protocolo de autorização deste MDF-e: o DAMDFE não foi gerado.";

/** Nome do arquivo no download. O de homologação diz no nome que não tem valor fiscal. */
export const nomeDoArquivoDamdfe = (chave: string, homologacao: boolean) =>
  `${chave.replace(/[^0-9A-Za-z]/g, "")}-damdfe${homologacao ? "-HOMOLOGACAO-SEM-VALOR-FISCAL" : ""}.pdf`;

/**
 * Gera o DAMDFE (PDF) do arquivo de um MDF-e autorizado (`mdfeProc`) no serviço
 * fiscal (ferramenta `gerar_damdfe`, mesma forma do `gerar_dacte`). O PDF só é
 * devolvido quando o serviço confirma que o XML traz o protocolo de
 * autorização: este sistema não entrega DAMDFE de MDF-e sem protocolo.
 */
export async function gerarDamdfe(xml: string, opcoes: { tempoLimiteMs?: number } = {}): Promise<Buffer> {
  try {
    const resultado = await chamarFerramenta("gerar_damdfe", xml, opcoes);
    const pdf = pdfDoResultado(resultado);
    if (!autorizadoNoResultado(resultado)) throw new FiscalMcpError("ferramenta", DAMDFE_SEM_PROTOCOLO, "autorizado diferente de true");
    return pdf;
  } catch (erro) {
    if (!(erro instanceof FiscalMcpError)) throw erro;
    const frase = erro.motivo === "desligado" ? DAMDFE_DESLIGADO : erro.message === DANFE_RECUSADO ? DAMDFE_RECUSADO : erro.message;
    throw new FiscalMcpError(erro.motivo, frase, erro.detalhe);
  }
}

/** A resposta da rota de DAMDFE: o PDF como anexo, ou o erro em JSON com o status do motivo. */
export const respostaDoDamdfe = (chave: string, xml: string, homologacao: boolean): Promise<Response> =>
  respostaDoDocumento("DAMDFE", () => gerarDamdfe(xml), nomeDoArquivoDamdfe(chave, homologacao));

/**
 * A conversa com o serviço: abre a sessão, chama a ferramenta com o XML e
 * devolve o resultado dela, cru. Quem chama tira dele o que precisa.
 */
async function chamarFerramenta(ferramenta: "gerar_danfe" | "gerar_dacte" | "gerar_damdfe", xml: string, opcoes: { tempoLimiteMs?: number } = {}): Promise<unknown> {
  const endereco = enderecoDoFiscal();
  if (!endereco) throw new FiscalMcpError("desligado", DANFE_DESLIGADO);

  const token = process.env.FISCAL_MCP_TOKEN?.trim();
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), opcoes.tempoLimiteMs ?? tempoLimite());

  let sessao: string | null = null;

  const enviar = async (corpo: Record<string, unknown>) => {
    const res = await fetch(endereco, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sessao && { "mcp-session-id": sessao }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...corpo }),
      signal: controle.signal,
      // O endereço é fixo, da configuração: redirecionamento não é esperado e não é seguido.
      redirect: "error",
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new FiscalMcpError("servico", DANFE_FORA_DO_AR, `status ${res.status} em ${String(corpo.method)}`);
    }
    return res;
  };

  const chamar = async (id: number, method: string, params: Record<string, unknown>) => {
    const res = await enviar({ id, method, params });
    const resposta = respostaRpc(await res.text(), res.headers.get("content-type"), id);
    if (!resposta) throw new FiscalMcpError("servico", DANFE_FORA_DO_AR, `resposta de ${method} fora do protocolo`);
    if (resposta.error) {
      throw new FiscalMcpError("servico", DANFE_FORA_DO_AR, `${method}: ${String(resposta.error.message ?? "erro").slice(0, TEXTO_MAXIMO_DO_ERRO)}`);
    }
    return { res, resultado: resposta.result };
  };

  try {
    const inicio = await chamar(1, "initialize", {
      protocolVersion: VERSAO_DO_PROTOCOLO,
      capabilities: {},
      clientInfo: { name: "tms", version: "1" },
    });
    sessao = inicio.res.headers.get("mcp-session-id");

    // Aviso sem resposta (202): o corpo, se vier, é descartado.
    const aviso = await enviar({ method: "notifications/initialized" });
    await aviso.body?.cancel().catch(() => undefined);

    const { resultado } = await chamar(2, "tools/call", { name: ferramenta, arguments: { xml_content: xml } });
    return resultado;
  } catch (erro) {
    if (erro instanceof FiscalMcpError) throw erro;
    if (controle.signal.aborted) throw new FiscalMcpError("tempo", DANFE_TEMPO_ESGOTADO);
    throw new FiscalMcpError("servico", DANFE_FORA_DO_AR, erro instanceof Error ? erro.message : String(erro));
  } finally {
    clearTimeout(relogio);
    if (sessao) void encerrarSessao(endereco, sessao, token);
  }
}

const TEMPO_PARA_ENCERRAR_MS = 5_000;

/**
 * Encerra a sessão no servidor (`DELETE` com o `mcp-session-id`). É cortesia:
 * ninguém espera por isto, e uma falha aqui não muda o resultado do DANFE (o
 * servidor descarta sozinho a sessão parada).
 */
async function encerrarSessao(endereco: string, sessao: string, token: string | undefined): Promise<void> {
  try {
    const res = await fetch(endereco, {
      method: "DELETE",
      headers: { "mcp-session-id": sessao, ...(token && { Authorization: `Bearer ${token}` }) },
      signal: AbortSignal.timeout(TEMPO_PARA_ENCERRAR_MS),
      redirect: "error",
    });
    await res.body?.cancel().catch(() => undefined);
  } catch {
    // Sem importância: ver o comentário acima.
  }
}

/** O PDF como download. Vai como anexo, com `nosniff` e sem cache, como o XML. */
export function respostaComDanfe(chave: string, pdf: Buffer): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeDoArquivoDanfe(chave)}"`,
      "Content-Length": String(pdf.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * A resposta das rotas de DANFE a partir do XML guardado: o PDF, ou o erro em
 * JSON com o status do motivo. O detalhe da falha fica só no log do servidor.
 */
export async function respostaDoDanfe(chave: string, xml: string): Promise<Response> {
  try {
    return respostaComDanfe(chave, await gerarDanfe(xml));
  } catch (erro) {
    if (!(erro instanceof FiscalMcpError)) throw erro;
    if (erro.motivo !== "desligado") console.error(`DANFE não gerado (${erro.motivo}):`, erro.detalhe ?? erro.message);
    return Response.json({ error: erro.message }, { status: STATUS_DA_FALHA[erro.motivo] });
  }
}

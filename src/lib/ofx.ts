/**
 * Leitor de extrato bancário em OFX (o "Money" que todo banco exporta).
 *
 * Lê as duas gerações do formato com o mesmo código:
 * - OFX 1.x é SGML: cabeçalho em linhas `CHAVE:VALOR` e campos sem fechamento
 *   (`<TRNAMT>-45.90` e fim de linha).
 * - OFX 2.x é XML: `<?xml ...?>`, `<?OFX ...?>` e todo campo fechado
 *   (`<TRNAMT>-45.90</TRNAMT>`).
 *
 * O leitor anda pelas marcas na ordem em que aparecem e guarda só o que a
 * conciliação usa: a conta (`BANKACCTFROM` ou, em fatura de cartão,
 * `CCACCTFROM`), o período (`DTSTART` e `DTEND` da lista) e cada movimentação
 * (`STMTTRN`). Não valida o arquivo contra a especificação: banco nenhum a
 * segue à risca.
 *
 * Tudo aqui é puro, sem dependência e sem banco. O número da conta sai do
 * leitor inteiro (é ele que distingue uma conta da outra) e mascarado (é o que
 * se grava e se mostra): quem chama decide o que fazer com o inteiro.
 */

/** Limite do arquivo: um extrato de um ano de uma conta movimentada fica muito abaixo disso. */
export const TAMANHO_MAXIMO_DO_OFX = 2 * 1024 * 1024;

export const OFX_VAZIO = "O arquivo está vazio.";
export const OFX_GRANDE = "O arquivo passa de 2 MB. Exporte um período menor do extrato.";
export const NAO_E_OFX = "Este arquivo não é um extrato OFX. No site do banco, exporte o extrato no formato OFX (Money).";
export const OFX_SEM_MOVIMENTO = "O extrato não traz nenhuma movimentação.";

/** Arquivo recusado pelo leitor: a mensagem é para a pessoa que enviou. */
export class OfxError extends Error {}

export type ContaDoExtrato = {
  /** Código do banco (`BANKID`), como veio. */
  banco: string | null;
  agencia: string | null;
  /** O número inteiro da conta. Não grave nem mostre: use `mascarada`. */
  numero: string;
  /** Só o fim do número: `••••1234`. */
  mascarada: string;
  /** `CHECKING`, `SAVINGS`, `CREDITCARD`... */
  tipo: string | null;
};

export type TransacaoDoExtrato = {
  /** Identificador da movimentação no banco: é o que impede importar duas vezes. */
  fitId: string;
  /** Dia do calendário, `AAAA-MM-DD`, como o banco escreveu. */
  dia: string;
  /** Com sinal: positivo é crédito (entrou), negativo é débito (saiu). */
  valor: number;
  /** `TRNTYPE`: CREDIT, DEBIT, XFER, PAYMENT, FEE... */
  tipo: string | null;
  descricao: string;
};

export type ExtratoOfx = {
  conta: ContaDoExtrato;
  /** Período do extrato (`AAAA-MM-DD`), quando o arquivo informa. */
  inicio: string | null;
  fim: string | null;
  transacoes: TransacaoDoExtrato[];
};

export type LeituraOfx = {
  /** 1 para OFX 1.x (SGML), 2 para OFX 2.x (XML). */
  versao: 1 | 2;
  extratos: ExtratoOfx[];
};

/* ------------------------------ Datas e valores ------------------------------- */

/**
 * O dia de uma data do OFX: `AAAAMMDD[HHMMSS][.XXX][fuso]`, por exemplo
 * `20261005`, `20261005103000` ou `20261005103000.000[-3:BRT]`. Vale o dia
 * escrito, sem converter o fuso: é o dia em que o banco diz que aconteceu.
 * Devolve `AAAA-MM-DD`, ou `null` se não é uma data.
 */
export function diaDoOfx(texto: string | null | undefined): string | null {
  const partes = (texto ?? "").trim().match(/^(\d{4})(\d{2})(\d{2})(?:\d{2}(?:\d{2}(?:\d{2})?)?)?(?:\.\d+)?\s*(?:\[[^\]]*\])?$/);
  if (!partes) return null;
  const [ano, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  // 31 de fevereiro "vira" março: data que não volta igual não existe.
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return `${partes[1]}-${partes[2]}-${partes[3]}`;
}

/**
 * O valor de uma movimentação: `-1234.56` (o padrão), `1234,56` (banco que
 * escreve à brasileira), `1.234,56`, `1,234.56` e `+50.00`. Com os dois sinais
 * de separação, o último é o decimal. Devolve em centavos exatos, ou `null`.
 */
export function valorDoOfx(texto: string | null | undefined): number | null {
  let limpo = (texto ?? "").replace(/\s/g, "");
  if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(limpo)) return null;
  const ponto = limpo.lastIndexOf(".");
  const virgula = limpo.lastIndexOf(",");
  if (ponto !== -1 && virgula !== -1) {
    const milhar = ponto > virgula ? "," : ".";
    limpo = limpo.split(milhar).join("");
  }
  limpo = limpo.replace(",", ".");
  // Sobrou mais de um separador ("1.234.567"): não dá para saber o que é.
  if ((limpo.match(/\./g) ?? []).length > 1) return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) ? Math.round((valor + Number.EPSILON * Math.sign(valor)) * 100) / 100 : null;
}

/** Só o fim do número da conta: `••••1234`. Número curto mostra menos ainda. */
export function mascararConta(numero: string): string {
  const limpo = numero.replace(/\s/g, "");
  if (limpo === "") return "conta não informada";
  const visiveis = limpo.length > 4 ? 4 : Math.max(1, limpo.length - 2);
  return `••••${limpo.slice(-visiveis)}`;
}

/* ---------------------------------- Leitura ----------------------------------- */

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function semEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteiro, nome: string) => {
    if (nome[0] === "#") {
      const codigo = nome[1].toLowerCase() === "x" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : inteiro;
    }
    return Object.hasOwn(ENTIDADES, nome.toLowerCase()) ? ENTIDADES[nome.toLowerCase()] : inteiro;
  });
}

const umaLinha = (texto: string) => semEntidades(texto).replace(/\s+/g, " ").trim();

/**
 * O texto de um arquivo OFX a partir dos bytes. OFX 1.x de banco brasileiro
 * costuma vir em Windows-1252 (o cabeçalho diz `CHARSET:1252`); os mais novos,
 * em UTF-8. Tenta UTF-8 e, se os bytes não forem UTF-8 válido, lê como 1252.
 */
export function textoDoOfx(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw new OfxError(OFX_VAZIO);
  if (bytes.byteLength > TAMANHO_MAXIMO_DO_OFX) throw new OfxError(OFX_GRANDE);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

type TransacaoCrua = { fitId?: string; data?: string; valor?: string; tipo?: string; nome?: string; memo?: string };

// Os campos de cada bloco que o leitor guarda. O resto do arquivo é ignorado.
const CAMPOS_DA_CONTA: Record<string, "banco" | "agencia" | "numero" | "tipo"> = { BANKID: "banco", BRANCHID: "agencia", ACCTID: "numero", ACCTTYPE: "tipo" };
const CAMPOS_DA_TRANSACAO: Record<string, keyof TransacaoCrua> = { FITID: "fitId", DTPOSTED: "data", TRNAMT: "valor", TRNTYPE: "tipo", NAME: "nome", MEMO: "memo" };

// Um identificador curto e estável de um texto (djb2), para a movimentação que veio sem FITID.
function resumoDoTexto(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i += 1) h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Lê o texto de um arquivo OFX. Recusa (com `OfxError`) arquivo vazio, grande
 * demais, que não é OFX, sem movimentação, ou com movimentação sem data ou sem
 * valor legível: importar "o que deu" esconderia um lançamento do extrato.
 *
 * Movimentação de valor zero (o banco usa para "saldo anterior" e avisos) é
 * descartada. Sem `FITID`, o identificador é montado com dia, valor e
 * descrição; `FITID` repetido dentro da mesma conta ganha `#2`, `#3`... na
 * ordem do arquivo, para as duas movimentações não virarem uma.
 */
export function lerOfx(texto: string): LeituraOfx {
  if (texto.trim() === "") throw new OfxError(OFX_VAZIO);
  if (texto.length > TAMANHO_MAXIMO_DO_OFX) throw new OfxError(OFX_GRANDE);

  const inicio = texto.search(/<OFX>/i);
  if (inicio === -1) throw new OfxError(NAO_E_OFX);
  const versao: 1 | 2 = /<\?xml|<\?OFX/i.test(texto.slice(0, inicio)) ? 2 : 1;

  const extratos: ExtratoOfx[] = [];
  let extrato: ExtratoOfx | null = null;
  let transacao: TransacaoCrua | null = null;
  let emConta = false;
  let emLista = false;
  let lidas = 0;
  // Por extrato: quantas vezes cada identificador já apareceu.
  let vistos = new Map<string, number>();

  const contaVazia = (): ContaDoExtrato => ({ banco: null, agencia: null, numero: "", mascarada: mascararConta(""), tipo: null });
  const abrirExtrato = () => {
    extrato = { conta: contaVazia(), inicio: null, fim: null, transacoes: [] };
    extratos.push(extrato);
    vistos = new Map();
    return extrato;
  };
  const extratoAtual = () => extrato ?? abrirExtrato();

  const fecharTransacao = () => {
    if (!transacao) return;
    const crua = transacao;
    transacao = null;
    lidas += 1;

    const dia = diaDoOfx(crua.data);
    if (!dia) throw new OfxError(`A movimentação ${lidas} do extrato está sem data legível${crua.data ? ` ("${crua.data}")` : ""}.`);
    const valor = valorDoOfx(crua.valor);
    if (valor === null) throw new OfxError(`A movimentação ${lidas} do extrato (${dia}) está sem valor legível${crua.valor ? ` ("${crua.valor}")` : ""}.`);
    if (valor === 0) return;

    const nome = crua.nome ?? "";
    const memo = crua.memo ?? "";
    // Muitos bancos repetem o mesmo texto em NAME e MEMO.
    const descricao = nome && memo && !memo.toLowerCase().includes(nome.toLowerCase()) ? `${nome} - ${memo}` : memo || nome || "Sem descrição";

    const base = crua.fitId || `SEM-ID-${dia}-${valor.toFixed(2)}-${resumoDoTexto(descricao)}`;
    const vez = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, vez);

    extratoAtual().transacoes.push({ fitId: vez === 1 ? base : `${base}#${vez}`, dia, valor, tipo: crua.tipo ? crua.tipo.toUpperCase() : null, descricao });
  };

  // Cada marca com o texto que vem logo depois dela: `<TRNAMT>-45.90`, `</STMTTRN>`.
  const marcas = /<(\/?)([A-Za-z0-9_.]+)[^<>]*>([^<]*)/g;
  marcas.lastIndex = inicio;
  for (let m = marcas.exec(texto); m; m = marcas.exec(texto)) {
    const fecha = m[1] === "/";
    const nome = m[2].toUpperCase();
    const valor = umaLinha(m[3]);

    if (fecha) {
      if (nome === "STMTTRN") fecharTransacao();
      else if (nome === "BANKACCTFROM" || nome === "CCACCTFROM") emConta = false;
      else if (nome === "BANKTRANLIST") {
        fecharTransacao();
        emLista = false;
      } else if (nome === "STMTRS" || nome === "CCSTMTRS") {
        fecharTransacao();
        extrato = null;
      }
      continue;
    }

    if (nome === "STMTRS" || nome === "CCSTMTRS") {
      fecharTransacao();
      abrirExtrato();
    } else if (nome === "BANKACCTFROM" || nome === "CCACCTFROM") {
      emConta = true;
      if (nome === "CCACCTFROM") extratoAtual().conta.tipo = "CREDITCARD";
    } else if (nome === "BANKTRANLIST") {
      emLista = true;
    } else if (nome === "STMTTRN") {
      // Arquivo que não fecha a movimentação anterior: a nova a encerra.
      fecharTransacao();
      transacao = {};
    } else if (valor !== "") {
      if (transacao) {
        const campo = CAMPOS_DA_TRANSACAO[nome];
        // O primeiro vale: `<NAME>` dentro de `<PAYEE>` não troca o da movimentação.
        if (campo && (transacao as TransacaoCrua)[campo] === undefined) (transacao as TransacaoCrua)[campo] = valor;
      } else if (emConta) {
        const campo = CAMPOS_DA_CONTA[nome];
        if (campo) {
          const conta = extratoAtual().conta;
          conta[campo] = valor;
          if (campo === "numero") conta.mascarada = mascararConta(valor);
        }
      } else if (emLista && (nome === "DTSTART" || nome === "DTEND")) {
        const dia = diaDoOfx(valor);
        if (nome === "DTSTART") extratoAtual().inicio = dia;
        else extratoAtual().fim = dia;
      }
    }
  }
  fecharTransacao();

  const comMovimento = extratos.filter((e) => e.transacoes.length > 0);
  if (comMovimento.length === 0) throw new OfxError(OFX_SEM_MOVIMENTO);
  return { versao, extratos: comMovimento };
}

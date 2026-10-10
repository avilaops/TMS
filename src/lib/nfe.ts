import { z } from "zod";
import { createCollectionSchema } from "@/lib/coletas";
import type { CteEmitido } from "@/lib/cte";
import { enderecoDoTexto, type EnderecoDaEntrega } from "@/lib/endereco";

// Documentos fiscais: leitura do XML de NF-e (modelo 55), sugestão da carga a
// partir da nota e o registro manual de CT-e emitido em outro sistema.
//
// Tudo aqui é função pura, sem banco e sem dependência: a tela também importa
// este arquivo. O XML é tratado só como texto. Nada dele é executado, nenhuma
// entidade além das cinco do XML é expandida e arquivo com DOCTYPE é recusado
// (uma NF-e não tem, e é por ele que entram as entidades que estouram memória
// ou leem arquivo do servidor).

/** O XML de uma NF-e autorizada fica na casa das dezenas de kB; 1 MB já é folga. */
export const LIMITE_DO_XML_BYTES = 1024 * 1024;

export const XML_AUSENTE = "Envie o arquivo XML da nota.";
export const XML_GRANDE = "O arquivo é grande demais: o XML de uma NF-e tem no máximo 1 MB.";
const NAO_E_NFE = "O arquivo é um XML, mas não é de NF-e";
const CHAVE_SEM_44 = "A chave de acesso da nota não tem 44 dígitos.";
const CHAVE_INVALIDA = "A chave de acesso da nota é inválida: o dígito verificador não confere.";
const CHAVE_DO_PROTOCOLO = "A chave do protocolo de autorização é diferente da chave da nota.";
const CHAVE_NAO_E_DA_NOTA = "A chave de acesso não corresponde ao emitente, à série e ao número que estão na nota.";

// ---------------------------------------------------------------------------
// Chave de acesso (NF-e e CT-e têm o mesmo formato)
// ---------------------------------------------------------------------------

export const TAMANHO_DA_CHAVE = 44;

/**
 * O formato da chave desde o CNPJ alfanumérico (Nota Técnica Conjunta 2025.001,
 * item 5, em produção desde 06/07/2026): letras maiúsculas só nas 12 primeiras
 * posições do CNPJ do emitente. A chave só de dígitos é o caso particular.
 */
const CORPO_DA_CHAVE = /^[0-9]{6}[A-Z0-9]{12}[0-9]{25}$/;
const CHAVE_INTEIRA = /^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/;

/** Uma chave como a pessoa cola (com espaços, pontos, minúsculas) no formato do documento: só letras e dígitos, em maiúsculas. */
export const limparChave = (texto: string) => texto.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();

/**
 * Dígito verificador da chave: módulo 11 sobre os 43 primeiros caracteres, com
 * pesos de 2 a 9 da direita para a esquerda. Resto 0 ou 1 dá dígito 0. Cada
 * caractere vale o código ASCII menos 48 (NT Conjunta 2025.001): um dígito
 * vale ele mesmo, "A" vale 17.
 */
export function digitoDaChave(corpo: string): number | null {
  if (!CORPO_DA_CHAVE.test(corpo)) return null;
  let soma = 0;
  for (let i = 0; i < corpo.length; i += 1) {
    const peso = 2 + (i % 8);
    soma += (corpo.charCodeAt(corpo.length - 1 - i) - 48) * peso;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function chaveValida(chave: string): boolean {
  if (!CHAVE_INTEIRA.test(chave)) return false;
  return digitoDaChave(chave.slice(0, 43)) === Number(chave[43]);
}

/** As partes da chave que a leitura confere contra o conteúdo do documento. */
export function partesDaChave(chave: string) {
  return {
    documentoDoEmitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: Number(chave.slice(22, 25)),
    numero: Number(chave.slice(25, 34)),
  };
}

// ---------------------------------------------------------------------------
// Leitor de XML
// ---------------------------------------------------------------------------

/** Um elemento do XML lido: o nome sem prefixo, os atributos, os filhos e o texto. */
export type No = { nome: string; atributos: Map<string, string>; filhos: No[]; texto: string };

/** O texto não é um XML que o leitor aceita. A mensagem é uma frase curta, sem ponto final. */
export class XmlInvalido extends Error {}

const NOME_XML = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;
const ATRIBUTO = /\s+([^\s=<>"'/]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const ENTIDADE = /&([^;&\s]*);?/g;
const ENTIDADES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
/** NF-e não passa de uma dúzia de níveis; o teto só existe para XML feito para dar trabalho. */
const PROFUNDIDADE_MAXIMA = 64;

function caractere(codigo: number): string {
  const valido =
    codigo === 0x9 ||
    codigo === 0xa ||
    codigo === 0xd ||
    (codigo >= 0x20 && codigo <= 0xd7ff) ||
    (codigo >= 0xe000 && codigo <= 0xfffd) ||
    (codigo >= 0x10000 && codigo <= 0x10ffff);
  if (!valido) throw new XmlInvalido("referência a caractere inválido");
  return String.fromCodePoint(codigo);
}

/** Só as cinco entidades do XML e as referências numéricas. Qualquer outra é erro: sem DOCTYPE não há como declará-la. */
function decodificar(texto: string): string {
  if (!texto.includes("&")) return texto;
  return texto.replace(ENTIDADE, (inteiro, nome: string) => {
    if (!inteiro.endsWith(";")) throw new XmlInvalido("há um & solto no texto");
    if (Object.hasOwn(ENTIDADES, nome)) return ENTIDADES[nome];
    if (/^#\d{1,7}$/.test(nome)) return caractere(Number(nome.slice(1)));
    if (/^#x[0-9a-fA-F]{1,6}$/.test(nome)) return caractere(parseInt(nome.slice(2), 16));
    throw new XmlInvalido(`entidade desconhecida (&${nome.slice(0, 20)};)`);
  });
}

/** Sem o prefixo de namespace: `nfe:infNFe` e `infNFe` são o mesmo elemento. */
const nomeLocal = (nome: string) => nome.slice(nome.indexOf(":") + 1);

/** Onde a tag aberta em `inicio` termina, pulando `>` dentro de valor de atributo. */
function fimDaTag(xml: string, inicio: number): number {
  let aspas = "";
  for (let i = inicio + 1; i < xml.length; i += 1) {
    const c = xml[i];
    if (aspas) {
      if (c === aspas) aspas = "";
    } else if (c === '"' || c === "'") {
      aspas = c;
    } else if (c === ">") {
      return i;
    } else if (c === "<") {
      break;
    }
  }
  throw new XmlInvalido("há uma tag que não fecha");
}

function abrir(conteudo: string): { no: No; nomeCompleto: string; fechada: boolean } {
  const fechada = conteudo.endsWith("/");
  const corpo = fechada ? conteudo.slice(0, -1) : conteudo;
  const nomeCompleto = /^[^\s]+/.exec(corpo)?.[0] ?? "";
  if (!NOME_XML.test(nomeCompleto)) throw new XmlInvalido("há uma tag com nome inválido");

  const atributos = new Map<string, string>();
  let pos = nomeCompleto.length;
  for (;;) {
    ATRIBUTO.lastIndex = pos;
    const achado = ATRIBUTO.exec(corpo);
    if (!achado) break;
    atributos.set(nomeLocal(achado[1]), decodificar(achado[2] ?? achado[3] ?? ""));
    pos = ATRIBUTO.lastIndex;
  }
  if (corpo.slice(pos).trim() !== "") throw new XmlInvalido(`a tag <${nomeCompleto}> tem atributo malformado`);

  return { no: { nome: nomeLocal(nomeCompleto), atributos, filhos: [], texto: "" }, nomeCompleto, fechada };
}

/**
 * Lê o XML para uma árvore de elementos. Não é um leitor completo de XML: é o
 * suficiente para documento fiscal (elementos, atributos, texto, CDATA,
 * comentário e a declaração `<?xml ?>`), e recusa o resto. A emissão de CT-e
 * (src/lib/cte/) lê com ele as respostas da SEFAZ.
 */
export function lerXml(entrada: string): No {
  const xml = entrada.charCodeAt(0) === 0xfeff ? entrada.slice(1) : entrada;
  if (xml.includes("\u0000")) throw new XmlInvalido("o arquivo tem bytes nulos");

  const pilha: { no: No; nomeCompleto: string }[] = [];
  let raiz: No | null = null;
  let pos = 0;

  const texto = (trecho: string, cru = false) => {
    const topo = pilha.at(-1);
    if (topo) topo.no.texto += cru ? trecho : decodificar(trecho);
    else if (trecho.trim() !== "") throw new XmlInvalido("há texto fora do elemento principal");
  };
  const pular = (fim: string, de: number, oQue: string) => {
    const ate = xml.indexOf(fim, de);
    if (ate === -1) throw new XmlInvalido(`${oQue} não fecha`);
    return ate;
  };

  while (pos < xml.length) {
    const abre = xml.indexOf("<", pos);
    if (abre === -1) {
      texto(xml.slice(pos));
      break;
    }
    texto(xml.slice(pos, abre));

    if (xml.startsWith("<?", abre)) {
      pos = pular("?>", abre + 2, "a declaração <?") + 2;
    } else if (xml.startsWith("<!--", abre)) {
      pos = pular("-->", abre + 4, "um comentário") + 3;
    } else if (xml.startsWith("<![CDATA[", abre)) {
      const fim = pular("]]>", abre + 9, "um bloco CDATA");
      if (pilha.length === 0) throw new XmlInvalido("há texto fora do elemento principal");
      texto(xml.slice(abre + 9, fim), true);
      pos = fim + 3;
    } else if (xml.startsWith("<!", abre)) {
      throw new XmlInvalido("o arquivo declara DOCTYPE ou entidades, o que um documento fiscal não tem");
    } else if (xml.startsWith("</", abre)) {
      const fim = pular(">", abre + 2, "uma tag de fechamento");
      const nome = xml.slice(abre + 2, fim).trim();
      const topo = pilha.pop();
      if (!topo || topo.nomeCompleto !== nome) throw new XmlInvalido(`a tag </${nome.slice(0, 40)}> fecha o que não foi aberto`);
      pos = fim + 1;
    } else {
      const fim = fimDaTag(xml, abre);
      const { no, nomeCompleto, fechada } = abrir(xml.slice(abre + 1, fim));
      const pai = pilha.at(-1);
      if (pai) pai.no.filhos.push(no);
      else if (raiz) throw new XmlInvalido("há mais de um elemento principal");
      else raiz = no;
      if (!fechada) {
        if (pilha.length >= PROFUNDIDADE_MAXIMA) throw new XmlInvalido("há elementos aninhados demais");
        pilha.push({ no, nomeCompleto });
      }
      pos = fim + 1;
    }
  }

  const aberta = pilha.at(-1);
  if (aberta) throw new XmlInvalido(`a tag <${aberta.nomeCompleto}> não foi fechada`);
  if (!raiz) throw new XmlInvalido("não há nenhum elemento");
  return raiz;
}

export const filho = (no: No | undefined, nome: string) => no?.filhos.find((f) => f.nome === nome);

/** Texto de um elemento filho: sem espaço sobrando, cortado no tamanho da coluna. Vazio ou ausente é `null`. */
export function campo(no: No | undefined, nome: string, maximo = 200): string | null {
  const valor = filho(no, nome)?.texto.replace(/\s+/g, " ").trim() ?? "";
  return valor === "" ? null : valor.slice(0, maximo);
}

const digitos = (valor: string | null) => (valor === null ? null : valor.replace(/\D/g, ""));

/** Número como o XML fiscal escreve: só dígitos, ponto decimal, sem sinal nem expoente. */
function decimal(valor: string | null): number | null {
  return valor !== null && /^\d{1,15}(\.\d{1,10})?$/.test(valor) ? Number(valor) : null;
}

function inteiro(valor: string | null): number | null {
  return valor !== null && /^\d{1,9}$/.test(valor) ? Number(valor) : null;
}

/** `dhEmi` (data e hora com fuso) ou, nas notas antigas, `dEmi` (só o dia, lido à meia-noite UTC). */
function emissao(ide: No | undefined): Date | null {
  const dataHora = campo(ide, "dhEmi");
  const texto =
    dataHora !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/.test(dataHora)
      ? dataHora
      : /^\d{4}-\d{2}-\d{2}$/.test(campo(ide, "dEmi") ?? "")
        ? `${campo(ide, "dEmi")}T00:00:00.000Z`
        : null;
  if (texto === null) return null;
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : data;
}

// ---------------------------------------------------------------------------
// Leitura da NF-e
// ---------------------------------------------------------------------------

/** O que a leitura tira da nota, com os nomes das colunas de `FiscalDocument`. */
export type NotaLida = {
  accessKey: string;
  number: number;
  series: number;
  issuedAt: Date | null;
  operationNature: string | null;
  /** 0 = frete por conta do emitente; 1 = do destinatário; os outros códigos da nota vêm como estão. */
  freightMode: number | null;
  issuerTaxId: string;
  issuerName: string;
  issuerCity: string | null;
  issuerState: string | null;
  issuerAddress: string | null;
  recipientTaxId: string | null;
  recipientName: string | null;
  recipientCity: string | null;
  recipientState: string | null;
  recipientAddress: string | null;
  totalValue: number;
  grossWeight: number | null;
  volumes: number | null;
};

export type LeituraDaNota = { ok: true; nota: NotaLida } | { ok: false; erro: string; grande: boolean };

const recusa = (erro: string, grande = false): LeituraDaNota => ({ ok: false, erro, grande });

/** "Rua das Flores, 120, sala 2, Centro, CEP 15000-000", com o que a nota trouxer. */
function endereco(no: No | undefined): string | null {
  const cep = digitos(campo(no, "CEP"));
  const partes = [
    campo(no, "xLgr"),
    campo(no, "nro"),
    campo(no, "xCpl"),
    campo(no, "xBairro"),
    cep && cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : null,
  ].filter((parte): parte is string => parte !== null);
  return partes.length > 0 ? partes.join(", ").slice(0, 300) : null;
}

const uf = (no: No | undefined) => {
  const valor = campo(no, "UF")?.toUpperCase() ?? null;
  return valor !== null && /^[A-Z]{2}$/.test(valor) ? valor : null;
};

/** O CNPJ; sem ele, o CPF (produtor rural, pessoa física). `null` se não há um nem outro com o tamanho certo. */
function documento(no: No | undefined): string | null {
  // O CNPJ pode ter letras desde 2026 (NT Conjunta 2025.001).
  const cnpj = campo(no, "CNPJ")?.toUpperCase().replace(/[^0-9A-Z]/g, "") ?? null;
  if (cnpj !== null && /^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) return cnpj;
  const cpf = digitos(campo(no, "CPF"));
  return cpf !== null && cpf.length === 11 ? cpf : null;
}

/** Soma os blocos `transp/vol`: uma nota pode trazer um por espécie de embalagem. */
function volumesDaNota(transp: No | undefined): { volumes: number | null; grossWeight: number | null } {
  const blocos = transp?.filhos.filter((f) => f.nome === "vol") ?? [];
  let volumes: number | null = null;
  let peso: number | null = null;
  for (const bloco of blocos) {
    const quantidade = inteiro(campo(bloco, "qVol"));
    const pesoBruto = decimal(campo(bloco, "pesoB"));
    if (quantidade !== null) volumes = (volumes ?? 0) + quantidade;
    if (pesoBruto !== null) peso = (peso ?? 0) + pesoBruto;
  }
  // Três casas, como o campo da nota: a soma de decimais não deixa resto de ponto flutuante.
  return { volumes, grossWeight: peso === null ? null : Math.round(peso * 1000) / 1000 };
}

/**
 * Lê o XML de uma NF-e e devolve os dados da nota, ou o motivo da recusa em
 * uma frase que o operador entende. Aceita a nota com o protocolo (`nfeProc`)
 * ou sozinha (`NFe`), com ou sem prefixo de namespace.
 */
export function lerNfe(xml: unknown): LeituraDaNota {
  if (typeof xml !== "string" || xml.trim() === "") return recusa(XML_AUSENTE);
  if (new TextEncoder().encode(xml).length > LIMITE_DO_XML_BYTES) return recusa(XML_GRANDE, true);

  let raiz: No;
  try {
    raiz = lerXml(xml);
  } catch (erro) {
    if (erro instanceof XmlInvalido) return recusa(`O arquivo não é um XML válido: ${erro.message}.`);
    throw erro;
  }

  const nfe = raiz.nome === "nfeProc" ? filho(raiz, "NFe") : raiz.nome === "NFe" ? raiz : undefined;
  const inf = filho(nfe, "infNFe");
  if (!inf) return recusa(`${NAO_E_NFE} (o elemento principal é <${raiz.nome}>).`);

  const daNota = /^NFe([0-9A-Z]+)$/.exec(inf.atributos.get("Id") ?? "")?.[1] ?? null;
  const noProtocolo = campo(filho(filho(raiz, "protNFe"), "infProt"), "chNFe");
  const doProtocolo = noProtocolo === null ? null : limparChave(noProtocolo);
  const chave = daNota ?? doProtocolo;
  if (chave === null || chave.length !== TAMANHO_DA_CHAVE) return recusa(CHAVE_SEM_44);
  if (!chaveValida(chave)) return recusa(CHAVE_INVALIDA);
  if (daNota !== null && doProtocolo !== null && doProtocolo !== "" && daNota !== doProtocolo) return recusa(CHAVE_DO_PROTOCOLO);

  const ide = filho(inf, "ide");
  const emit = filho(inf, "emit");
  const dest = filho(inf, "dest");
  const transp = filho(inf, "transp");

  const modelo = campo(ide, "mod");
  if (modelo !== "55") {
    return recusa(`Só NF-e (modelo 55) é aceita; este XML é do modelo ${modelo ?? "não informado"}${modelo === "65" ? " (NFC-e)" : ""}.`);
  }

  const numero = inteiro(campo(ide, "nNF"));
  const serie = inteiro(campo(ide, "serie"));
  if (numero === null || serie === null) return recusa("O XML não traz o número e a série da nota.");

  const issuerTaxId = documento(emit);
  const issuerName = campo(emit, "xNome");
  if (issuerTaxId === null || issuerName === null) return recusa("O XML não traz o CNPJ/CPF e a razão social do emitente.");

  const totalValue = decimal(campo(filho(filho(inf, "total"), "ICMSTot"), "vNF"));
  if (totalValue === null) return recusa("O XML não traz o valor total da nota (vNF).");

  const partes = partesDaChave(chave);
  if (partes.modelo !== "55" || partes.numero !== numero || partes.serie !== serie || partes.documentoDoEmitente !== issuerTaxId.padStart(14, "0")) {
    return recusa(CHAVE_NAO_E_DA_NOTA);
  }

  const enderEmit = filho(emit, "enderEmit");
  const enderDest = filho(dest, "enderDest");

  return {
    ok: true,
    nota: {
      accessKey: chave,
      number: numero,
      series: serie,
      issuedAt: emissao(ide),
      operationNature: campo(ide, "natOp"),
      freightMode: inteiro(campo(transp, "modFrete")),
      issuerTaxId,
      issuerName,
      issuerCity: campo(enderEmit, "xMun"),
      issuerState: uf(enderEmit),
      issuerAddress: endereco(enderEmit),
      recipientTaxId: documento(dest),
      recipientName: campo(dest, "xNome"),
      recipientCity: campo(enderDest, "xMun"),
      recipientState: uf(enderDest),
      recipientAddress: endereco(enderDest),
      totalValue,
      ...volumesDaNota(transp),
    },
  };
}

// ---------------------------------------------------------------------------
// Emitente e destinatário da nota, para o CT-e
// ---------------------------------------------------------------------------

/** O endereço como a nota traz, campo a campo (o CT-e pede assim, com o código IBGE do município). */
export type EnderecoDaNota = {
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  /** Código IBGE do município, 7 dígitos. */
  codigoMunicipio: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
};

export type ParticipanteDaNota = {
  /** CNPJ (14) ou CPF (11), só dígitos. */
  documento: string | null;
  /** Inscrição estadual: só dígitos, ou "ISENTO". */
  ie: string | null;
  nome: string | null;
  fantasia: string | null;
  telefone: string | null;
  endereco: EnderecoDaNota;
};

export type ParticipantesDaNota = { emitente: ParticipanteDaNota; destinatario: ParticipanteDaNota; produto: string | null };

function inscricao(no: No | undefined): string | null {
  const valor = campo(no, "IE")?.toUpperCase() ?? null;
  if (valor === null) return null;
  if (valor === "ISENTO") return valor;
  const numeros = valor.replace(/\D/g, "");
  return numeros.length >= 2 && numeros.length <= 14 ? numeros : null;
}

function enderecoEmCampos(no: No | undefined): EnderecoDaNota {
  const codigo = digitos(campo(no, "cMun"));
  const cep = digitos(campo(no, "CEP"));
  return {
    logradouro: campo(no, "xLgr", 255),
    numero: campo(no, "nro", 60),
    complemento: campo(no, "xCpl", 60),
    bairro: campo(no, "xBairro", 60),
    codigoMunicipio: codigo !== null && codigo.length === 7 ? codigo : null,
    municipio: campo(no, "xMun", 60),
    uf: uf(no),
    cep: cep !== null && cep.length === 8 ? cep : null,
  };
}

function participante(no: No | undefined, endereco: No | undefined): ParticipanteDaNota {
  const telefone = digitos(campo(endereco, "fone"));
  return {
    documento: documento(no),
    ie: inscricao(no),
    nome: campo(no, "xNome", 60),
    fantasia: campo(no, "xFant", 60),
    telefone: telefone !== null && telefone.length >= 6 && telefone.length <= 14 ? telefone : null,
    endereco: enderecoEmCampos(endereco),
  };
}

/**
 * O emitente e o destinatário de uma NF-e já importada, com a inscrição
 * estadual e o endereço campo a campo, e a descrição do primeiro produto. É o
 * que a emissão do CT-e precisa da nota e que `FiscalDocument` não guarda em
 * colunas. `null` quando o texto não é o XML de uma NF-e.
 */
export function participantesDaNota(xml: string): ParticipantesDaNota | null {
  let raiz: No;
  try {
    raiz = lerXml(xml);
  } catch (erro) {
    if (erro instanceof XmlInvalido) return null;
    throw erro;
  }
  const nfe = raiz.nome === "nfeProc" ? filho(raiz, "NFe") : raiz.nome === "NFe" ? raiz : undefined;
  const inf = filho(nfe, "infNFe");
  if (!inf) return null;
  const emit = filho(inf, "emit");
  const dest = filho(inf, "dest");
  return {
    emitente: participante(emit, filho(emit, "enderEmit")),
    destinatario: participante(dest, filho(dest, "enderDest")),
    produto: campo(filho(filho(inf, "det"), "prod"), "xProd", 60),
  };
}

// ---------------------------------------------------------------------------
// Sugestão da carga
// ---------------------------------------------------------------------------

export type ClienteParaSugestao = { id: string; cnpj: string; active: boolean };

export type PapelNaNota = "EMITENTE" | "DESTINATARIO";

/** A carga que a nota sugere. O operador confere, completa o que faltar e confirma. */
export type SugestaoDeCarga = {
  /** Cliente pagador: o cadastro cujo CNPJ é o do emitente ou o do destinatário. `null`: o operador escolhe. */
  clientId: string | null;
  pagador: PapelNaNota | null;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number | null;
  weight: number | null;
  invoiceKey: string;
  invoiceValue: number;
  /** O que o operador precisa resolver antes de confirmar. */
  avisos: string[];
  // O endereço de entrega, lido do endereço do destinatário da nota (src/lib/endereco.ts).
} & EnderecoDaEntrega;

const AVISO_SEM_CLIENTE = "Nenhum cliente cadastrado tem o CNPJ do emitente ou do destinatário: escolha o cliente pagador.";
const AVISO_DOIS_CLIENTES = "Emitente e destinatário são clientes cadastrados e a nota não diz quem paga o frete: escolha o cliente pagador.";
const AVISO_SEM_VOLUMES = "A nota não informa a quantidade de volumes: preencha.";
const AVISO_SEM_PESO = "A nota não informa o peso bruto: preencha.";
const AVISO_SEM_DESTINATARIO = "A nota não traz o destinatário completo: preencha o que faltar.";

/** "Cidade - UF", que é como as cargas guardam origem e destino. */
export function cidadeUf(cidade: string | null, estado: string | null): string {
  return [cidade, estado].filter((parte) => parte !== null && parte !== "").join(" - ");
}

const mesmoDocumento = (a: string, b: string | null) => b !== null && a.replace(/\D/g, "") === b;

/**
 * Monta a carga a partir da nota. O cliente pagador é o cadastro ativo cujo
 * CNPJ bate com o emitente ou com o destinatário; se os dois são clientes,
 * decide a modalidade do frete da nota (0 = por conta do emitente, 1 = do
 * destinatário), e sem ela ninguém é escolhido.
 */
export function sugerirCarga(nota: NotaLida, clientes: readonly ClienteParaSugestao[]): SugestaoDeCarga {
  const ativos = clientes.filter((cliente) => cliente.active);
  const emitente = ativos.find((cliente) => mesmoDocumento(cliente.cnpj, nota.issuerTaxId)) ?? null;
  const destinatario = ativos.find((cliente) => mesmoDocumento(cliente.cnpj, nota.recipientTaxId)) ?? null;

  const avisos: string[] = [];
  let pagador: PapelNaNota | null = null;
  if (emitente && destinatario && emitente.id !== destinatario.id) {
    if (nota.freightMode === 0) pagador = "EMITENTE";
    else if (nota.freightMode === 1) pagador = "DESTINATARIO";
    else avisos.push(AVISO_DOIS_CLIENTES);
  } else if (emitente) {
    pagador = "EMITENTE";
  } else if (destinatario) {
    pagador = "DESTINATARIO";
  } else {
    avisos.push(AVISO_SEM_CLIENTE);
  }

  const destination = cidadeUf(nota.recipientCity, nota.recipientState);
  if (nota.recipientName === null || destination === "") avisos.push(AVISO_SEM_DESTINATARIO);
  // A carga pede ao menos um volume e peso maior que zero: zero na nota é o mesmo que não informado.
  const volumes = nota.volumes !== null && nota.volumes > 0 ? nota.volumes : null;
  const weight = nota.grossWeight !== null && nota.grossWeight > 0 ? nota.grossWeight : null;
  if (volumes === null) avisos.push(AVISO_SEM_VOLUMES);
  if (weight === null) avisos.push(AVISO_SEM_PESO);

  return {
    clientId: pagador === "EMITENTE" ? emitente!.id : pagador === "DESTINATARIO" ? destinatario!.id : null,
    pagador,
    sender: nota.issuerName,
    receiver: nota.recipientName ?? "",
    origin: cidadeUf(nota.issuerCity, nota.issuerState),
    destination,
    volumes,
    weight,
    invoiceKey: nota.accessKey,
    invoiceValue: nota.totalValue,
    avisos,
    ...enderecoDoTexto(nota.recipientAddress),
  };
}

// ---------------------------------------------------------------------------
// O que as rotas devolvem e aceitam
// ---------------------------------------------------------------------------

const CARGA_DA_NOTA_SELECT = { id: true, trackingCode: true, status: true, origin: true, destination: true } as const;

/** A nota como a lista e a tela a recebem: tudo o que foi lido, menos o XML. */
export const NOTA_SELECT = {
  id: true,
  accessKey: true,
  number: true,
  series: true,
  issuedAt: true,
  operationNature: true,
  freightMode: true,
  issuerTaxId: true,
  issuerName: true,
  issuerCity: true,
  issuerState: true,
  issuerAddress: true,
  recipientTaxId: true,
  recipientName: true,
  recipientCity: true,
  recipientState: true,
  recipientAddress: true,
  totalValue: true,
  grossWeight: true,
  volumes: true,
  createdAt: true,
  collection: { select: CARGA_DA_NOTA_SELECT },
} as const;

export type CargaDaNota = { id: string; trackingCode: string | null; status: string; origin: string; destination: string };

/** A nota como chega à tela (datas em texto). */
export type NotaImportada = Omit<NotaLida, "issuedAt"> & {
  id: string;
  issuedAt: string | null;
  createdAt: string;
  collection: CargaDaNota | null;
};

export const NOTA_NAO_ENCONTRADA = "Nota não encontrada.";
export const NOTA_JA_IMPORTADA = "Esta nota já foi importada.";
export const NOTA_JA_LIGADA = "Esta nota já está ligada a uma carga.";
export const CARGA_NAO_ENCONTRADA = "Nenhuma carga com este código de rastreio.";
export const CARGA_COM_OUTRA_CHAVE = "A carga tem outra chave de NF-e: esta nota não é dela.";
export const CARGA_JA_EXISTE = "Já existe uma carga com a chave desta nota. Ligue a nota a ela em vez de criar outra.";
export const MAXIMO_DE_NOTAS_NA_LISTA = 200;

/**
 * Filtro da lista de notas: chave (inteira ou um trecho), número, CNPJ/CPF do
 * emitente ou do destinatário, ou um pedaço da razão social. Em branco, tudo.
 */
export function filtroDeNotas(busca: string | null | undefined) {
  const texto = (busca ?? "").trim().slice(0, 100);
  if (texto === "") return {};

  const numeros = texto.replace(/\D/g, "");
  // Texto que é só número e pontuação (chave colada com espaços, CNPJ com máscara) busca por número.
  const soNumeros = numeros !== "" && /^[\d\s./-]+$/.test(texto);
  if (!soNumeros) {
    return {
      OR: [
        { issuerName: { contains: texto, mode: "insensitive" as const } },
        { recipientName: { contains: texto, mode: "insensitive" as const } },
      ],
    };
  }

  return {
    OR: [
      { accessKey: { contains: numeros } },
      { issuerTaxId: { contains: numeros } },
      { recipientTaxId: { contains: numeros } },
      ...(numeros.length <= 9 ? [{ number: Number(numeros) }] : []),
    ],
  };
}

export const importarNotaSchema = z.object({ xml: z.string(XML_AUSENTE).min(1, XML_AUSENTE) }, XML_AUSENTE);

/**
 * Confirmação da carga sugerida. Os campos são os da criação pelo painel
 * (src/lib/coletas.ts), menos a chave e o valor da NF, que vêm da nota e não
 * do formulário, e o motorista, que entra depois pelo manifesto.
 */
export const criarCargaDaNotaSchema = createCollectionSchema.omit({ invoiceKey: true, invoiceValue: true, driverId: true });

const CODIGO_MESSAGE = "Informe o código de rastreio da carga (10 dígitos).";

export const ligarNotaSchema = z.object(
  { trackingCode: z.string(CODIGO_MESSAGE).trim().min(1, CODIGO_MESSAGE).max(40, CODIGO_MESSAGE) },
  CODIGO_MESSAGE,
);

/** Nome do arquivo no download: a chave, que é como o XML da nota costuma ser guardado. */
export const nomeDoArquivoXml = (chave: string) => `${chave.replace(/\D/g, "")}-nfe.xml`;

// ---------------------------------------------------------------------------
// CT-e: registro manual do que foi emitido em outro sistema
// ---------------------------------------------------------------------------

// O registro manual do número e da chave de um CT-e emitido em outro sistema.
// A emissão pelo próprio TMS está em src/lib/cte.ts e src/lib/cte/.

/** Cargas que já saíram: é a partir da saída que o CT-e precisa existir. */
export const STATUS_COM_CTE = ["ROUTE", "DELIVERED"] as const;

export const MODELO_CTE = "57";

const CTE_NUMERO_MESSAGE = "O número do CT-e precisa ser um inteiro entre 1 e 999999999.";
const CTE_CHAVE_MESSAGE = "A chave do CT-e precisa ter 44 dígitos.";
const CTE_CHAVE_INVALIDA = "A chave do CT-e é inválida: o dígito verificador não confere.";
const CTE_CHAVE_DE_OUTRO_MODELO = "Esta chave não é de CT-e (modelo 57). Confira se não é a chave da NF-e.";
const CTE_CHAVE_DE_OUTRO_NUMERO = "O número informado não é o que está na chave do CT-e.";
const CTE_INCOMPLETO = "Informe o número e a chave do CT-e, ou deixe os dois em branco para desfazer o registro.";
export const CTE_CARGA_NAO_ENCONTRADA = "Carga não encontrada.";
export const CTE_CARGA_NAO_SAIU = "Só carga em rota ou entregue recebe o registro de CT-e.";
export const CTE_CHAVE_REPETIDA = "Esta chave de CT-e já está registrada em outra carga.";

const vazioParaNulo = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? null : valor);

/**
 * Registro manual de CT-e. Número e chave juntos gravam; os dois em branco
 * (ou `null`) desfazem o registro. A chave é conferida: 44 dígitos, dígito
 * verificador, modelo 57 e o mesmo número informado.
 */
export const registrarCteSchema = z
  .object(
    {
      collectionId: z.string("Informe a carga.").trim().min(1, "Informe a carga.").max(64, "Carga inválida."),
      cteNumber: z.preprocess(
        (valor) => {
          const limpo = vazioParaNulo(valor);
          return typeof limpo === "string" && /^\d{1,9}$/.test(limpo.trim()) ? Number(limpo.trim()) : limpo;
        },
        z.number(CTE_NUMERO_MESSAGE).int(CTE_NUMERO_MESSAGE).min(1, CTE_NUMERO_MESSAGE).max(999999999, CTE_NUMERO_MESSAGE).nullable(),
      ),
      cteKey: z.preprocess(
        (valor) => {
          const limpo = vazioParaNulo(valor);
          return typeof limpo === "string" ? limparChave(limpo) : limpo;
        },
        z.string(CTE_CHAVE_MESSAGE).length(TAMANHO_DA_CHAVE, CTE_CHAVE_MESSAGE).nullable(),
      ),
    },
    "Dados inválidos.",
  )
  .superRefine((dados, ctx) => {
    if ((dados.cteNumber === null) !== (dados.cteKey === null)) {
      ctx.addIssue({ code: "custom", message: CTE_INCOMPLETO });
      return;
    }
    if (dados.cteKey === null || dados.cteNumber === null) return;
    if (!chaveValida(dados.cteKey)) {
      ctx.addIssue({ code: "custom", message: CTE_CHAVE_INVALIDA });
      return;
    }
    const partes = partesDaChave(dados.cteKey);
    if (partes.modelo !== MODELO_CTE) ctx.addIssue({ code: "custom", message: CTE_CHAVE_DE_OUTRO_MODELO });
    else if (partes.numero !== dados.cteNumber) ctx.addIssue({ code: "custom", message: CTE_CHAVE_DE_OUTRO_NUMERO });
  });

/** A carga como a tela de CT-e a lista: os dados que um CT-e precisa e a situação do registro. A rota acrescenta `emitido`. */
export const CARGA_PARA_CTE_SELECT = {
  id: true,
  trackingCode: true,
  status: true,
  sender: true,
  receiver: true,
  origin: true,
  destination: true,
  volumes: true,
  weight: true,
  invoiceKey: true,
  invoiceValue: true,
  freightValue: true,
  cteKey: true,
  cteNumber: true,
  cteStatus: true,
  updatedAt: true,
  client: { select: { id: true, companyName: true, tradeName: true, cnpj: true } },
} as const;

export type CargaParaCte = {
  id: string;
  trackingCode: string | null;
  status: string;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  invoiceKey: string | null;
  invoiceValue: number | null;
  freightValue: number | null;
  cteKey: string | null;
  cteNumber: number | null;
  cteStatus: string | null;
  updatedAt: string;
  client: { id: string; companyName: string; tradeName: string | null; cnpj: string };
  /** O CT-e mais recente que ESTE sistema montou para a carga (src/lib/cte.ts), se houver. */
  emitido: CteEmitido | null;
};

/** Só há CT-e registrado quando a carga tem a chave e a situação diz emitido. */
export const cteRegistrado = (carga: { cteKey: string | null; cteStatus: string | null }) =>
  carga.cteKey !== null && carga.cteStatus === "ISSUED";

/** O que falta na carga para um CT-e poder ser emitido lá fora com os dados daqui. */
export function pendenciasParaCte(carga: Pick<CargaParaCte, "invoiceKey" | "invoiceValue" | "freightValue">): string[] {
  const faltas: string[] = [];
  if (!carga.invoiceKey) faltas.push("chave da NF-e");
  if (carga.invoiceValue === null) faltas.push("valor da mercadoria");
  if (carga.freightValue === null) faltas.push("valor do frete");
  return faltas;
}

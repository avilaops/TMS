import { z } from "zod";
import { normalizeText } from "@/lib/normalization";
import { enderecoDoPagador } from "@/lib/cobranca-gateway";
import { UFS } from "@/lib/roteiro";

/**
 * Endereço da entrega: os quatro campos que a carga guarda além da cidade
 * (`destination`), como são validados, mostrados e transformados na chave do
 * cache de localização.
 *
 * Tudo aqui é puro e também é importado pelas telas: nada daqui pode puxar o
 * que só existe no servidor. Quem procura a coordenada é src/lib/geo.ts (o
 * cliente do Nominatim) e src/lib/geo-db.ts (cache e segundo plano).
 */

export type EnderecoDaEntrega = {
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryDistrict: string | null;
  deliveryZip: string | null;
};

export const SEM_ENDERECO: EnderecoDaEntrega = { deliveryStreet: null, deliveryNumber: null, deliveryDistrict: null, deliveryZip: null };

/* ---------------------------------- Validação --------------------------------- */

const RUA_MESSAGE = "Logradouro muito longo (máximo de 200 letras).";
const NUMERO_MESSAGE = "Número do endereço muito longo (máximo de 20 letras).";
const BAIRRO_MESSAGE = "Bairro muito longo (máximo de 100 letras).";
const CEP_MESSAGE = "O CEP precisa ter 8 dígitos.";

const emBrancoViraNulo = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? null : valor);

const textoOpcional = (maximo: number, mensagem: string) =>
  z.preprocess(emBrancoViraNulo, z.string(mensagem).trim().max(maximo, mensagem).nullish());

// Guarda só os dígitos: o CEP chega com hífen e ponto quando é colado.
const cep = z.preprocess(
  emBrancoViraNulo,
  z
    .string(CEP_MESSAGE)
    .transform((valor) => valor.replace(/\D/g, ""))
    .pipe(z.string().length(8, CEP_MESSAGE))
    .nullish(),
);

/**
 * Os campos do endereço, para os schemas da carga (painel, portal e NF-e).
 * Vazio vira `null` (apaga); ausente não mexe.
 */
export const CAMPOS_DE_ENDERECO = {
  deliveryStreet: textoOpcional(200, RUA_MESSAGE),
  deliveryNumber: textoOpcional(20, NUMERO_MESSAGE),
  deliveryDistrict: textoOpcional(100, BAIRRO_MESSAGE),
  deliveryZip: cep,
} as const;

/** O que o portal manda além dos dados da carga (que a rota dele confere à mão). */
export const enderecoDaEntregaSchema = z.object(CAMPOS_DE_ENDERECO, "Dados inválidos.");

/* ----------------------------------- Mostrar ---------------------------------- */

/** "15130-000", ou vazio quando não há 8 dígitos. */
export function cepFormatado(cepDaCarga: string | null | undefined): string {
  const digitos = (cepDaCarga ?? "").replace(/\D/g, "");
  return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : "";
}

/** "Rua das Flores, 120 - Centro": o endereço sem a cidade. Vazio quando a carga não tem logradouro nem bairro. */
export function enderecoEmLinha(endereco: Partial<EnderecoDaEntrega>): string {
  const rua = [endereco.deliveryStreet, endereco.deliveryNumber].filter(Boolean).join(", ");
  return [rua, endereco.deliveryDistrict].filter(Boolean).join(" - ");
}

/**
 * O endereço inteiro, como vai para o link do Google Maps e para o cartão do
 * motorista: "Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000". Sem
 * logradouro é só a cidade, como era antes de existir endereço.
 */
export function enderecoCompleto(endereco: Partial<EnderecoDaEntrega>, cidade: string): string {
  const linha = enderecoEmLinha(endereco);
  if (!endereco.deliveryStreet) return cidade;
  return [linha, cidade, cepFormatado(endereco.deliveryZip)].filter(Boolean).join(", ");
}

/* ------------------------------ Chave do cache -------------------------------- */

const semPontuacao = (texto: string | null | undefined) =>
  normalizeText(texto ?? "")
    .replace(/['’`´]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();

// As abreviações que mais variam de um cadastro para outro. Só a primeira
// palavra: "R. das Flores" e "Rua das Flores" são a mesma pergunta; "Dr" no
// meio do nome fica como está.
const TIPOS_DE_LOGRADOURO: Record<string, string> = {
  r: "rua",
  av: "avenida",
  avda: "avenida",
  al: "alameda",
  rod: "rodovia",
  estr: "estrada",
  tv: "travessa",
  trav: "travessa",
  pc: "praca",
  pca: "praca",
};

/** O logradouro como entra na chave e na consulta: sem acento, sem pontuação, com o tipo por extenso. */
export function logradouroNormalizado(rua: string | null | undefined): string {
  const palavras = semPontuacao(rua).split(" ").filter(Boolean);
  if (palavras.length > 1 && TIPOS_DE_LOGRADOURO[palavras[0]]) palavras[0] = TIPOS_DE_LOGRADOURO[palavras[0]];
  return palavras.join(" ");
}

/** "S/N", "sn", "s/nº" e vazio são endereço sem número. */
export function numeroNormalizado(numero: string | null | undefined): string {
  const limpo = semPontuacao(numero);
  return /^(s ?n[o°º]?|sem numero)?$/.test(limpo) ? "" : limpo;
}

/** O que identifica um endereço para a localização: o que vai na pergunta ao serviço, e mais nada. */
export type EnderecoParaLocalizar = { rua: string; numero: string | null; cidade: string; uf: string };

/**
 * A chave do endereço no cache (`GeoCache.key`): "rua das flores 120|mirassol|sp".
 *
 * Entra só o que vai na pergunta ao serviço de localização (logradouro, número,
 * cidade e UF). Bairro e CEP ficam de fora de propósito: não entram na consulta
 * (no OpenStreetMap do Brasil eles faltam ou divergem, e a consulta com eles
 * volta vazia), então dois cadastros do mesmo endereço com bairros escritos de
 * jeitos diferentes dão a mesma chave e uma consulta só.
 *
 * `null` quando não há o que perguntar: sem logradouro ou sem cidade.
 */
export function chaveDoEndereco(endereco: EnderecoParaLocalizar): string | null {
  const rua = logradouroNormalizado(endereco.rua);
  const cidade = semPontuacao(endereco.cidade);
  const uf = semPontuacao(endereco.uf);
  if (!rua || !cidade || !uf) return null;
  const numero = numeroNormalizado(endereco.numero);
  return `${[rua, numero].filter(Boolean).join(" ")}|${cidade}|${uf}`;
}

/* --------------------------- Endereço num texto só ---------------------------- */

const CEP_NO_TEXTO = /(?:\bCEP\b:?\s*)?(?<!\d)(\d{5})-?(\d{3})(?!\d)/i;
const NUMERO_DE_PORTA = /^(\d{1,6}\s?[A-Za-z]?|s\/?n[º°o]?)$/i;

const ehUf = (trecho: string) => (UFS as readonly string[]).includes(trecho.toUpperCase());

/**
 * Lê um endereço escrito num texto só nas partes da carga. Serve para os
 * textos que o sistema já tem:
 *
 * - o do cadastro, no formato que a busca por CNPJ preenche ("Rua, número -
 *   Bairro, Cidade - UF, CEP 00000-000"): este é lido pela mesma função que
 *   monta o endereço do boleto (`enderecoDoPagador`, src/lib/cobranca-gateway.ts);
 * - o da NF-e (`src/lib/nfe.ts`): "Rua das Flores, 120, sala 2, Centro, CEP 15000-000";
 * - o que a pessoa digitou no destinatário frequente do portal: "Rua das Flores, 120 - Centro".
 *
 * Fora do formato do cadastro é uma sugestão para a pessoa conferir no
 * formulário, não uma leitura exata: o primeiro trecho é o logradouro; o
 * seguinte, se parece número de porta, é o número; o último que sobra é o
 * bairro (o do meio, complemento, fica de fora). Cidade e UF escritas no fim
 * saem: a carga já tem a cidade. Sem vírgula nem " - ", o texto inteiro vai
 * para o logradouro.
 */
export function enderecoDoTexto(texto: string | null | undefined): EnderecoDaEntrega {
  let resto = (texto ?? "").replace(/\s+/g, " ").trim();
  if (resto === "") return { ...SEM_ENDERECO };

  const doCadastro = enderecoDoPagador(resto).endereco;
  if (doCadastro) {
    return {
      deliveryStreet: doCadastro.street_name.slice(0, 200),
      deliveryNumber: doCadastro.street_number.slice(0, 20),
      deliveryDistrict: doCadastro.neighborhood.slice(0, 100),
      deliveryZip: doCadastro.zip_code,
    };
  }

  const cepAchado = resto.match(CEP_NO_TEXTO);
  if (cepAchado) resto = resto.replace(cepAchado[0], " ");

  const trechos = resto
    .split(/,| - /)
    .map((trecho) => trecho.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (trechos.length === 0) return { ...SEM_ENDERECO, deliveryZip: cepAchado ? `${cepAchado[1]}${cepAchado[2]}` : null };

  // "…, Mirassol - SP" no fim: a UF sai e, com ela, a cidade (se não for o número da porta nem o próprio logradouro).
  if (trechos.length > 1 && ehUf(trechos[trechos.length - 1])) {
    trechos.pop();
    if (trechos.length > 1 && !NUMERO_DE_PORTA.test(trechos[trechos.length - 1])) trechos.pop();
  }

  const [rua, ...depois] = trechos;
  const temNumero = depois.length > 0 && NUMERO_DE_PORTA.test(depois[0]);
  const numero = temNumero ? depois[0] : null;
  const sobra = temNumero ? depois.slice(1) : depois;
  const bairro = sobra.length > 0 ? sobra[sobra.length - 1] : null;

  return {
    deliveryStreet: rua.slice(0, 200),
    deliveryNumber: numero ? numero.slice(0, 20) : null,
    deliveryDistrict: bairro ? bairro.slice(0, 100) : null,
    deliveryZip: cepAchado ? `${cepAchado[1]}${cepAchado[2]}` : null,
  };
}

/** Algum campo do endereço (ou a cidade) veio no corpo e difere do gravado: a coordenada antiga deixa de valer. */
export function enderecoMudou(
  antes: EnderecoDaEntrega & { destination: string },
  corpo: Partial<EnderecoDaEntrega> & { destination?: string },
): boolean {
  const campos = ["deliveryStreet", "deliveryNumber", "deliveryDistrict", "deliveryZip", "destination"] as const;
  return campos.some((campo) => corpo[campo] !== undefined && (corpo[campo] ?? null) !== (antes[campo] ?? null));
}

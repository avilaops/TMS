/**
 * Pix Copia e Cola estático (BR Code, o padrão EMV do Banco Central).
 *
 * É só texto: a transportadora cadastra a chave e o recebedor, e o sistema
 * monta o código com o valor do título. Não fala com banco nenhum, então o
 * pagamento NÃO dá baixa sozinho: quem recebe confere o extrato e dá a baixa à
 * mão, como sempre.
 *
 * Tudo aqui é conta pura. Este arquivo também é importado pela tela, então não
 * pode puxar nada que só exista no servidor.
 *
 * Campos do código, na ordem: 00 (versão), 26 (conta: GUI `br.gov.bcb.pix` +
 * chave), 52 (categoria), 53 (moeda, 986 = real), 54 (valor), 58 (país),
 * 59 (nome), 60 (cidade), 62 (txid) e 63 (CRC16 de tudo o que vem antes).
 */

export const TIPOS_DE_CHAVE = ["CPF", "CNPJ", "EMAIL", "TELEFONE", "ALEATORIA"] as const;
export type TipoDeChave = (typeof TIPOS_DE_CHAVE)[number];

export const TIPO_DE_CHAVE_LABEL: Record<TipoDeChave, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "E-mail",
  TELEFONE: "Telefone",
  ALEATORIA: "Chave aleatória",
};

/** Limites do padrão para o nome do recebedor, a cidade e o identificador. */
export const LIMITE_DO_NOME = 25;
export const LIMITE_DA_CIDADE = 15;
export const LIMITE_DO_TXID = 25;
// O campo 26 comporta 99 caracteres; tirando a GUI e os cabeçalhos, sobram 77 para a chave.
const LIMITE_DA_CHAVE = 77;

/** O que as telas dizem ao lado do código, para ninguém esperar baixa automática. */
export const AVISO_PIX_ESTATICO =
  "Pix estático: o pagamento não dá baixa sozinho. A transportadora confere o recebimento e dá a baixa manualmente.";

const soDigitos = (texto: string) => texto.replace(/\D/g, "");

// Dígito verificador do CPF e do CNPJ: soma ponderada, resto de 11.
function digito(numeros: string, pesos: number[]): number {
  const soma = pesos.reduce((total, peso, i) => total + peso * Number(numeros[i]), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const primeiro = digito(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return primeiro === Number(cpf[9]) && segundo === Number(cpf[10]);
}

function cnpjValido(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const primeiro = digito(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return primeiro === Number(cnpj[12]) && segundo === Number(cnpj[13]);
}

/**
 * A chave como o banco a espera, ou `null` quando o formato não serve para o
 * tipo: CPF e CNPJ só com dígitos (e dígito verificador certo), e-mail em
 * minúsculas, telefone como `+55` + DDD + número, aleatória como UUID.
 */
export function normalizarChave(tipo: TipoDeChave, chave: string): string | null {
  const texto = chave.trim();
  switch (tipo) {
    case "CPF": {
      const cpf = soDigitos(texto);
      return cpfValido(cpf) ? cpf : null;
    }
    case "CNPJ": {
      const cnpj = soDigitos(texto);
      return cnpjValido(cnpj) ? cnpj : null;
    }
    case "EMAIL": {
      const email = texto.toLowerCase();
      return email.length <= LIMITE_DA_CHAVE && /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email) ? email : null;
    }
    case "TELEFONE": {
      // Aceita "(17) 99999-8888", "17999998888" e "+55 17 99999-8888".
      const digitos = soDigitos(texto);
      const nacional = digitos.length > 11 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
      return /^[1-9]\d(9\d{8}|[2-5]\d{7})$/.test(nacional) ? `+55${nacional}` : null;
    }
    case "ALEATORIA": {
      const uuid = texto.toLowerCase();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) ? uuid : null;
    }
  }
}

/**
 * Texto como o código aceita: sem acento, só letras, números e espaço, e
 * cortado no limite. Aplicativo de banco recusa código com caractere de fora.
 */
export function textoDoCodigo(texto: string, limite: number): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limite)
    .trim();
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), em quatro dígitos hexadecimais maiúsculos. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i += 1) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Cada campo é identificador (2) + tamanho (2) + valor. O valor é sempre ASCII
// aqui, então o tamanho em caracteres é o tamanho em bytes.
const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, "0")}${valor}`;

/** Identificador da cobrança no código: só letras e números, até 25. Vazio vira `***` (sem identificador). */
export function txidValido(txid: string | null | undefined): string {
  const limpo = (txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, LIMITE_DO_TXID);
  return limpo || "***";
}

/** `FAT000123`: a fatura nº 123. É o que o recebedor vê no extrato. */
export const txidDaFatura = (numero: number) => txidValido(`FAT${String(numero).padStart(6, "0")}`);

/** Título sem fatura (lançamento manual): `TIT` + o começo do id. */
export const txidDoTitulo = (id: string) => txidValido(`TIT${id.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`);

export type Recebedor = { chave: string; nome: string; cidade: string };

export type CobrancaPix = Recebedor & {
  /** Valor em reais. Sem valor (ou zero), o pagador digita quanto quer pagar. */
  valor?: number | null;
  txid?: string | null;
};

/**
 * Monta o Pix Copia e Cola. `chave` já vem normalizada (`normalizarChave`);
 * nome e cidade são limpos e cortados aqui.
 */
export function pixCopiaECola({ chave, nome, cidade, valor, txid }: CobrancaPix): string {
  const partes = [
    campo("00", "01"),
    campo("26", campo("00", "br.gov.bcb.pix") + campo("01", chave)),
    campo("52", "0000"),
    campo("53", "986"),
  ];
  if (typeof valor === "number" && Number.isFinite(valor) && valor > 0) {
    partes.push(campo("54", valor.toFixed(2)));
  }
  partes.push(
    campo("58", "BR"),
    campo("59", textoDoCodigo(nome, LIMITE_DO_NOME)),
    campo("60", textoDoCodigo(cidade, LIMITE_DA_CIDADE)),
    campo("62", campo("05", txidValido(txid))),
  );
  const semCrc = `${partes.join("")}6304`;
  return semCrc + crc16(semCrc);
}

/** Colunas da empresa que formam o recebedor, para o `select` de quem lê. */
export const RECEBEDOR_SELECT = { pixKey: true, pixName: true, pixCity: true } as const;

/** O recebedor da empresa, ou `null` enquanto ela não cadastrou a chave. */
export function recebedorDaEmpresa(
  empresa: { pixKey: string | null; pixName: string | null; pixCity: string | null } | null | undefined,
): Recebedor | null {
  if (!empresa?.pixKey || !empresa.pixName || !empresa.pixCity) return null;
  return { chave: empresa.pixKey, nome: empresa.pixName, cidade: empresa.pixCity };
}

/**
 * O Pix Copia e Cola de um título a receber: o valor é o do título e o
 * identificador é a fatura (`FAT000123`) ou, sem fatura, o próprio título.
 * Sem recebedor cadastrado não há código.
 */
export function pixDoTitulo(
  recebedor: Recebedor | null,
  titulo: { id: string; amount: number; invoice?: { number: number } | null },
): string | null {
  if (!recebedor || !(titulo.amount > 0)) return null;
  return pixCopiaECola({
    ...recebedor,
    valor: titulo.amount,
    txid: titulo.invoice ? txidDaFatura(titulo.invoice.number) : txidDoTitulo(titulo.id),
  });
}

import { z } from "zod";
import { cnpjValido } from "@/lib/cte";
import { CODIGO_DA_UF, MODELO_DO_CTE } from "@/lib/cte/chave";
import { chaveValida, limparChave } from "@/lib/chave-dfe";
import { diaNoBrasil } from "@/lib/financeiro";
import { emissorDaChave } from "@/lib/redespacho";

/**
 * Subcontratação contratada: esta empresa contrata uma transportadora parceira
 * para fazer o transporte no veículo dela. É o lado inverso de
 * src/lib/redespacho.ts (lá, outra transportadora contrata esta).
 *
 * O que este sistema faz aqui é GUARDAR as chaves dos documentos que a
 * subcontratada emitiu (o CT-e de subcontratação dela, por carga, e o MDF-e
 * dela, por UF de descarregamento) no contrato de frete da viagem. Nada é
 * emitido nem transmitido por este sistema em nome dela.
 *
 * Quem emite o quê, e de onde saiu:
 * - O CT-e desta empresa (a contratante) continua sendo o de sempre, com o tipo
 *   de serviço normal: o CT-e da subcontratada o referencia como documento
 *   anterior. Fonte: MOC do CT-e 4.00, Visão Geral, evento 440150 ("Autorizado
 *   Subcontratação", registrado pelo fisco no CT-e relacionado) e Anexo I, regra
 *   G069; Ajuste SINIEF 09/07, cláusula décima oitava-A, § 1º, XX, na redação do
 *   Ajuste SINIEF 10/16 ("registro de que um CT-e de subcontratação foi
 *   referenciado em um CT-e com tipo de serviço normal").
 * - A subcontratada emite o conhecimento dela: Convênio SINIEF 06/89, art. 17,
 *   § 7º, na redação do Ajuste SINIEF 03/02 ("A empresa subcontratada deverá
 *   emitir o Conhecimento de Transporte indicando, no campo 'Observações', a
 *   informação de que se trata de serviço de subcontratação [...] podendo, a
 *   critério do fisco, a prestação do serviço ser acobertada somente pelo
 *   conhecimento de que trata o § 3º"). Como a UF pode dispensar, a falta do
 *   CT-e da subcontratada é AVISO, nunca bloqueio.
 * - O MDF-e é de UM dos dois: Ajuste SINIEF 21/10, cláusula terceira, § 6º
 *   ("Nos casos de subcontratação, o MDF-e deverá ser emitido exclusivamente
 *   pelo transportador responsável pelo gerenciamento deste serviço, assim
 *   entendido aquele que detenha as informações do veículo, da carga e sua
 *   documentação, do motorista e da logística do transporte"). A norma NÃO diz
 *   "a subcontratada": diz quem gerencia o serviço, e isso é um fato da
 *   operação que o sistema não sabe. Por isso a saída da viagem aceita, para
 *   cada UF de descarregamento, o MDF-e desta empresa OU a chave do MDF-e da
 *   subcontratada registrada aqui (o registro é o ato explícito, e fica na
 *   Auditoria). Sem registro nenhum, vale a regra de sempre: o MDF-e é meu.
 *
 * O que foi lido e onde: o MOC do CT-e 4.00 e o MOC do MDF-e 3.00b, nos
 * arquivos dos portais (o do MDF-e não trata de subcontratação: nenhuma regra
 * do Anexo I exige que o emitente do MDF-e seja o do CT-e relacionado). Os
 * Ajustes SINIEF 21/10, 03/02, 10/16 e 15/89 foram lidos em REPUBLICAÇÃO
 * (LegisWeb), em 12/10/2026: o site do CONFAZ não respondeu. O texto
 * consolidado do Convênio SINIEF 06/89 (art. 17, § 3º e redação vigente do
 * § 7º) e os incisos da cláusula terceira do Ajuste SINIEF 09/07 NÃO foram
 * lidos. A regra de cada UF (dispensa do CT-e da subcontratada, ICMS) é com o
 * contador.
 *
 * Tudo aqui é puro e também é importado pelas telas.
 */

export const TIPOS_DE_DOCUMENTO = ["CTE", "MDFE"] as const;
export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

export const ROTULO_DO_DOCUMENTO: Record<TipoDeDocumento, string> = { CTE: "CT-e", MDFE: "MDF-e" };

/** O modelo que a chave de cada documento leva (posições 21 e 22). `58` é o do MDF-e (src/lib/mdfe/chave.ts). */
export const MODELO_DO_DOCUMENTO: Record<TipoDeDocumento, string> = { CTE: MODELO_DO_CTE, MDFE: "58" };

/** O tipo de parceiro que faz da viagem uma subcontratação: a transportadora (src/lib/parceiros.ts). */
export const TIPO_DA_SUBCONTRATADA = "TRANSPORTADORA";

export const UFS_DE_DESCARGA: readonly string[] = Object.keys(CODIGO_DA_UF).sort();

/* ------------------------------------ Chave ----------------------------------- */

/** O primeiro ano de cada documento eletrônico: o CT-e é de 2009 (MOC 4.00, regra G065) e o MDF-e, de 2012. */
const PRIMEIRO_ANO: Record<TipoDeDocumento, number> = { CTE: 2009, MDFE: 2012 };

export const CHAVE_MESSAGE = "A chave precisa ter 44 posições, com o dígito verificador certo.";
export const chaveDeOutroModelo = (tipo: TipoDeDocumento) => `A chave informada não é de ${ROTULO_DO_DOCUMENTO[tipo]} (modelo ${MODELO_DO_DOCUMENTO[tipo]}).`;
export const CHAVE_IMPOSSIVEL = "A chave tem UF, data, CNPJ ou número que não existem: confira os 44 caracteres com o documento.";
export const chaveDeOutroEmitente = (parceiro: string) =>
  `A chave não foi emitida pelo CNPJ de ${parceiro}. O documento da subcontratada tem o CNPJ dela nas posições 7 a 20 da chave.`;

/** O mês da emissão que a chave carrega (posições 3 a 6), como `AAAA-MM`. */
export const mesDaChave = (chave: string) => `20${chave.slice(2, 4)}-${chave.slice(4, 6)}`;

/**
 * Por que a chave não serve como documento da subcontratada, ou `null`: 44
 * posições com o dígito verificador, o modelo do documento (57 ou 58), UF, mês
 * e número que existem, e, quando se sabe o parceiro, o CNPJ dele como
 * emitente. A existência do documento na SEFAZ só ela sabe.
 */
export function problemaDaChave(tipo: TipoDeDocumento, chave: string, parceiro?: { name: string; taxId: string } | null, agora: Date = new Date()): string | null {
  if (!chaveValida(chave)) return CHAVE_MESSAGE;
  if (chave.slice(20, 22) !== MODELO_DO_DOCUMENTO[tipo]) return chaveDeOutroModelo(tipo);
  const { cnpj, uf } = emissorDaChave(chave);
  const ano = 2000 + Number(chave.slice(2, 4));
  const mes = Number(chave.slice(4, 6));
  if (uf === null || !cnpjValido(cnpj) || ano < PRIMEIRO_ANO[tipo] || ano > agora.getUTCFullYear() || mes < 1 || mes > 12 || Number(chave.slice(25, 34)) === 0) return CHAVE_IMPOSSIVEL;
  if (parceiro && cnpj !== parceiro.taxId.toUpperCase()) return chaveDeOutroEmitente(parceiro.name);
  return null;
}

/* ---------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";
export const DATA_MESSAGE = "Informe a data de emissão do documento.";
export const DATA_NO_FUTURO = "A data de emissão não pode ser depois de hoje.";
export const dataForaDoMesDaChave = (chave: string) => `A data de emissão não bate com a chave, que é de ${mesDaChave(chave).split("-").reverse().join("/")}.`;
export const CARGA_MESSAGE = "Escolha a carga que o CT-e da subcontratada cobre.";
export const UF_MESSAGE = "Escolha a UF de descarregamento do MDF-e da subcontratada.";

const emBrancoViraNulo = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? null : valor);

/**
 * O documento da subcontratada, como a tela manda. O CT-e pede a carga; o
 * MDF-e, a UF de descarregamento (o MDF-e é um por UF: Ajuste SINIEF 21/10,
 * cláusula terceira, § 2º). O CNPJ da chave é conferido na rota, que é quem
 * sabe o parceiro do contrato.
 */
export const documentoSchema = z
  .object(
    {
      kind: z.enum(TIPOS_DE_DOCUMENTO, "Informe se o documento é CT-e ou MDF-e."),
      // Guarda a chave limpa: ela chega com espaço e ponto quando é colada do documento.
      accessKey: z.string(CHAVE_MESSAGE).transform((chave) => limparChave(chave)),
      collectionId: z.preprocess(emBrancoViraNulo, z.string(CARGA_MESSAGE).trim().max(64, CARGA_MESSAGE).nullish()),
      unloadState: z.preprocess((valor) => (typeof valor === "string" ? emBrancoViraNulo(valor.trim().toUpperCase()) : valor), z.string(UF_MESSAGE).nullish()),
      issuedAt: z.string(DATA_MESSAGE).trim().regex(/^\d{4}-\d{2}-\d{2}$/, DATA_MESSAGE),
    },
    INVALID_BODY,
  )
  .superRefine((dados, contexto) => {
    const problema = problemaDaChave(dados.kind, dados.accessKey);
    if (problema) return void contexto.addIssue({ code: "custom", message: problema, path: ["accessKey"] });
    if (dados.kind === "CTE" && !dados.collectionId) contexto.addIssue({ code: "custom", message: CARGA_MESSAGE, path: ["collectionId"] });
    if (dados.kind === "MDFE" && !UFS_DE_DESCARGA.includes(dados.unloadState ?? "")) contexto.addIssue({ code: "custom", message: UF_MESSAGE, path: ["unloadState"] });
    if (Number.isNaN(new Date(`${dados.issuedAt}T00:00:00.000Z`).getTime())) return void contexto.addIssue({ code: "custom", message: DATA_MESSAGE, path: ["issuedAt"] });
    if (dados.issuedAt > diaNoBrasil(new Date())) contexto.addIssue({ code: "custom", message: DATA_NO_FUTURO, path: ["issuedAt"] });
    else if (dados.issuedAt.slice(0, 7) !== mesDaChave(dados.accessKey)) contexto.addIssue({ code: "custom", message: dataForaDoMesDaChave(dados.accessKey), path: ["issuedAt"] });
  })
  .transform((dados) => ({
    kind: dados.kind,
    accessKey: dados.accessKey,
    // Cada documento guarda só o que é dele: o CT-e, a carga; o MDF-e, a UF.
    collectionId: dados.kind === "CTE" ? (dados.collectionId ?? null) : null,
    unloadState: dados.kind === "MDFE" ? (dados.unloadState ?? null) : null,
    issuedAt: new Date(`${dados.issuedAt}T00:00:00.000Z`),
  }));

/* ------------------------------ Quando há subcontratação ----------------------- */

type ContratoDaViagem = { status: string; carrierId: string; carrier: { type: string } };

/** O contrato de frete é com uma transportadora e está valendo? É o que deixa registrar documento da subcontratada. */
export const contratoComTransportadora = (contrato: ContratoDaViagem | null | undefined): contrato is ContratoDaViagem =>
  Boolean(contrato && contrato.status !== "CANCELADO" && contrato.carrier.type === TIPO_DA_SUBCONTRATADA);

/**
 * A viagem é feita no veículo da transportadora contratada? É o que faz o
 * MDF-e dela valer para a saída: o veículo é de um parceiro do tipo
 * transportadora, e o contrato de frete da viagem, valendo, é com ela. TAC
 * agregado e TAC independente não entram: o MDF-e continua sendo desta
 * empresa, com o parceiro como proprietário do veículo.
 */
export function viagemSubcontratada(veiculo: { carrier: { id: string; type: string } | null }, contrato: ContratoDaViagem | null | undefined): boolean {
  return contratoComTransportadora(contrato) && veiculo.carrier?.type === TIPO_DA_SUBCONTRATADA && veiculo.carrier.id === contrato.carrierId;
}

/* ----------------------------------- Leituras --------------------------------- */

/** O documento como as rotas o devolvem. */
export type DocumentoDaSubcontratada = { id: string; kind: string; accessKey: string; collectionId: string | null; unloadState: string | null; issuedAt: string };

export type CargaDaSubcontratacao = {
  id: string;
  codigo: string;
  destino: string;
  /** A carga sai do município: é a que tem CT-e (a mesma regra do CT-e desta empresa na saída). */
  precisaDeCte: boolean;
  ctes: DocumentoDaSubcontratada[];
};

/** O que `GET /api/manifestos/[id]/subcontratacao` devolve. Não leva valor nenhum do contrato. */
export type SubcontratacaoDaViagem = {
  viagem: { id: string; status: string };
  /** A transportadora do contrato de frete da viagem; `null` quando a viagem não tem contrato valendo com transportadora. */
  parceiro: { id: string; name: string; taxId: string } | null;
  /** O veículo da viagem é dessa transportadora: o MDF-e dela vale para a saída. */
  noVeiculoDela: boolean;
  cargas: CargaDaSubcontratacao[];
  /** As UF de descarregamento da viagem (as mesmas da aba MDF-e). */
  ufsDeDescarga: string[];
  mdfes: DocumentoDaSubcontratada[];
  /** As cargas que saem do município e ainda não têm CT-e da subcontratada. */
  semCte: { id: string; codigo: string }[];
  /** As UF com MDF-e desta empresa E da subcontratada: o § 6º manda um só. */
  ufsEmDobro: string[];
};

/** As cargas que precisam de CT-e e não têm nenhum da subcontratada registrado. */
export function cargasSemCte(cargas: readonly Pick<CargaDaSubcontratacao, "id" | "codigo" | "precisaDeCte" | "ctes">[]): { id: string; codigo: string }[] {
  return cargas.filter((carga) => carga.precisaDeCte && carga.ctes.length === 0).map(({ id, codigo }) => ({ id, codigo }));
}

/** As UF de descarregamento que a subcontratada cobriu com MDF-e, sem repetir. */
export function ufsComMdfeDaSubcontratada(documentos: readonly { kind: string; unloadState: string | null }[]): string[] {
  return [...new Set(documentos.flatMap((documento) => (documento.kind === "MDFE" && documento.unloadState ? [documento.unloadState] : [])))].sort();
}

/** As UF em que há MDF-e desta empresa e da subcontratada ao mesmo tempo. */
export const ufsEmDobro = (proprias: readonly string[], daSubcontratada: readonly string[]) => daSubcontratada.filter((uf) => proprias.includes(uf));

/* ------------------------------------ Frases ---------------------------------- */

const emLista = (itens: readonly string[]) => (itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`);

/**
 * O aviso (que não bloqueia) de quem vai quitar o contrato com carga sem CT-e
 * da subcontratada. `null`: nada a avisar.
 */
export function avisoDeCargasSemCte(semCte: readonly { codigo: string }[]): string | null {
  if (semCte.length === 0) return null;
  const quais = semCte.length === 1 ? `A carga ${semCte[0].codigo} está` : `As cargas ${emLista(semCte.map((carga) => carga.codigo))} estão`;
  return `${quais} sem CT-e da subcontratada registrado. A subcontratada emite o conhecimento dela (Convênio SINIEF 06/89, art. 17, § 7º), salvo dispensa da UF: confira com o contador antes de quitar.`;
}

/** O aviso de MDF-e em dobro: a norma manda um só emitente na subcontratação. */
export function avisoDeMdfeEmDobro(ufs: readonly string[]): string | null {
  if (ufs.length === 0) return null;
  return `Há MDF-e seu e da subcontratada com descarga em ${emLista(ufs)}. Na subcontratação o MDF-e é emitido só por quem gerencia o transporte (Ajuste SINIEF 21/10, cláusula terceira, § 6º): encerre ou cancele o que sobra.`;
}

export const QUEM_EMITE_O_MDFE =
  "Na subcontratação, o MDF-e é emitido só por quem gerencia o transporte (veículo, carga, motorista e logística): Ajuste SINIEF 21/10, cláusula terceira, § 6º. Se é a subcontratada, registre a chave do MDF-e dela por UF de descarga: ela vale para liberar a saída no lugar do seu. Se é você, emita o seu abaixo.";

/* ------------------------------ O que as rotas leem ---------------------------- */

export const DOCUMENT_SELECT = { id: true, kind: true, accessKey: true, collectionId: true, unloadState: true, issuedAt: true } as const;

/** O que entra em `antes`/`depois` da auditoria. */
export const CAMPOS_DO_DOCUMENTO = ["kind", "accessKey", "collectionId", "unloadState", "issuedAt"] as const;

export const SEM_CONTRATO_COM_TRANSPORTADORA = "Esta viagem não tem frete contratado, valendo, com uma transportadora parceira. O documento da subcontratada é registrado no contrato de frete dela.";
export const VIAGEM_CANCELADA_SEM_DOCUMENTO = "Viagem cancelada não recebe documento da subcontratada.";
export const CARGA_FORA_DA_VIAGEM = "A carga escolhida não está nesta viagem.";
export const DOCUMENTO_JA_REGISTRADO = "Esta chave já está registrada nesta viagem.";
export const DOCUMENTO_NAO_ENCONTRADO = "Documento não encontrado.";
export const CONTRATO_TEM_DOCUMENTOS = "O contrato tem documento da subcontratada registrado: exclua os documentos antes de trocar o parceiro.";

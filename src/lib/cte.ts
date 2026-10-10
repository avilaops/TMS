import { z } from "zod";
import { UFS } from "@/lib/roteiro";

/**
 * Emissão de CT-e (modelo 57, modal rodoviário, leiaute 4.00): o que a tela e
 * as rotas têm em comum. Os dados fiscais do emitente, como são validados, as
 * situações de um CT-e e o que cada rota devolve.
 *
 * Tudo aqui é puro e também é importado pelas telas: nada daqui pode puxar o
 * que só existe no servidor. A montagem do XML, a assinatura e a conversa com
 * a SEFAZ estão em src/lib/cte/; o que grava e lê, em src/lib/cte-db.ts.
 *
 * REGRA DA CASA: um CT-e só é "autorizado" com o protocolo que a SEFAZ
 * devolveu. Nada aqui (nem nas rotas, nem na tela) marca autorização por conta
 * própria.
 */

/* --------------------------------- Ambiente ---------------------------------- */

export const AMBIENTES = ["HOMOLOGACAO", "PRODUCAO"] as const;
export type Ambiente = (typeof AMBIENTES)[number];

export const ROTULO_DO_AMBIENTE: Record<Ambiente, string> = { HOMOLOGACAO: "Homologação", PRODUCAO: "Produção" };

/** O que vai no lugar da razão social de remetente e destinatário em homologação (MOC 4.00, Anexo I, regras G002 e G005). */
export const NOME_EM_HOMOLOGACAO = "CTE EMITIDO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

/* ----------------------------- Dados do emitente ------------------------------ */

/** Código de Regime Tributário (`emit/CRT`). */
export const REGIMES = {
  "1": "Simples Nacional",
  "2": "Simples Nacional, excesso de sublimite",
  "3": "Regime normal",
  "4": "Simples Nacional (MEI)",
} as const;
export type Regime = keyof typeof REGIMES;

/**
 * Situação tributária do ICMS que a empresa usa por padrão em todo CT-e (os
 * grupos de `imp/ICMS` do leiaute 4.00, MOC, Anexo I, campos 199 a 233).
 */
export const SITUACOES_DO_ICMS = {
  "00": "00 - Tributação normal",
  "20": "20 - Base de cálculo reduzida",
  "40": "40 - Isenta",
  "41": "41 - Não tributada",
  "60": "60 - Cobrado por substituição tributária",
  "90": "90 - Outras",
  SN: "Simples Nacional",
} as const;
export type SituacaoDoIcms = keyof typeof SITUACOES_DO_ICMS;

/** O que cada situação quer dizer, para a tela de configuração. Quem escolhe é o contador. */
export const EXPLICACAO_DO_ICMS: Record<SituacaoDoIcms, string> = {
  "00": "ICMS destacado sobre o valor inteiro do frete, com a alíquota interna (dentro do estado) ou a interestadual (calculada pelo sistema).",
  "20": "ICMS destacado sobre a base reduzida: informe o percentual de redução que a legislação do seu estado dá ao transporte.",
  "40": "Prestação isenta de ICMS pela legislação do estado: o CT-e vai sem base, alíquota e valor.",
  "41": "Prestação não tributada pelo ICMS: o CT-e vai sem base, alíquota e valor.",
  "60": "O ICMS é recolhido por outra empresa (o tomador ou um terceiro), por substituição tributária: o CT-e informa a base e o valor retidos.",
  "90": "Outras situações que o contador indicar: ICMS destacado sobre o valor inteiro do frete, no grupo ICMS90.",
  SN: "Empresa do Simples Nacional: o CT-e não destaca ICMS.",
};

/** Situações em que o CT-e leva alíquota (e, por isso, a configuração exige a alíquota interna). */
export const ICMS_COM_ALIQUOTA: readonly SituacaoDoIcms[] = ["00", "20", "60", "90"];

/** Regimes em que o ICMS do CT-e vai no grupo do Simples Nacional (`ICMSSN`). */
export const REGIMES_DO_SIMPLES: readonly Regime[] = ["1", "4"];

/* ------------------------- Alíquota interestadual do ICMS ---------------------- */

/**
 * Resolução do Senado Federal nº 22/1989:
 * - art. 1º: "nas operações e prestações interestaduais, será de doze por cento";
 * - parágrafo único: "nas operações e prestações realizadas nas Regiões Sul e
 *   Sudeste, destinadas às Regiões Norte, Nordeste e Centro-Oeste e ao Estado
 *   do Espírito Santo", sete por cento (a partir de 1990).
 *
 * O Espírito Santo é do Sudeste, mas a resolução o põe do lado de quem recebe
 * os 7%: saindo dele vale a regra geral (12%), e ele não está na lista de
 * origem abaixo.
 *
 * Não está aqui: a alíquota própria do transporte aéreo, que este sistema não
 * emite (só modal rodoviário).
 */
const SUL_E_SUDESTE_SEM_ES: readonly string[] = ["MG", "RJ", "SP", "PR", "SC", "RS"];
/** Norte, Nordeste, Centro-Oeste e o Espírito Santo. */
const DESTINO_DOS_SETE: readonly string[] = [
  ...["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  ...["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  ...["DF", "GO", "MT", "MS"],
  "ES",
];

/**
 * A alíquota interestadual do ICMS da prestação que começa em `ufDeInicio` e
 * termina em `ufDeFim`, em %: 7 ou 12. `null` quando não é interestadual (a
 * mesma UF: vale a alíquota interna, que é de cada estado) ou quando alguma UF
 * não existe.
 */
export function aliquotaInterestadual(ufDeInicio: string, ufDeFim: string): 7 | 12 | null {
  const ufs = UFS as readonly string[];
  if (!ufs.includes(ufDeInicio) || !ufs.includes(ufDeFim) || ufDeInicio === ufDeFim) return null;
  return SUL_E_SUDESTE_SEM_ES.includes(ufDeInicio) && DESTINO_DOS_SETE.includes(ufDeFim) ? 7 : 12;
}

/* -------------------------------- CFOP de transporte --------------------------- */

/**
 * Os CFOP de prestação de serviço de transporte (grupos 5.350 e 6.350).
 * Fonte: Tabela de CFOP do Portal Nacional da NF-e (Documentos > Diversos),
 * IT 2023.002 v2.10, de 04/09/2026, códigos com o indicador "transporte",
 * lidos pela ferramenta `consultar_cfop` do serviço fiscal da casa. Não existem
 * 5358/6358.
 *
 * 5932 e 6932 (prestação iniciada em UF diversa daquela onde o prestador está
 * inscrito) também são de transporte, mas não se configuram: o sistema os usa
 * sozinho quando a prestação começa fora da UF do emitente (MOC 4.00, Anexo I,
 * regra G051), e a SEFAZ os rejeita quando ela começa na UF do emitente (regra
 * G052, rejeição 908).
 */
export const CFOP_DE_TRANSPORTE: Record<string, string> = {
  "351": "para execução de serviço da mesma natureza",
  "352": "a estabelecimento industrial",
  "353": "a estabelecimento comercial",
  "354": "a prestador de serviço de comunicação",
  "355": "a geradora ou distribuidora de energia elétrica",
  "356": "a produtor rural",
  "357": "a não contribuinte",
  "359": "a contribuinte ou não, mercadoria dispensada de nota fiscal",
  "360": "a contribuinte substituto do serviço de transporte",
};
export const CFOP_DE_OUTRA_UF = { dentro: "5932", fora: "6932" } as const;

const cfopDeTransporte = (inicio: "5" | "6", codigo: string) => codigo.startsWith(inicio) && Object.hasOwn(CFOP_DE_TRANSPORTE, codigo.slice(1));

const INVALIDO = "Dados inválidos.";
const CNPJ_MESSAGE = "Informe um CNPJ válido (14 posições, com os dígitos verificadores certos).";
const IE_MESSAGE = "A inscrição estadual precisa ter de 2 a 14 dígitos.";
const CEP_MESSAGE = "O CEP precisa ter 8 dígitos.";
const FONE_MESSAGE = "O telefone precisa ter de 6 a 14 dígitos, com DDD.";
const RNTRC_MESSAGE = "O RNTRC precisa ter 8 dígitos.";
const SERIE_MESSAGE = "A série precisa ser um número de 0 a 999.";
const NUMERO_MESSAGE = "O próximo número precisa ser um inteiro de 1 a 999999999.";
const ALIQUOTA_MESSAGE = "A alíquota precisa ser um número de 0 a 100.";
const CODIGOS_DE_TRANSPORTE = Object.keys(CFOP_DE_TRANSPORTE).join(", ");
export const CFOP_DENTRO_MESSAGE = `O CFOP dentro do estado precisa ser de prestação de serviço de transporte: 5 seguido de ${CODIGOS_DE_TRANSPORTE}. O 5932 o sistema usa sozinho.`;
export const CFOP_FORA_MESSAGE = `O CFOP fora do estado precisa ser de prestação de serviço de transporte: 6 seguido de ${CODIGOS_DE_TRANSPORTE}. O 6932 o sistema usa sozinho.`;
export const SIMPLES_PEDE_SN = "Empresa do Simples Nacional usa a situação tributária \"Simples Nacional\".";
export const SN_SO_NO_SIMPLES = "A situação \"Simples Nacional\" só vale para empresa do Simples Nacional.";
export const TRIBUTADO_PEDE_ALIQUOTA = "Informe a alíquota interna do ICMS (maior que zero) para a situação escolhida.";
const REDUCAO_MESSAGE = "A redução da base precisa ser um número maior que 0 e menor que 100, com até 2 casas.";
export const REDUCAO_OBRIGATORIA = "Informe o percentual de redução da base de cálculo do ICMS (situação 20).";
export const REDUCAO_SO_NA_20 = "A redução da base de cálculo só vale para a situação 20 do ICMS.";

/**
 * IBS e CBS (Reforma Tributária do Consumo) no CT-e: NT 2025.001 do CT-e
 * (v1.14b) e NT 2026.002 (v1.01).
 *
 * As alíquotas de teste de 2026 (LC 214/2025, arts. 343 e 346): a SEFAZ rejeita
 * qualquer outra em documento emitido em 2026 (rejeições 316, 321 e 326). Em
 * 2027 e 2028 o IBS passa a 0,05% + 0,05% e a CBS, à alíquota de referência que
 * for publicada: por isso as três são parâmetros da empresa, e não constantes.
 */
export const ALIQUOTAS_DE_2026 = { ibsUf: 0.1, ibsMunicipio: 0, cbs: 0.9 } as const;

/**
 * As situações tributárias do IBS/CBS que valem no CT-e (modelo 57), se cada
 * uma leva o grupo de valores (`gIBSCBS`) e se, dentro dele, leva a redução de
 * alíquota (`gRed`, exigida pela regra 009 da NT 2025.001, rejeição 366, e
 * vedada nas demais pela regra 010, rejeição 367).
 */
export const CST_DO_IBSCBS: Record<string, { rotulo: string; comValores: boolean; comReducao: boolean }> = {
  "000": { rotulo: "000 - Tributação integral", comValores: true, comReducao: false },
  "200": { rotulo: "200 - Alíquota reduzida", comValores: true, comReducao: true },
  "410": { rotulo: "410 - Imunidade e não incidência", comValores: false, comReducao: false },
};

/**
 * Os pares CST × cClassTrib que a SEFAZ aceita no CT-e (regras 003, 004 e 004a
 * da NT 2025.001: rejeições 312, 313 e 388).
 *
 * Fonte: Tabela de Classificação Tributária do IBS e da CBS, Portal Nacional
 * da NF-e (Documentos > Diversos), Informe Técnico 2025.002 v1.70, publicada em
 * 01/10/2026, filtrada pelo indicador do CT-e. São 12 linhas; a redução é o
 * percentual de redução de alíquota da própria tabela (`pRedAliq`, o único
 * valor que a regra 009a aceita para cada classificação, rejeição 389).
 *
 * O CST 400 (isenção) NÃO vale em CT-e: as classificações dele são do
 * transporte coletivo de passageiros (BP-e e NFS-e).
 *
 * Quando a tabela mudar, atualize esta lista: a ferramenta
 * `consultar_classificacao_tributaria { documento: "cte" }` do serviço fiscal
 * da casa devolve a tabela vigente.
 */
export type ClassificacaoDoIbsCbs = {
  cst: string;
  nome: string;
  /** Percentual de redução de alíquota (`gRed/pRedAliq`). `null`: a classificação não leva `gRed`. */
  reducao: number | null;
  /** A classificação exige o grupo `gEstornoCred`, que este sistema não monta. */
  estorno?: true;
};

export const CLASSIFICACOES_DO_IBSCBS: Record<string, ClassificacaoDoIbsCbs> = {
  "000001": { cst: "000", nome: "Situações tributadas integralmente pelo IBS e CBS", reducao: null },
  "200001": { cst: "200", nome: "Transporte de bens até as zonas de processamento de exportação e de bens exportados a partir delas (LC 214/2025, art. 103)", reducao: 100 },
  "200020": { cst: "200", nome: "Operação de cooperativa optante por regime específico do IBS e CBS (art. 271)", reducao: 100 },
  "200050": { cst: "200", nome: "Transporte aéreo regional coletivo de passageiros ou de carga (art. 287)", reducao: 40 },
  "410001": { cst: "410", nome: "Bonificações que constem no documento fiscal e não dependam de evento posterior", reducao: null },
  "410003": { cst: "410", nome: "Doações sem contraprestação em benefício do doador", reducao: null },
  "410004": { cst: "410", nome: "Exportações de bens e serviços", reducao: null },
  "410015": { cst: "410", nome: "Fornecimento por transportador autônomo não contribuinte", reducao: null },
  "410026": { cst: "410", nome: "Doação com anulação de crédito", reducao: null, estorno: true },
  "410027": { cst: "410", nome: "Exportação de serviço ou de bem imaterial", reducao: null },
  "410035": { cst: "410", nome: "Fornecimento realizado por nanoempreendedor", reducao: null },
  "410999": { cst: "410", nome: "Operações não onerosas sem previsão de tributação, não especificadas anteriormente", reducao: null },
};

const IBSCBS_CST_MESSAGE = "O CST do IBS/CBS precisa ter 3 dígitos.";
const IBSCBS_CLASSE_MESSAGE = "A classificação tributária do IBS/CBS (cClassTrib) precisa ter 6 dígitos.";
const ALIQUOTA_DA_REFORMA_MESSAGE = "As alíquotas de IBS, CBS, PIS e COFINS precisam ser números de 0 a 100, com até 4 casas.";
export const IBSCBS_INCOMPLETO = "Informe o CST e a classificação tributária do IBS/CBS, ou deixe os dois em branco.";
export const IBSCBS_OBRIGATORIO = "Empresa do regime normal precisa informar o CST e a classificação tributária do IBS/CBS: sem eles a SEFAZ rejeita o CT-e (310).";
export const IBSCBS_CST_400 = "O CST 400 (isenção) do IBS/CBS não vale em CT-e: a SEFAZ rejeita (388). Escolha com o contador entre 000, 200 e 410, e a classificação correspondente.";
export const IBSCBS_CST_FORA_DA_LISTA = "CST do IBS/CBS que não vale em CT-e. Os que valem: 000, 200 e 410.";
export const IBSCBS_COM_ESTORNO = "A classificação 410026 exige o grupo de estorno de crédito (gEstornoCred), que este sistema não monta. Consulte o contador.";

const classesDoCst = (cst: string) =>
  Object.entries(CLASSIFICACOES_DO_IBSCBS)
    .filter(([, classificacao]) => classificacao.cst === cst)
    .map(([codigo]) => codigo);

/**
 * O que há de errado no par CST × cClassTrib do IBS/CBS, numa frase para a
 * pessoa, ou `null` quando o par vale no CT-e e este sistema o monta. É a mesma
 * conferência na gravação da configuração, na conferência do CT-e (uma
 * configuração antiga pode ter ficado com um par que deixou de valer) e na tela.
 */
export function problemaDoIbsCbs(cst: string, classe: string): string | null {
  if (cst === "400") return IBSCBS_CST_400;
  if (!Object.hasOwn(CST_DO_IBSCBS, cst)) return IBSCBS_CST_FORA_DA_LISTA;
  const classificacao = Object.hasOwn(CLASSIFICACOES_DO_IBSCBS, classe) ? CLASSIFICACOES_DO_IBSCBS[classe] : null;
  if (!classificacao || classificacao.cst !== cst) {
    return `A classificação ${classe} não vale com o CST ${cst} no CT-e (a SEFAZ rejeita: 312, 313 ou 388). Com o CST ${cst} valem: ${classesDoCst(cst).join(", ")}.`;
  }
  return classificacao.estorno ? IBSCBS_COM_ESTORNO : null;
}

const soDigitos = (valor: unknown) => (typeof valor === "string" ? valor.replace(/\D/g, "") : valor);

/** O CNPJ como os documentos fiscais o escrevem: sem pontuação e em maiúsculas (ele pode ter letras desde 2026). */
export const limparCnpj = (texto: string) => texto.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
const cnpjLimpo = (valor: unknown) => (typeof valor === "string" ? limparCnpj(valor) : valor);

/** Módulo 11 sobre os caracteres, cada um valendo o código ASCII menos 48, com pesos de 2 a 9 da direita para a esquerda. */
function digitoDoCnpj(caracteres: string): number {
  let peso = 2;
  let soma = 0;
  for (let i = caracteres.length - 1; i >= 0; i -= 1) {
    soma += (caracteres.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/**
 * CNPJ sem pontuação: doze letras maiúsculas ou dígitos e dois dígitos
 * verificadores. É a regra do CNPJ alfanumérico (Nota Técnica Conjunta
 * 2025.001, em produção nos documentos fiscais desde 06/07/2026); o CNPJ só de
 * dígitos é o caso particular, com a mesma conta.
 */
export function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || /^0+$/.test(cnpj)) return false;
  const primeiro = digitoDoCnpj(cnpj.slice(0, 12));
  const segundo = digitoDoCnpj(`${cnpj.slice(0, 12)}${primeiro}`);
  return cnpj.endsWith(`${primeiro}${segundo}`);
}
const emBrancoViraNulo = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? null : valor);

const texto = (minimo: number, maximo: number, mensagem: string) => z.string(mensagem).trim().min(minimo, mensagem).max(maximo, mensagem);
const textoOpcional = (maximo: number, mensagem: string) => z.preprocess(emBrancoViraNulo, z.string(mensagem).trim().max(maximo, mensagem).nullish());

// O formulário manda número como texto ("12", "12,5").
const numeroDoFormulario = (valor: unknown) => {
  if (typeof valor !== "string") return valor;
  const limpo = valor.trim();
  return /^\d+([.,]\d+)?$/.test(limpo) ? Number(limpo.replace(",", ".")) : NaN;
};

// Alíquota do IBS, da CBS, do PIS e da COFINS: ausente vale o padrão; até 4 casas (`TDec_0302_04RTC`).
const aliquotaDaReforma = (padrao: number) =>
  z.preprocess(
    (valor) => (valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "") ? padrao : numeroDoFormulario(valor)),
    z
      .number(ALIQUOTA_DA_REFORMA_MESSAGE)
      .min(0, ALIQUOTA_DA_REFORMA_MESSAGE)
      .max(100, ALIQUOTA_DA_REFORMA_MESSAGE)
      .refine((numero) => Number.isInteger(Math.round(numero * 1e6) / 100), ALIQUOTA_DA_REFORMA_MESSAGE),
  );

// O CFOP da configuração: um dos de prestação de serviço de transporte (`CFOP_DE_TRANSPORTE`).
const cfop = (inicio: "5" | "6", mensagem: string) =>
  z.preprocess(
    soDigitos,
    z.string(mensagem).refine((codigo) => cfopDeTransporte(inicio, codigo), mensagem),
  );

// Percentual de redução da base do ICMS (`pRedBC`, `TDec_0302Opc`): em branco = sem redução; até 2 casas.
const reducaoDaBase = z.preprocess(
  (valor) => (valor === undefined || valor === null || (typeof valor === "string" && valor.trim() === "") ? null : numeroDoFormulario(valor)),
  z
    .number(REDUCAO_MESSAGE)
    .gt(0, REDUCAO_MESSAGE)
    .lt(100, REDUCAO_MESSAGE)
    .refine((numero) => Number.isInteger(Math.round(numero * 1e4) / 100), REDUCAO_MESSAGE)
    .nullable(),
);

/**
 * Os dados fiscais do emitente (Empresa → Fiscal). O município entra como
 * cidade e UF; a rota acha o código IBGE na tabela do sistema
 * (src/lib/municipios.ts) e recusa cidade que não existe.
 *
 * `confirmacaoDoCnpj`: só é exigida para passar a produção, e precisa ser o
 * próprio CNPJ digitado de novo (a rota confere).
 */
export const dadosFiscaisSchema = z
  .object(
    {
      cnpj: z.preprocess(cnpjLimpo, z.string(CNPJ_MESSAGE).refine(cnpjValido, CNPJ_MESSAGE)),
      ie: z.preprocess(soDigitos, z.string(IE_MESSAGE).regex(/^\d{2,14}$/, IE_MESSAGE)),
      razaoSocial: texto(2, 60, "Informe a razão social (até 60 letras)."),
      fantasia: textoOpcional(60, "Nome fantasia muito longo (máximo de 60 letras)."),
      logradouro: texto(2, 60, "Informe o logradouro (até 60 letras)."),
      numero: texto(1, 60, "Informe o número do endereço (ou S/N)."),
      complemento: textoOpcional(60, "Complemento muito longo (máximo de 60 letras)."),
      bairro: texto(2, 60, "Informe o bairro (até 60 letras)."),
      cidade: texto(2, 60, "Informe a cidade."),
      uf: z.enum(UFS, "Escolha a UF."),
      cep: z.preprocess(soDigitos, z.string(CEP_MESSAGE).regex(/^\d{8}$/, CEP_MESSAGE)),
      telefone: z.preprocess((valor) => emBrancoViraNulo(soDigitos(valor)), z.string(FONE_MESSAGE).regex(/^\d{6,14}$/, FONE_MESSAGE).nullish()),
      rntrc: z.preprocess(soDigitos, z.string(RNTRC_MESSAGE).regex(/^\d{8}$/, RNTRC_MESSAGE)),
      regime: z.enum(Object.keys(REGIMES) as [Regime, ...Regime[]], "Escolha o regime tributário."),
      serie: z.preprocess(numeroDoFormulario, z.number(SERIE_MESSAGE).int(SERIE_MESSAGE).min(0, SERIE_MESSAGE).max(999, SERIE_MESSAGE)),
      proximoNumero: z.preprocess(numeroDoFormulario, z.number(NUMERO_MESSAGE).int(NUMERO_MESSAGE).min(1, NUMERO_MESSAGE).max(999_999_999, NUMERO_MESSAGE)),
      ambiente: z.enum(AMBIENTES, "Escolha o ambiente."),
      cfopDentro: cfop("5", CFOP_DENTRO_MESSAGE),
      cfopFora: cfop("6", CFOP_FORA_MESSAGE),
      icms: z.enum(Object.keys(SITUACOES_DO_ICMS) as [SituacaoDoIcms, ...SituacaoDoIcms[]], "Escolha a situação tributária do ICMS."),
      // A alíquota INTERNA (prestação que começa e termina na UF do emitente). A interestadual é calculada (`aliquotaInterestadual`).
      aliquota: z.preprocess(numeroDoFormulario, z.number(ALIQUOTA_MESSAGE).min(0, ALIQUOTA_MESSAGE).max(100, ALIQUOTA_MESSAGE)),
      reducaoDaBase,
      confirmacaoDoCnpj: z.preprocess(cnpjLimpo, z.string(INVALIDO).max(20, INVALIDO).optional()),
      // IBS e CBS da Reforma Tributária (grupo `imp/IBSCBS`). CST e classificação em branco = o CT-e vai sem o grupo.
      ibsCbsCst: z.preprocess((valor) => emBrancoViraNulo(soDigitos(valor)), z.string(IBSCBS_CST_MESSAGE).regex(/^\d{3}$/, IBSCBS_CST_MESSAGE).nullish()),
      ibsCbsClasse: z.preprocess((valor) => emBrancoViraNulo(soDigitos(valor)), z.string(IBSCBS_CLASSE_MESSAGE).regex(/^\d{6}$/, IBSCBS_CLASSE_MESSAGE).nullish()),
      ibsUf: aliquotaDaReforma(ALIQUOTAS_DE_2026.ibsUf),
      ibsMunicipio: aliquotaDaReforma(ALIQUOTAS_DE_2026.ibsMunicipio),
      cbs: aliquotaDaReforma(ALIQUOTAS_DE_2026.cbs),
      pis: aliquotaDaReforma(0),
      cofins: aliquotaDaReforma(0),
    },
    INVALIDO,
  )
  .superRefine((dados, contexto) => {
    const simples = REGIMES_DO_SIMPLES.includes(dados.regime);
    if (simples && dados.icms !== "SN") contexto.addIssue({ code: "custom", message: SIMPLES_PEDE_SN, path: ["icms"] });
    if (!simples && dados.icms === "SN") contexto.addIssue({ code: "custom", message: SN_SO_NO_SIMPLES, path: ["icms"] });
    if (ICMS_COM_ALIQUOTA.includes(dados.icms) && !(dados.aliquota > 0)) {
      contexto.addIssue({ code: "custom", message: TRIBUTADO_PEDE_ALIQUOTA, path: ["aliquota"] });
    }
    const reducao = dados.reducaoDaBase ?? null;
    if (dados.icms === "20" && reducao === null) contexto.addIssue({ code: "custom", message: REDUCAO_OBRIGATORIA, path: ["reducaoDaBase"] });
    if (dados.icms !== "20" && reducao !== null) contexto.addIssue({ code: "custom", message: REDUCAO_SO_NA_20, path: ["reducaoDaBase"] });
    const cst = dados.ibsCbsCst ?? null;
    const classe = dados.ibsCbsClasse ?? null;
    if (cst === null || classe === null) {
      if ((cst === null) !== (classe === null)) contexto.addIssue({ code: "custom", message: IBSCBS_INCOMPLETO, path: ["ibsCbsCst"] });
      else if (dados.regime === "3") contexto.addIssue({ code: "custom", message: IBSCBS_OBRIGATORIO, path: ["ibsCbsCst"] });
      return;
    }
    const problema = problemaDoIbsCbs(cst, classe);
    if (problema) contexto.addIssue({ code: "custom", message: problema, path: [Object.hasOwn(CST_DO_IBSCBS, cst) ? "ibsCbsClasse" : "ibsCbsCst"] });
  });

export type DadosFiscaisDoFormulario = z.infer<typeof dadosFiscaisSchema>;

/** Os dados fiscais como a rota os devolve. */
export type DadosFiscais = {
  cnpj: string;
  ie: string;
  razaoSocial: string;
  fantasia: string | null;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  /** Código IBGE do município, 7 dígitos, achado pela rota. */
  codigoMunicipio: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string | null;
  rntrc: string;
  regime: Regime;
  serie: number;
  /** Próximo número da série no ambiente em uso. */
  proximoNumero: number;
  ambiente: Ambiente;
  cfopDentro: string;
  cfopFora: string;
  icms: SituacaoDoIcms;
  /** Alíquota interna do ICMS, em %. */
  aliquota: number;
  /** Percentual de redução da base do ICMS (só na situação 20). */
  reducaoDaBase: number | null;
  /** CST e classificação tributária do IBS/CBS. Os dois nulos = CT-e sem o grupo `IBSCBS`. */
  ibsCbsCst: string | null;
  ibsCbsClasse: string | null;
  /** Alíquotas, em %: IBS da UF, IBS do município e CBS. */
  ibsUf: number;
  ibsMunicipio: number;
  cbs: number;
  /** PIS e COFINS sobre o frete, em %: só entram na base de cálculo do IBS/CBS (o CT-e não os destaca). */
  pis: number;
  cofins: number;
};

/** Como o certificado confere com o emitente: o mesmo CNPJ, ou outro estabelecimento da mesma empresa (mesma raiz de 8 dígitos). */
export type ConferenciaDoCertificado = "MESMO_CNPJ" | "MESMA_EMPRESA";

/** O certificado A1 da empresa, como a tela o vê: nunca o arquivo, nunca a senha. */
export type CertificadoDaEmpresa = {
  titular: string;
  cnpj: string;
  validoDe: string;
  validoAte: string;
  vencido: boolean;
  confere: ConferenciaDoCertificado | null;
  enviadoEm: string;
};

/** O que Empresa → Fiscal recebe. */
export type FiscalDaEmpresa = {
  /** O servidor tem a chave de dados (`TMS_CHAVE_DE_DADOS`) para guardar o certificado cifrado? */
  disponivel: boolean;
  dados: DadosFiscais | null;
  certificado: CertificadoDaEmpresa | null;
};

export const FISCAL_INDISPONIVEL =
  "O envio de certificado está desligado neste servidor: falta a variável TMS_CHAVE_DE_DADOS, que cifra o certificado guardado.";
export const SEM_DADOS_FISCAIS = "Preencha e salve os dados fiscais do emitente antes de enviar o certificado.";
export const SEM_EMITENTE_CADASTRADO = "Os dados fiscais do emitente não foram preenchidos. Preencha em Empresa → Fiscal.";
export const MUNICIPIO_DESCONHECIDO = "Cidade não encontrada na tabela de municípios do IBGE para a UF informada. Confira a grafia.";
export const PRODUCAO_PEDE_CONFIRMACAO = "Para emitir em produção, digite o CNPJ do emitente no campo de confirmação.";
export const CNPJ_COM_OUTRO_CERTIFICADO = "O certificado guardado é de outro CNPJ. Remova o certificado antes de trocar o CNPJ do emitente.";
export const CERTIFICADO_ILEGIVEL =
  "O certificado guardado não pôde ser aberto: a chave de dados do servidor mudou. Envie o certificado de novo em Empresa → Fiscal.";

/** Tamanho máximo do arquivo .pfx/.p12: um A1 tem poucos kB. */
export const LIMITE_DO_CERTIFICADO_BYTES = 64 * 1024;

const ARQUIVO_MESSAGE = "Envie o arquivo do certificado A1 (.pfx ou .p12).";
const SENHA_MESSAGE = "Informe a senha do certificado.";

/** O envio do certificado: o arquivo em base64 e a senha. */
export const certificadoSchema = z.object(
  {
    arquivo: z
      .string(ARQUIVO_MESSAGE)
      .min(1, ARQUIVO_MESSAGE)
      // base64 ocupa 4 caracteres a cada 3 bytes.
      .max(Math.ceil(LIMITE_DO_CERTIFICADO_BYTES / 3) * 4 + 4, "Arquivo grande demais para um certificado A1.")
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, ARQUIVO_MESSAGE),
    senha: z.string(SENHA_MESSAGE).min(1, SENHA_MESSAGE).max(200, SENHA_MESSAGE),
  },
  INVALIDO,
);

/* ------------------------------ Situação do CT-e ------------------------------ */

export const SITUACOES_DO_CTE = ["DRAFT", "REJECTED", "AUTHORIZED", "CANCELLED"] as const;
export type SituacaoDoCte = (typeof SITUACOES_DO_CTE)[number];

export const ROTULO_DA_SITUACAO: Record<SituacaoDoCte, string> = {
  DRAFT: "Rascunho",
  REJECTED: "Rejeitado",
  AUTHORIZED: "Autorizado",
  CANCELLED: "Cancelado",
};

/** O CT-e emitido por este sistema, como a lista e a tela o recebem. Sem XML. */
export type CteEmitido = {
  id: string;
  ambiente: Ambiente;
  serie: number;
  numero: number;
  chave: string;
  situacao: SituacaoDoCte;
  /** Código e motivo da última resposta da SEFAZ (ou do último problema de envio). */
  cStat: number | null;
  motivo: string | null;
  protocolo: string | null;
  autorizadoEm: string | null;
  canceladoEm: string | null;
  /** O envio ficou sem resposta: emitir de novo começa consultando a SEFAZ pela chave. */
  semResposta: boolean;
  atualizadoEm: string;
};

/** A situação em uma frase curta, para o selo da lista. */
export function seloDoCte(cte: Pick<CteEmitido, "situacao" | "ambiente" | "numero" | "semResposta">): string {
  const sufixo = cte.ambiente === "HOMOLOGACAO" ? " (homologação)" : "";
  if (cte.situacao === "AUTHORIZED") return `Autorizado nº ${cte.numero}${sufixo}`;
  if (cte.situacao === "CANCELLED") return `Cancelado nº ${cte.numero}${sufixo}`;
  if (cte.situacao === "REJECTED") return `Rejeitado${sufixo}`;
  return cte.semResposta ? `Sem resposta da SEFAZ${sufixo}` : `Rascunho${sufixo}`;
}

/**
 * A empresa está pronta para emitir? É o que a tela de CT-e pergunta ao abrir:
 * o ambiente em uso e, quando não está pronta, o que falta (em frases que
 * apontam para Empresa → Fiscal). Não leva dado fiscal nenhum.
 */
export type SituacaoDaEmissao = {
  pronta: boolean;
  ambiente: Ambiente | null;
  faltas: string[];
  /** O serviço que gera o DACTE em PDF está ligado (`FISCAL_MCP_URL`)? Sem ele a tela não mostra o botão. */
  dacte: boolean;
};

/* ------------------------------- Conferir e emitir ----------------------------- */

export type ParteDoResumo = { nome: string; documento: string | null; ie: string | null; endereco: string | null };

/** O que vai no documento, para a pessoa conferir antes de emitir. */
export type ResumoDoCte = {
  ambiente: Ambiente;
  serie: number;
  /** O número que o CT-e vai levar se for emitido agora (pode mudar se outra emissão passar na frente). */
  numeroPrevisto: number;
  cfop: string;
  emitente: ParteDoResumo;
  remetente: ParteDoResumo | null;
  destinatario: ParteDoResumo | null;
  tomador: { papel: "REMETENTE" | "DESTINATARIO" | "OUTRO"; nome: string; documento: string; contribuinte: "1" | "2" | "9" } | null;
  origem: string;
  destino: string;
  valorDaPrestacao: number | null;
  valorDaCarga: number | null;
  /**
   * O ICMS do documento. `grupo` é o grupo do XML (`ICMSOutraUF` quando a
   * prestação começa fora da UF do emitente); `retido`: o valor é o do ICMS
   * retido por substituição tributária, que não é devido pelo emitente.
   * `null`: sem frete, ou o sistema não sabe o ICMS desta prestação (há pendência).
   */
  icms: { situacao: SituacaoDoIcms; grupo: string; base: number; aliquota: number; valor: number; retido: boolean } | null;
  /** IBS e CBS do documento. `null`: o CT-e vai sem o grupo. `base` nula: CST sem valores (isenção, imunidade). */
  ibsCbs: { cst: string; classe: string; base: number | null; ibs: number; cbs: number } | null;
  peso: number;
  volumes: number;
  chavesDeNfe: string[];
};

export type ConferenciaDoCte = {
  /** A empresa está pronta para emitir (dados fiscais e certificado válido)? */
  pronta: boolean;
  /** O que impede a emissão, em frases para a pessoa. Vazio = pode emitir. */
  pendencias: string[];
  /** O que não impede, mas a pessoa precisa saber. */
  avisos: string[];
  resumo: ResumoDoCte | null;
  /** O CT-e que a carga já tem neste ambiente (o último), se houver. */
  cte: CteEmitido | null;
};

const CARGA_MESSAGE = "Informe a carga.";

export const emitirSchema = z.object({ collectionId: z.string(CARGA_MESSAGE).trim().min(1, CARGA_MESSAGE).max(64, CARGA_MESSAGE) }, INVALIDO);

/** O que a emissão devolve: o CT-e como ficou e a frase para a pessoa. */
export type ResultadoDaEmissao = { cte: CteEmitido; autorizado: boolean; mensagem: string };

/* -------------------------------- Cancelamento -------------------------------- */

/** Prazo do evento de cancelamento: 168 horas da autorização (MOC 4.00, item 6.2.1, regra O06). */
export const PRAZO_DO_CANCELAMENTO_HORAS = 168;

export const JUSTIFICATIVA_MINIMA = 15;
export const JUSTIFICATIVA_MAXIMA = 255;
const JUSTIFICATIVA_MESSAGE = `A justificativa precisa ter de ${JUSTIFICATIVA_MINIMA} a ${JUSTIFICATIVA_MAXIMA} letras.`;

export const cancelarSchema = z.object(
  { justificativa: z.string(JUSTIFICATIVA_MESSAGE).trim().min(JUSTIFICATIVA_MINIMA, JUSTIFICATIVA_MESSAGE).max(JUSTIFICATIVA_MAXIMA, JUSTIFICATIVA_MESSAGE) },
  INVALIDO,
);

/** Ainda dá para pedir o cancelamento? A SEFAZ é quem decide; isto só evita o pedido que ela recusaria. */
export function dentroDoPrazoDeCancelamento(autorizadoEm: string | Date | null, agora: Date = new Date()): boolean {
  if (!autorizadoEm) return false;
  const quando = new Date(autorizadoEm).getTime();
  return Number.isFinite(quando) && agora.getTime() - quando <= PRAZO_DO_CANCELAMENTO_HORAS * 3_600_000;
}

export const FORA_DO_PRAZO = "O prazo de cancelamento (7 dias da autorização) já passou.";

/* ------------------------------ Status do serviço ------------------------------ */

export type StatusDoServico = {
  ambiente: Ambiente;
  autorizador: string;
  /** O serviço respondeu "em operação" (cStat 107)? */
  emOperacao: boolean;
  cStat: number | null;
  motivo: string;
};

/* ---------------------------------- Mensagens --------------------------------- */

export const CTE_NAO_ENCONTRADO = "CT-e não encontrado.";
export const CARGA_NAO_ENCONTRADA = "Carga não encontrada.";
export const SO_CARGA_QUE_SAIU = "Só carga alocada numa viagem, em rota ou entregue recebe CT-e. Aloque a carga numa viagem (Manifestos) e emita o CT-e antes de liberar a saída.";
export const JA_AUTORIZADO = "Esta carga já tem CT-e autorizado neste ambiente.";
export const JA_REGISTRADO_DE_FORA = "Esta carga já tem um CT-e de outro sistema registrado à mão. Desfaça o registro antes de emitir por aqui.";
export const EMISSAO_EM_ANDAMENTO = "Já há uma emissão desta carga em andamento. Aguarde a resposta da SEFAZ.";
export const SO_AUTORIZADO_CANCELA = "Só CT-e autorizado pode ser cancelado.";
export const SO_AUTORIZADO_TEM_XML = "Só CT-e autorizado tem XML para baixar.";
export const SO_AUTORIZADO_TEM_DACTE = "Só CT-e autorizado (e não cancelado) tem DACTE.";
export const EMITIDO_PELO_SISTEMA = "Este CT-e foi autorizado por este sistema: o registro manual não pode alterá-lo. Para desfazer, cancele o CT-e.";
export const ONDE_CONFIGURAR = "Empresa → Fiscal";

/** Nome do arquivo no download: a chave, como no XML da NF-e. */
export const nomeDoArquivoDoCte = (chave: string) => `${chave.replace(/\D/g, "")}-procCTe.xml`;

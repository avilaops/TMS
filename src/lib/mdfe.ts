import { z } from "zod";
import { UFS } from "@/lib/roteiro";
import { AMBIENTES, JUSTIFICATIVA_MAXIMA, JUSTIFICATIVA_MINIMA, cnpjValido, limparCnpj, type Ambiente } from "@/lib/cte";

/**
 * Emissão de MDF-e (modelo 58, modal rodoviário, leiaute 3.00): o que a tela e
 * as rotas têm em comum. As situações de um MDF-e, o que a pessoa informa para
 * emitir, encerrar, cancelar e incluir condutor, e o que cada rota devolve.
 *
 * Tudo aqui é puro e também é importado pelas telas: nada daqui pode puxar o
 * que só existe no servidor. A montagem do XML e a conversa com a SEFAZ estão
 * em src/lib/mdfe/; o que grava e lê, em src/lib/mdfe-db.ts. O certificado, a
 * assinatura e o transporte SOAP são os do CT-e (src/lib/cte/).
 *
 * REGRA DA CASA: um MDF-e só é "autorizado", "encerrado" ou "cancelado" com o
 * protocolo que a SEFAZ devolveu. Nada aqui (nem nas rotas, nem na tela) marca
 * isso por conta própria.
 */

export { AMBIENTES, JUSTIFICATIVA_MAXIMA, JUSTIFICATIVA_MINIMA };
export type { Ambiente };

/* ----------------------------------- Tabelas ---------------------------------- */

/** `tpEmit` que este sistema emite (MOC do MDF-e 3.00b, Anexo I, campo 7). */
export const TIPOS_DE_EMITENTE = {
  "1": "Transportadora (relaciona os CT-e das cargas)",
  "2": "Carga própria (relaciona as NF-e das cargas)",
} as const;
export type TipoDeEmitente = keyof typeof TIPOS_DE_EMITENTE;

/** `tpRod`, tipo de rodado do veículo de tração (Anexo I, modal rodoviário). */
export const TIPOS_DE_RODADO = {
  "01": "Truck",
  "02": "Toco",
  "03": "Cavalo mecânico",
  "04": "Van",
  "05": "Utilitário",
  "06": "Outros",
} as const;

/** `tpCar`, tipo de carroceria. */
export const TIPOS_DE_CARROCERIA = {
  "00": "Não aplicável",
  "01": "Aberta",
  "02": "Fechada / baú",
  "03": "Graneleira",
  "04": "Porta-contêiner",
  "05": "Sider",
} as const;

/** `tpProp`, o que o proprietário é do emitente quando o veículo é de terceiro. */
export const TIPOS_DE_PROPRIETARIO = {
  "0": "TAC agregado",
  "1": "TAC independente",
  "2": "Outros",
} as const;

/** `prodPred/tpCarga` (NT 2025.001 do MDF-e, item 3: o 12 entrou nela). */
export const TIPOS_DE_CARGA = {
  "01": "Granel sólido",
  "02": "Granel líquido",
  "03": "Frigorificada",
  "04": "Conteinerizada",
  "05": "Carga geral",
  "06": "Neogranel",
  "07": "Perigosa (granel sólido)",
  "08": "Perigosa (granel líquido)",
  "09": "Perigosa (frigorificada)",
  "10": "Perigosa (conteinerizada)",
  "11": "Perigosa (carga geral)",
  "12": "Granel pressurizada",
} as const;

/** `valePed/categCombVeic`: os valores que o esquema aceita (quantidade de eixos da combinação). */
export const CATEGORIAS_DE_COMBINACAO = {
  "02": "Veículo comercial, 2 eixos",
  "04": "Veículo comercial, 3 eixos",
  "06": "Veículo comercial, 4 eixos",
  "07": "Veículo comercial, 5 eixos",
  "08": "Veículo comercial, 6 eixos",
  "10": "Veículo comercial, 7 eixos",
  "11": "Veículo comercial, 8 eixos",
  "12": "Veículo comercial, 9 eixos",
  "13": "Veículo comercial, 10 eixos",
  "14": "Veículo comercial, acima de 10 eixos",
} as const;

/** `tpValePed` (NT 2025.001: cupom e cartão deixaram de valer). */
export const TIPOS_DE_VALE_PEDAGIO = { "01": "TAG", "04": "Leitura de placa" } as const;

/* ----------------------------------- Prazos ----------------------------------- */

/** Prazo do cancelamento: 24 horas da autorização (MOC 3.00b, Visão Geral, item 6.1.1, regra K04, rejeição 220). */
export const PRAZO_DO_CANCELAMENTO_HORAS = 24;

/**
 * Depois de quantos dias de autorizado, sem encerrar, o sininho avisa.
 *
 * A norma manda encerrar "ao término do último descarregamento" (Ajuste SINIEF
 * 21/10, cláusula décima quarta, I, na redação do Ajuste SINIEF 45/23): não dá
 * um prazo em dias. O que existe é o bloqueio da SEFAZ: ela rejeita MDF-e novo
 * da mesma placa enquanto houver um em aberto há mais de 5 dias com até duas
 * UFs de percurso (regra F87, rejeição 462) e rejeita qualquer MDF-e do
 * emitente enquanto houver um em aberto há mais de 30 dias (regra F86, 686). O
 * aviso sai antes do primeiro bloqueio.
 */
export const DIAS_PARA_AVISAR_ENCERRAMENTO = 3;

/** Os bloqueios da SEFAZ por MDF-e em aberto, em dias (regras F87 e F86). */
export const DIAS_DO_BLOQUEIO_DA_PLACA = 5;
export const DIAS_DO_BLOQUEIO_DO_EMITENTE = 30;

/**
 * NT 2026.001 do MDF-e (Ajuste SINIEF 03/26): o grupo do CIOT passa a ser
 * exigido da transportadora (rejeição 684). Homologação desde 21/09/2026;
 * produção a partir de 23/11/2026.
 */
export const CIOT_OBRIGATORIO_DESDE: Record<Ambiente, string> = { HOMOLOGACAO: "2026-09-21", PRODUCAO: "2026-11-23" };

/** O grupo do CIOT já é exigido neste ambiente, nesta data (dia no relógio de Brasília)? */
export function ciotObrigatorio(ambiente: Ambiente, agora: Date = new Date()): boolean {
  const hoje = new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  return hoje >= CIOT_OBRIGATORIO_DESDE[ambiente];
}

/* ---------------------------------- Validação --------------------------------- */

const INVALIDO = "Dados inválidos.";

const soDigitos = (valor: unknown) => (typeof valor === "string" ? valor.replace(/\D/g, "") : valor);
const emBrancoViraNulo = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? null : valor);
const digitosOuNulo = (valor: unknown) => emBrancoViraNulo(soDigitos(valor));

/** CPF sem pontuação: 11 dígitos, não todos iguais, com os dois dígitos verificadores certos. */
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (tamanho: number) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

/** CPF (11 dígitos) ou CNPJ (14 posições, que podem ter letras), já sem pontuação (`limparCnpj`). */
export const documentoValido = (documento: string) => (documento.length === 11 ? cpfValido(documento) : cnpjValido(documento));

const DOCUMENTO_MESSAGE = "Informe um CPF ou CNPJ válido.";
const documento = (mensagem = DOCUMENTO_MESSAGE) => z.preprocess((valor) => (typeof valor === "string" ? limparCnpj(valor) : valor), z.string(mensagem).refine(documentoValido, mensagem));
const documentoOpcional = (mensagem = DOCUMENTO_MESSAGE) =>
  z.preprocess((valor) => (typeof valor === "string" ? emBrancoViraNulo(limparCnpj(valor)) : valor), z.string(mensagem).refine(documentoValido, mensagem).nullish());
const cnpj = (mensagem: string) => z.preprocess((valor) => (typeof valor === "string" ? limparCnpj(valor) : valor), z.string(mensagem).refine(cnpjValido, mensagem));

const texto = (minimo: number, maximo: number, mensagem: string) => z.string(mensagem).trim().min(minimo, mensagem).max(maximo, mensagem);
const textoOpcional = (maximo: number, mensagem: string) => z.preprocess(emBrancoViraNulo, z.string(mensagem).trim().max(maximo, mensagem).nullish());

// O formulário manda número como texto ("12", "12,5").
const numeroDoFormulario = (valor: unknown) => {
  if (typeof valor !== "string") return valor;
  const limpo = valor.trim();
  return /^\d+([.,]\d+)?$/.test(limpo) ? Number(limpo.replace(",", ".")) : NaN;
};
const VALOR_MESSAGE = "Informe um valor maior que zero.";
const valor = (mensagem = VALOR_MESSAGE) => z.preprocess(numeroDoFormulario, z.number(mensagem).positive(mensagem).max(9_999_999_999, mensagem));

const uf = z.enum(UFS, "UF inválida.");
const id = (mensagem: string) => z.string(mensagem).trim().min(1, mensagem).max(64, mensagem);
const CEP_MESSAGE = "O CEP precisa ter 8 dígitos.";
const cep = z.preprocess(soDigitos, z.string(CEP_MESSAGE).regex(/^\d{8}$/, CEP_MESSAGE));
const DIA_MESSAGE = "Informe a data (AAAA-MM-DD).";
const dia = z.string(DIA_MESSAGE).regex(/^\d{4}-\d{2}-\d{2}$/, DIA_MESSAGE).refine((texto) => !Number.isNaN(new Date(`${texto}T12:00:00Z`).getTime()), DIA_MESSAGE);

/* -------------------------------- Configuração --------------------------------- */

const SERIE_MESSAGE = "A série precisa ser um número de 0 a 919 (de 920 a 969 é de emitente pessoa física).";
const NUMERO_MESSAGE = "O próximo número precisa ser um inteiro de 1 a 999999999.";
export const SEGURO_INCOMPLETO = "Informe a seguradora, o CNPJ dela e a apólice, ou deixe os três em branco.";

/**
 * A configuração do MDF-e da empresa (Notas fiscais → MDF-e → Configuração): série,
 * numeração, tipo de emitente e o seguro da carga que vale por padrão.
 */
export const configuracaoSchema = z
  .object(
    {
      // Série de 920 a 969 é reservada ao emitente com CPF (MOC, Anexo I, regra F69, rejeição 232).
      serie: z.preprocess(numeroDoFormulario, z.number(SERIE_MESSAGE).int(SERIE_MESSAGE).min(0, SERIE_MESSAGE).max(919, SERIE_MESSAGE)),
      proximoNumero: z.preprocess(numeroDoFormulario, z.number(NUMERO_MESSAGE).int(NUMERO_MESSAGE).min(1, NUMERO_MESSAGE).max(999_999_999, NUMERO_MESSAGE)),
      tipoDeEmitente: z.enum(Object.keys(TIPOS_DE_EMITENTE) as [TipoDeEmitente, ...TipoDeEmitente[]], "Escolha o tipo de emitente."),
      seguradora: textoOpcional(30, "Nome da seguradora muito longo (máximo de 30 letras)."),
      cnpjDaSeguradora: z.preprocess(
        (valorBruto) => (typeof valorBruto === "string" ? emBrancoViraNulo(limparCnpj(valorBruto)) : valorBruto),
        z.string("Informe um CNPJ válido para a seguradora.").refine(cnpjValido, "Informe um CNPJ válido para a seguradora.").nullish(),
      ),
      apolice: textoOpcional(20, "Número da apólice muito longo (máximo de 20 letras)."),
    },
    INVALIDO,
  )
  .superRefine((dados, contexto) => {
    const preenchidos = [dados.seguradora, dados.cnpjDaSeguradora, dados.apolice].filter((campo) => campo !== null && campo !== undefined).length;
    if (preenchidos !== 0 && preenchidos !== 3) contexto.addIssue({ code: "custom", message: SEGURO_INCOMPLETO, path: ["seguradora"] });
  });

export type ConfiguracaoDoFormulario = z.infer<typeof configuracaoSchema>;

/** A configuração como a rota a devolve. */
export type ConfiguracaoDoMdfe = {
  /** Os dados fiscais do emitente (Empresa → Fiscal) já existem? Sem eles não há o que configurar. */
  disponivel: boolean;
  ambiente: Ambiente | null;
  serie: number;
  proximoNumero: number;
  tipoDeEmitente: TipoDeEmitente;
  seguradora: string | null;
  cnpjDaSeguradora: string | null;
  apolice: string | null;
};

/* ------------------------------ O que a pessoa informa ------------------------- */

const CIOT_MESSAGE = "O CIOT tem 12 dígitos.";
const NCM_MESSAGE = "O NCM tem 8 dígitos (ou 2, para o capítulo).";

const ciotSchema = z.object(
  {
    codigo: z.preprocess(digitosOuNulo, z.string(CIOT_MESSAGE).regex(/^\d{12}$/, CIOT_MESSAGE).nullish()),
    documento: documento("Informe o CPF ou CNPJ de quem gerou o CIOT."),
  },
  INVALIDO,
);

const valePedagioSchema = z.object(
  {
    categoria: z.enum(Object.keys(CATEGORIAS_DE_COMBINACAO) as [string, ...string[]], "Escolha a categoria de combinação veicular do vale-pedágio."),
    cnpjDoFornecedor: cnpj("Informe o CNPJ da fornecedora do vale-pedágio."),
    pagador: documentoOpcional("Informe um CPF ou CNPJ válido para quem pagou o vale-pedágio."),
    compra: z.preprocess(digitosOuNulo, z.string(INVALIDO).regex(/^\d{1,20}$/, "O identificador do vale-pedágio (IDVPO) tem até 20 dígitos.").nullish()),
    valor: valor("Informe o valor do vale-pedágio."),
    tipo: z.preprocess(emBrancoViraNulo, z.enum(Object.keys(TIPOS_DE_VALE_PEDAGIO) as [string, ...string[]], "Tipo de vale-pedágio inválido.").nullish()),
  },
  INVALIDO,
);

const seguroSchema = z
  .object(
    {
      responsavel: z.enum(["1", "2"], "Escolha o responsável pelo seguro."),
      documento: documentoOpcional("Informe um CPF ou CNPJ válido para o responsável pelo seguro."),
      seguradora: texto(1, 30, "Informe o nome da seguradora (até 30 letras)."),
      cnpjDaSeguradora: cnpj("Informe um CNPJ válido para a seguradora."),
      apolice: texto(1, 20, "Informe o número da apólice (até 20 letras)."),
      averbacoes: z.array(texto(1, 40, "Cada averbação tem de 1 a 40 letras."), INVALIDO).max(20, "No máximo 20 averbações."),
    },
    INVALIDO,
  )
  .superRefine((dados, contexto) => {
    // Regra F93 (rejeição 542): seguro por conta do contratante leva o CPF ou CNPJ dele.
    if (dados.responsavel === "2" && !dados.documento) contexto.addIssue({ code: "custom", message: "Informe o CPF ou CNPJ do contratante responsável pelo seguro.", path: ["documento"] });
  });

const produtoSchema = z.object(
  {
    tipoDeCarga: z.enum(Object.keys(TIPOS_DE_CARGA) as [string, ...string[]], "Escolha o tipo de carga."),
    descricao: texto(1, 120, "Informe o produto predominante (até 120 letras)."),
    ncm: z.preprocess(digitosOuNulo, z.string(NCM_MESSAGE).regex(/^(\d{2}|\d{8})$/, NCM_MESSAGE).nullish()),
  },
  INVALIDO,
);

const lotacaoSchema = z.object({ cepDeCarregamento: cep, cepDeDescarregamento: cep }, INVALIDO);

const contaSchema = z.union(
  [
    z.object({ pix: texto(2, 60, "Informe a chave Pix (até 60 letras).") }),
    z.object({ banco: texto(3, 5, "O código do banco tem de 3 a 5 dígitos."), agencia: texto(1, 10, "Informe a agência (até 10 dígitos).") }),
    z.object({ cnpjDaIpef: cnpj("Informe o CNPJ da instituição de pagamento eletrônico de frete.") }),
  ],
  "Informe para onde vai o pagamento do frete: chave Pix, banco e agência, ou a instituição de pagamento.",
);

const pagamentoSchema = z
  .object(
    {
      nome: textoOpcional(60, "Nome muito longo (máximo de 60 letras)."),
      documento: documento("Informe o CPF ou CNPJ de quem paga o frete."),
      valor: valor("Informe o valor do contrato de frete."),
      aPrazo: z.boolean("Informe se o pagamento é à vista ou a prazo."),
      adiantamento: z.preprocess((bruto) => emBrancoViraNulo(bruto), valor("Informe o adiantamento com um valor maior que zero.").nullish()),
      parcelas: z.array(z.object({ vencimento: dia, valor: valor("Informe o valor da parcela.") }, INVALIDO), INVALIDO).max(60, "No máximo 60 parcelas.").optional(),
      conta: contaSchema,
    },
    INVALIDO,
  )
  .superRefine((dados, contexto) => {
    const parcelas = dados.parcelas ?? [];
    if (!dados.aPrazo) {
      // Regras F53 e F63 (rejeições 729 e 739): à vista não leva parcela nem adiantamento.
      if (parcelas.length > 0 || dados.adiantamento) contexto.addIssue({ code: "custom", message: "Pagamento à vista não tem parcelas nem adiantamento.", path: ["aPrazo"] });
      return;
    }
    // Regra F52 (724): a prazo leva as parcelas. Regra F62 (738): parcelas + adiantamento = contrato, com 1 centavo de tolerância.
    if (parcelas.length === 0) return void contexto.addIssue({ code: "custom", message: "Pagamento a prazo precisa das parcelas.", path: ["parcelas"] });
    const soma = parcelas.reduce((total, parcela) => total + parcela.valor, 0) + (dados.adiantamento ?? 0);
    if (Math.abs(soma - dados.valor) > 0.011) contexto.addIssue({ code: "custom", message: "A soma das parcelas com o adiantamento precisa fechar com o valor do contrato.", path: ["parcelas"] });
    // Regra F61 (737): cada parcela vence depois da anterior.
    if (parcelas.some((parcela, indice) => indice > 0 && parcela.vencimento <= parcelas[indice - 1].vencimento)) {
      contexto.addIssue({ code: "custom", message: "As parcelas precisam estar em ordem de vencimento.", path: ["parcelas"] });
    }
  });

/**
 * O que a pessoa informa para um MDF-e da viagem, além do que o cadastro já
 * sabe. Tudo opcional: o que a norma exige e não foi informado aparece na
 * conferência como pendência.
 */
export const entradasSchema = z.object(
  {
    /** UFs do meio do caminho, na ordem. Ausente = o sistema usa o caminho único, quando há. */
    percurso: z.array(uf, INVALIDO).max(25, "O percurso aceita no máximo 25 UFs.").nullish(),
    ciots: z.array(ciotSchema, INVALIDO).max(10, "No máximo 10 CIOT.").optional(),
    valePedagio: valePedagioSchema.nullish(),
    seguro: seguroSchema.nullish(),
    produto: produtoSchema.nullish(),
    lotacao: lotacaoSchema.nullish(),
    pagamento: pagamentoSchema.nullish(),
    /** Veículos da frota que vão como reboque (até 3). */
    reboques: z.array(id("Reboque inválido."), INVALIDO).max(3, "O MDF-e aceita até 3 reboques.").optional(),
    lacres: z.array(texto(1, 60, "Cada lacre tem de 1 a 60 letras."), INVALIDO).max(50, "No máximo 50 lacres.").optional(),
  },
  INVALIDO,
);

export type EntradasDoMdfe = z.infer<typeof entradasSchema>;

const VIAGEM_MESSAGE = "Informe a viagem.";

/** Conferir ou emitir o MDF-e de uma UF de descarregamento da viagem. */
export const emitirSchema = z.object(
  {
    manifestId: id(VIAGEM_MESSAGE),
    ufDeDescarga: z.enum(UFS, "Informe a UF de descarregamento do MDF-e."),
    entradas: entradasSchema.default({}),
  },
  INVALIDO,
);

export const viagemSchema = z.object({ manifestId: id(VIAGEM_MESSAGE) }, INVALIDO);

/* ----------------------------------- Eventos ---------------------------------- */

const JUSTIFICATIVA_MESSAGE = `A justificativa precisa ter de ${JUSTIFICATIVA_MINIMA} a ${JUSTIFICATIVA_MAXIMA} letras.`;
export const CONFIRME_QUE_NAO_SAIU = "Confirme que o veículo ainda não saiu: MDF-e de transporte iniciado não se cancela, encerra-se.";

/** Cancelamento: a justificativa e a confirmação de que o transporte não começou. */
export const cancelarSchema = z.object(
  {
    justificativa: z.string(JUSTIFICATIVA_MESSAGE).trim().min(JUSTIFICATIVA_MINIMA, JUSTIFICATIVA_MESSAGE).max(JUSTIFICATIVA_MAXIMA, JUSTIFICATIVA_MESSAGE),
    transporteNaoIniciado: z.literal(true, CONFIRME_QUE_NAO_SAIU),
  },
  INVALIDO,
);

/** Encerramento: o dia e o município em que a viagem terminou. */
export const encerrarSchema = z.object(
  {
    dia,
    cidade: texto(2, 60, "Informe a cidade em que a viagem terminou."),
    uf: z.enum(UFS, "Escolha a UF em que a viagem terminou."),
  },
  INVALIDO,
);

export const condutorSchema = z.object(
  {
    nome: texto(2, 60, "Informe o nome do condutor (de 2 a 60 letras)."),
    cpf: z.preprocess(soDigitos, z.string("Informe um CPF válido para o condutor.").refine(cpfValido, "Informe um CPF válido para o condutor.")),
  },
  INVALIDO,
);

/** Ainda dá para pedir o cancelamento? A SEFAZ é quem decide; isto só evita o pedido que ela recusaria (220). */
export function dentroDoPrazoDeCancelamento(autorizadoEm: string | Date | null, agora: Date = new Date()): boolean {
  if (!autorizadoEm) return false;
  const quando = new Date(autorizadoEm).getTime();
  return Number.isFinite(quando) && agora.getTime() - quando <= PRAZO_DO_CANCELAMENTO_HORAS * 3_600_000;
}

/** Há quantos dias inteiros o MDF-e está autorizado. */
export function diasDesde(autorizadoEm: string | Date | null, agora: Date = new Date()): number {
  if (!autorizadoEm) return 0;
  return Math.max(0, Math.floor((agora.getTime() - new Date(autorizadoEm).getTime()) / 86_400_000));
}

/* ------------------------------ Situação do MDF-e ------------------------------ */

export const SITUACOES_DO_MDFE = ["DRAFT", "REJECTED", "AUTHORIZED", "CLOSED", "CANCELLED"] as const;
export type SituacaoDoMdfe = (typeof SITUACOES_DO_MDFE)[number];

export const ROTULO_DA_SITUACAO: Record<SituacaoDoMdfe, string> = {
  DRAFT: "Rascunho",
  REJECTED: "Rejeitado",
  AUTHORIZED: "Autorizado",
  CLOSED: "Encerrado",
  CANCELLED: "Cancelado",
};

export type EventoDoMdfe = {
  id: string;
  tipo: string;
  sequencia: number;
  protocolo: string | null;
  registradoEm: string;
  /** Uma frase do que o evento disse: "Encerrado em Belo Horizonte/MG", "Condutor João da Silva". */
  descricao: string;
};

/** O MDF-e emitido por este sistema, como a lista e a tela o recebem. Sem XML. */
export type MdfeEmitido = {
  id: string;
  manifestId: string;
  /** O código curto da viagem. */
  viagem: string;
  ambiente: Ambiente;
  serie: number;
  numero: number;
  chave: string;
  situacao: SituacaoDoMdfe;
  tipoDeEmitente: TipoDeEmitente;
  ufDeInicio: string;
  ufDeFim: string;
  placa: string;
  cStat: number | null;
  motivo: string | null;
  protocolo: string | null;
  autorizadoEm: string | null;
  encerradoEm: string | null;
  canceladoEm: string | null;
  /** O envio ficou sem resposta: emitir de novo começa consultando a SEFAZ pela chave. */
  semResposta: boolean;
  atualizadoEm: string;
  eventos: EventoDoMdfe[];
};

/** A situação em uma frase curta, para o selo. */
export function seloDoMdfe(mdfe: Pick<MdfeEmitido, "situacao" | "ambiente" | "numero" | "semResposta">): string {
  const sufixo = mdfe.ambiente === "HOMOLOGACAO" ? " (homologação)" : "";
  if (mdfe.situacao === "AUTHORIZED") return `Autorizado nº ${mdfe.numero}${sufixo}`;
  if (mdfe.situacao === "CLOSED") return `Encerrado nº ${mdfe.numero}${sufixo}`;
  if (mdfe.situacao === "CANCELLED") return `Cancelado nº ${mdfe.numero}${sufixo}`;
  if (mdfe.situacao === "REJECTED") return `Rejeitado${sufixo}`;
  return mdfe.semResposta ? `Sem resposta da SEFAZ${sufixo}` : `Rascunho${sufixo}`;
}

/** A empresa está pronta para emitir MDF-e? É o que as telas perguntam ao abrir. */
export type SituacaoDaEmissao = {
  pronta: boolean;
  ambiente: Ambiente | null;
  faltas: string[];
  tipoDeEmitente: TipoDeEmitente | null;
  /** O serviço que gera o DAMDFE em PDF está ligado (`FISCAL_MCP_URL`)? Sem ele a tela não mostra o botão. */
  damdfe: boolean;
};

/* ------------------------------- Conferir e emitir ----------------------------- */

export type DescargaDoResumo = { municipio: string; documentos: number };

/** O que vai no documento, para a pessoa conferir antes de emitir. */
export type ResumoDoMdfe = {
  ambiente: Ambiente;
  serie: number;
  /** O número que o MDF-e vai levar se for emitido agora (pode mudar se outra emissão passar na frente). */
  numeroPrevisto: number;
  tipoDeEmitente: TipoDeEmitente;
  ufDeInicio: string | null;
  ufDeFim: string;
  carregamento: string[];
  /** As UFs do meio. `null`: há mais de um caminho e a pessoa precisa informar. */
  percurso: string[] | null;
  /** Caminhos possíveis para a pessoa escolher, quando há mais de um. */
  opcoesDePercurso: string[][];
  descargas: DescargaDoResumo[];
  documentos: number;
  valorDaCarga: number;
  pesoKg: number;
  placa: string;
  reboques: string[];
  condutor: string;
  /** Carga lotação: um documento só (pede NCM, CEPs e pagamento do frete). */
  lotacao: boolean;
};

/** A conferência de um MDF-e da viagem (uma UF de descarregamento). */
export type ConferenciaDoMdfe = {
  ufDeDescarga: string;
  /** O que impede a emissão, em frases para a pessoa. Vazio = pode emitir. */
  pendencias: string[];
  /** O que não impede, mas a pessoa precisa saber. */
  avisos: string[];
  resumo: ResumoDoMdfe | null;
  /** O que o formulário abre preenchido: o que a pessoa informou da última vez, ou o que o cadastro sugere. */
  entradas: EntradasDoMdfe;
  /** O MDF-e que a viagem já tem para esta UF neste ambiente (o último), se houver. */
  mdfe: MdfeEmitido | null;
};

/** O que a aba "MDF-e" da viagem recebe. */
export type MdfesDaViagem = {
  /** A empresa está pronta para emitir (dados fiscais e certificado válido)? */
  pronta: boolean;
  /** O que falta na empresa, quando não está pronta. */
  faltas: string[];
  ambiente: Ambiente | null;
  damdfe: boolean;
  /** Uma conferência por UF de descarregamento. Vazio: a viagem não tem carga. */
  documentos: ConferenciaDoMdfe[];
  /** Veículos da frota que podem ir como reboque. */
  reboques: { id: string; placa: string }[];
};

/** O que a emissão devolve: o MDF-e como ficou e a frase para a pessoa. */
export type ResultadoDaEmissao = { mdfe: MdfeEmitido; autorizado: boolean; mensagem: string };

export type StatusDoServico = { ambiente: Ambiente; autorizador: string; emOperacao: boolean; cStat: number | null; motivo: string };

/** Um MDF-e que a SEFAZ tem como autorizado e não encerrado. `mdfe` é o registro daqui, quando foi este sistema que emitiu. */
export type NaoEncerradoNaSefaz = { chave: string; protocolo: string; mdfe: Pick<MdfeEmitido, "id" | "numero" | "viagem" | "placa" | "ufDeFim" | "autorizadoEm"> | null };

export type RespostaDeNaoEncerrados = { ambiente: Ambiente; cStat: number; motivo: string; mdfes: NaoEncerradoNaSefaz[] };

/* ----------------------------- Quando a viagem exige --------------------------- */

/**
 * A viagem exige MDF-e? Pelo Ajuste SINIEF 21/10 (cláusula terceira), o MDF-e
 * é obrigatório no transporte interestadual; no transporte dentro do estado
 * (intermunicipal), a obrigação é de cada UF (o § 8º da cláusula deixa a
 * critério da unidade federada, e a maioria já exige).
 *
 * `interestadual`: alguma carga descarrega em UF diferente da de carregamento.
 * `intermunicipal`: alguma carga descarrega em outro município da mesma UF.
 */
export type ExigenciaDeMdfe = "interestadual" | "intermunicipal" | "nenhuma";

export function exigenciaDeMdfe(cargas: readonly { ufDeOrigem: string | null; ufDeDestino: string | null; mesmoMunicipio: boolean }[]): ExigenciaDeMdfe {
  if (cargas.some((carga) => carga.ufDeOrigem && carga.ufDeDestino && carga.ufDeOrigem !== carga.ufDeDestino)) return "interestadual";
  if (cargas.some((carga) => !carga.mesmoMunicipio)) return "intermunicipal";
  return "nenhuma";
}

export const AVISO_DE_VIAGEM_SEM_MDFE: Record<Exclude<ExigenciaDeMdfe, "nenhuma">, string> = {
  interestadual: "Esta viagem cruza a divisa do estado: o MDF-e é obrigatório e ainda não há um autorizado. Emita o CT-e das cargas e o MDF-e (aba MDF-e da viagem) antes de o veículo sair.",
  intermunicipal: "Esta viagem sai do município e ainda não há MDF-e autorizado. Na maioria dos estados o MDF-e é obrigatório também dentro do estado: confira e emita na aba MDF-e da viagem.",
};

/* --------------------------- Documentos antes da saída ------------------------- */

/**
 * O que falta de documento fiscal para a viagem sair.
 *
 * A ordem é obrigação legal: o CT-e tem de estar autorizado antes do início da
 * prestação (Ajuste SINIEF 09/07) e o MDF-e, antes do início da viagem (Ajuste
 * SINIEF 21/10, cláusula terceira: emitido ao fim do carregamento e antes do
 * início do transporte, relacionando os CT-e da carga). No sistema: alocar a carga na
 * viagem → emitir o CT-e → emitir o MDF-e → liberar a saída.
 *
 * - CT-e: da transportadora (tipo de emitente 1), para cada carga que sai do
 *   município (dentro do mesmo município não há prestação sujeita ao ICMS). A
 *   empresa de carga própria (tipo 2) não emite CT-e: o MDF-e dela relaciona as
 *   NF-e.
 * - MDF-e: a mesma regra do aviso (`exigenciaDeMdfe`).
 *
 * Só a empresa que emite pelo TMS em PRODUÇÃO é bloqueada (quem decide é a
 * rota de liberar a saída); em homologação, ou sem emitente configurado (a
 * empresa emite em outro sistema), isto vira só aviso.
 */
export type FaltasParaSair = {
  /** As cargas sem CT-e autorizado. */
  ctes: { id: string; codigo: string }[];
  /** A viagem exige MDF-e e não tem um autorizado: o porquê da exigência. */
  mdfe: Exclude<ExigenciaDeMdfe, "nenhuma"> | null;
};

export type CargaNaSaida = { id: string; codigo: string; ufDeOrigem: string | null; ufDeDestino: string | null; mesmoMunicipio: boolean; cteAutorizado: boolean };

export function faltasParaSair(cargas: readonly CargaNaSaida[], tipoDeEmitente: TipoDeEmitente, mdfeAutorizado: boolean): FaltasParaSair {
  const exigencia = exigenciaDeMdfe(cargas);
  return {
    ctes: tipoDeEmitente === "1" ? cargas.filter((carga) => !carga.mesmoMunicipio && !carga.cteAutorizado).map(({ id, codigo }) => ({ id, codigo })) : [],
    mdfe: exigencia !== "nenhuma" && !mdfeAutorizado ? exigencia : null,
  };
}

export const haFaltasParaSair = (faltas: FaltasParaSair) => faltas.ctes.length > 0 || faltas.mdfe !== null;

/** A frase do bloqueio da saída (resposta 409 de liberar a saída). */
export function fraseDoBloqueioDaSaida(faltas: FaltasParaSair): string {
  const partes: string[] = [];
  if (faltas.ctes.length > 0) partes.push(`CT-e autorizado de ${faltas.ctes.length === 1 ? "1 carga" : `${faltas.ctes.length} cargas`} (${faltas.ctes.map((carga) => carga.codigo).join(", ")})`);
  if (faltas.mdfe) partes.push("MDF-e autorizado da viagem");
  return `A saída não foi liberada. Falta: ${partes.join(" e ")}. Os documentos têm de estar autorizados antes de o veículo sair (Ajustes SINIEF 09/07 e 21/10).`;
}

/* ---------------------------------- Mensagens --------------------------------- */

export const MDFE_NAO_ENCONTRADO = "MDF-e não encontrado.";
export const VIAGEM_NAO_ENCONTRADA = "Viagem não encontrada.";
export const VIAGEM_CANCELADA = "Viagem cancelada não recebe MDF-e.";
export const SEM_CARGA_PARA_A_UF = "A viagem não tem carga com descarga nesta UF.";
export const JA_AUTORIZADO = "Esta viagem já tem MDF-e autorizado para esta UF neste ambiente.";
export const EMISSAO_EM_ANDAMENTO = "Já há uma emissão deste MDF-e em andamento. Aguarde a resposta da SEFAZ.";
export const SO_AUTORIZADO_ENCERRA = "Só MDF-e autorizado pode ser encerrado.";
export const SO_AUTORIZADO_CANCELA = "Só MDF-e autorizado (e ainda não encerrado) pode ser cancelado.";
export const SO_AUTORIZADO_RECEBE_EVENTO = "Só MDF-e autorizado (e ainda não encerrado) recebe este evento.";
export const SO_AUTORIZADO_TEM_XML = "Só MDF-e autorizado tem XML para baixar.";
export const SO_AUTORIZADO_TEM_DAMDFE = "Só MDF-e autorizado (e não cancelado) tem DAMDFE.";
export const FORA_DO_PRAZO = "O prazo de cancelamento (24 horas da autorização) já passou. Encerre o MDF-e.";
export const TRANSPORTE_JA_INICIADO = "Esta viagem já tem entrega feita ou foi finalizada: o transporte começou, e MDF-e de transporte iniciado não se cancela. Encerre o MDF-e.";
export const DATA_DE_ENCERRAMENTO_INVALIDA = "A data do encerramento não pode ser anterior à emissão do MDF-e nem depois de hoje.";
/** Onde ficam a série, o tipo de emitente e o seguro padrão do MDF-e (só o administrador). */
export const ONDE_CONFIGURAR_O_MDFE = "Notas fiscais → MDF-e → Configuração";

/** Nome do arquivo no download do XML autorizado. */
export const nomeDoArquivoDoMdfe = (chave: string) => `${chave.replace(/[^0-9A-Za-z]/g, "")}-procMDFe.xml`;

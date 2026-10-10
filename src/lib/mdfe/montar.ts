import type { Ambiente } from "@/lib/cte";
import { CODIGO_DA_UF, TIPO_DE_EMISSAO_NORMAL, dataHoraDoEvento, dataHoraDoXml } from "@/lib/cte/chave";
import type { AlvoDaAssinatura } from "@/lib/cte/assinar";
import { codigoDoAmbiente } from "@/lib/cte/enderecos";
import type { EnderecoDoCte } from "@/lib/cte/montar";
import { responsavelTecnicoDoXml, type ResponsavelTecnico } from "@/lib/cte/responsavel-tecnico";
import { centavos, decimal, digitos, escapar, grupo, tag, textoDoXml } from "@/lib/cte/texto";
import { MODELO_DO_MDFE, chaveDoMdfe } from "@/lib/mdfe/chave";

/**
 * Monta o XML do MDF-e (modelo 58, modal rodoviário, leiaute 3.00), ainda sem
 * assinatura, e os XML dos eventos e das consultas. Funções puras: recebem os
 * dados já resolvidos (códigos IBGE, chaves dos documentos, veículo) e devolvem
 * o XML. Quem resolve os dados a partir da viagem é src/lib/mdfe/preparar.ts.
 *
 * O XML sai numa linha só, sem espaço entre as tags e sem campo opcional vazio
 * (MOC do MDF-e 3.00b, Visão Geral, item 3.2.5). A ordem dos elementos é a do
 * pacote de esquemas PL_MDFe_300b_NT012025 (fiscal/esquemas/mdfe-3.00, tipo
 * `TMDFe` e `mdfeModalRodoviario_v3.00.xsd`); os testes validam o resultado
 * contra esses esquemas.
 *
 * O que este MDF-e é, sempre: emissão normal (`tpEmis` 1), pelo aplicativo do
 * contribuinte (`procEmi` 0), modal rodoviário (`modal` 1), emitente com CNPJ.
 *
 * O que NÃO é montado: contingência, emitente pessoa física, CT-e globalizado
 * (`tpEmit` 3), produtos perigosos (`peri`), unidades de transporte e de carga
 * (`infUnidTransp`), autorizados ao XML (`autXML`), responsável técnico
 * (`infRespTec`: a regra F120 é facultativa e "a critério da UF") e o MDF-e
 * referenciado do modal aquaviário. O MDF-e 3.00 não tem grupo de IBS/CBS: a
 * Reforma Tributária não mudou este leiaute até o pacote de 25/04/2026.
 */

export const NAMESPACE_DO_MDFE = "http://www.portalfiscal.inf.br/mdfe";
export const VERSAO_DO_MDFE = "3.00";
/** Versão do aplicativo emissor (`ide/verProc`, até 20 letras). */
export const VERSAO_DO_EMISSOR = "TMS Avila Ops 1.0";

export const ALVO_DO_MDFE: AlvoDaAssinatura = { assinado: "infMDFe", pai: "MDFe" };
export const ALVO_DO_EVENTO_DO_MDFE: AlvoDaAssinatura = { assinado: "infEvento", pai: "eventoMDFe" };

/** `tpEmit`: 1 = prestador de serviço de transporte (relaciona CT-e), 2 = transportador de carga própria (relaciona NF-e). */
export type TipoDeEmitente = "1" | "2";

export type EmitenteDoMdfe = {
  cnpj: string;
  ie: string;
  razaoSocial: string;
  fantasia?: string | null;
  endereco: EnderecoDoCte;
  telefone?: string | null;
  /** RNTRC do emitente, 8 dígitos. Vazio em carga própria sem registro na ANTT. */
  rntrc?: string | null;
  serie: number;
  ambiente: Ambiente;
  tipo: TipoDeEmitente;
};

export type MunicipioDoMdfe = { codigo: string; nome: string };

/** Os documentos descarregados num município: chaves de CT-e (emitente tipo 1) ou de NF-e (tipo 2). */
export type DescargaDoMdfe = { municipio: MunicipioDoMdfe; chaves: readonly string[] };

export type ProprietarioDoVeiculo = {
  /** CPF (11) ou CNPJ (14). */
  documento: string;
  rntrc: string;
  nome: string;
  /** Só dígitos, "ISENTO" ou vazio. */
  ie?: string | null;
  uf: string;
  /** `tpProp`: 0 = TAC agregado, 1 = TAC independente, 2 = outros. */
  tipo: "0" | "1" | "2";
};

export type CondutorDoMdfe = { nome: string; cpf: string };

type VeiculoDoMdfe = {
  placa: string;
  renavam?: string | null;
  taraKg: number;
  capacidadeKg?: number | null;
  /** `tpCar`: 00 a 05. */
  carroceria: string;
  /** UF em que o veículo está licenciado. */
  uf?: string | null;
  /** Só quando o veículo não é do emitente. */
  proprietario?: ProprietarioDoVeiculo | null;
};

export type TracaoDoMdfe = VeiculoDoMdfe & {
  /** `tpRod`: 01 a 06. */
  rodado: string;
  condutores: readonly CondutorDoMdfe[];
};

/** O reboque: no esquema a capacidade em kg é obrigatória. */
export type ReboqueDoMdfe = VeiculoDoMdfe & { capacidadeKg: number };

export type CiotDoMdfe = {
  /** O código (12 dígitos). Opcional no esquema desde a NT 2025.001. */
  codigo?: string | null;
  /** CPF ou CNPJ de quem gerou o CIOT. */
  documento: string;
};

export type ValePedagioDoMdfe = {
  /** `categCombVeic`: obrigatória com o grupo (regra F95). */
  categoria: string;
  dispositivos: readonly {
    cnpjDoFornecedor: string;
    /** CPF ou CNPJ de quem pagou. */
    pagador?: string | null;
    /** Identificador do vale-pedágio obrigatório (IDVPO). */
    compra?: string | null;
    valor: number;
    /** `tpValePed`: 01 = TAG, 04 = leitura de placa. */
    tipo?: string | null;
  }[];
};

export type ContratanteDoMdfe = { nome?: string | null; documento: string };

/** Para onde vai o pagamento do frete (`infBanc`): uma das três formas. */
export type ContaDoPagamento = { pix: string } | { banco: string; agencia: string } | { cnpjDaIpef: string };

export type PagamentoDoMdfe = {
  /** Quem paga o frete. */
  nome?: string | null;
  documento: string;
  valor: number;
  /** Componentes do pagamento. Vazio: um só, "04 - Frete", com o valor do contrato. */
  componentes?: readonly { tipo: "01" | "02" | "03" | "04" | "99"; valor: number; descricao?: string | null }[];
  /** `false`: à vista. `true`: a prazo, com as parcelas. */
  aPrazo: boolean;
  adiantamento?: number | null;
  parcelas?: readonly { vencimento: string; valor: number }[];
  conta: ContaDoPagamento;
};

export type SeguroDoMdfe = {
  /** `respSeg`: 1 = o emitente do MDF-e, 2 = o contratante do serviço. */
  responsavel: "1" | "2";
  /** CPF ou CNPJ do responsável (obrigatório quando é o contratante: regra F93). */
  documento?: string | null;
  seguradora: string;
  cnpjDaSeguradora: string;
  apolice: string;
  averbacoes: readonly string[];
};

export type ProdutoDoMdfe = {
  /** `tpCarga`: 01 a 12. */
  tipoDeCarga: string;
  descricao: string;
  ncm?: string | null;
  /** Carga lotação (um documento só): os CEPs de carregamento e de descarregamento. */
  lotacao?: { cepDeCarregamento: string; cepDeDescarregamento: string } | null;
};

export type RodoviarioDoMdfe = {
  ciots: readonly CiotDoMdfe[];
  valePedagio?: ValePedagioDoMdfe | null;
  contratantes: readonly ContratanteDoMdfe[];
  pagamentos: readonly PagamentoDoMdfe[];
  tracao: TracaoDoMdfe;
  reboques: readonly ReboqueDoMdfe[];
};

export type DadosDoMdfe = {
  emitente: EmitenteDoMdfe;
  numero: number;
  /** Código numérico aleatório, 8 dígitos (`cMDF`). */
  codigo: string;
  emissao: Date;
  ufDeInicio: string;
  ufDeFim: string;
  /** Municípios de carregamento (1 a 50), todos na UF de início. */
  carregamento: readonly MunicipioDoMdfe[];
  /** UFs do meio do caminho, na ordem (src/lib/mdfe/percurso.ts). */
  percurso: readonly string[];
  inicioDaViagem?: Date | null;
  /** `indCarregaPosterior`: MDF-e de carga própria emitido antes de carregar; os documentos entram por evento. */
  carregamentoPosterior?: boolean;
  descargas: readonly DescargaDoMdfe[];
  rodo: RodoviarioDoMdfe;
  seguros: readonly SeguroDoMdfe[];
  produto?: ProdutoDoMdfe | null;
  valorDaCarga: number;
  pesoKg: number;
  lacres?: readonly string[];
  observacao?: string | null;
  /** Endereço da consulta por QR Code (src/lib/mdfe/enderecos.ts). */
  enderecoDoQrCode: string;
  /** A desenvolvedora do sistema (`infRespTec`, depois de `infAdic` no esquema). Nulo ou ausente: o MDF-e vai sem o grupo. */
  responsavelTecnico?: ResponsavelTecnico | null;
};

export type MdfeMontado = { xml: string; chave: string; id: string; tipoDeTransportador: "1" | "2" | null; documentos: number };

/* ------------------------------------ Regras ---------------------------------- */

/**
 * `tpTransp` (MOC, Anexo I, regras F18 a F20): só vai quando o veículo de tração
 * é de terceiro. Proprietário com CPF é TAC (2); com CNPJ, ETC (1). A
 * cooperativa (CTC, 3) não é montada por este sistema.
 */
export function tipoDeTransportador(proprietario: ProprietarioDoVeiculo | null | undefined): "1" | "2" | null {
  if (!proprietario) return null;
  return proprietario.documento.length === 11 ? "2" : "1";
}

/** Quantos documentos fiscais o MDF-e relaciona. */
export const totalDeDocumentos = (descargas: readonly DescargaDoMdfe[]) => descargas.reduce((soma, descarga) => soma + new Set(descarga.chaves).size, 0);

/* ------------------------------------- XML ------------------------------------ */

const documentoDoXml = (documento: string) => (documento.length === 11 ? tag("CPF", documento) : tag("CNPJ", documento));

/** `fone` do emitente: de 7 a 12 dígitos no esquema do MDF-e. Fora disso fica de fora. */
const telefoneDoXml = (telefone: string | null | undefined) => {
  const numeros = digitos(telefone);
  return numeros.length >= 7 && numeros.length <= 12 ? tag("fone", numeros) : "";
};

/** Inteiro em kg como o esquema quer: sem zero à esquerda, até 6 dígitos. */
const quilos = (valor: number) => String(Math.min(999_999, Math.max(0, Math.round(valor))));

function enderecoDoEmitente(emitente: EmitenteDoMdfe): string {
  const { endereco } = emitente;
  const cep = digitos(endereco.cep);
  return [
    tag("xLgr", textoDoXml(endereco.logradouro, 60)),
    tag("nro", textoDoXml(endereco.numero, 60) || "S/N"),
    tag("xCpl", textoDoXml(endereco.complemento, 60)),
    tag("xBairro", textoDoXml(endereco.bairro, 60)),
    tag("cMun", endereco.codigoMunicipio),
    tag("xMun", textoDoXml(endereco.municipio, 60)),
    cep.length === 8 ? tag("CEP", cep) : "",
    tag("UF", endereco.uf),
    telefoneDoXml(emitente.telefone),
  ].join("");
}

function proprietarioDoXml(proprietario: ProprietarioDoVeiculo | null | undefined): string {
  if (!proprietario) return "";
  const ie = (proprietario.ie ?? "").trim().toUpperCase();
  const inscricao = ie === "ISENTO" || ie === "ISENTA" ? "ISENTO" : digitos(ie).slice(0, 14);
  return grupo(
    "prop",
    [
      documentoDoXml(proprietario.documento),
      tag("RNTRC", digitos(proprietario.rntrc)),
      tag("xNome", textoDoXml(proprietario.nome, 60)),
      // A inscrição é obrigatória no esquema, e pode ir vazia (proprietário sem inscrição).
      `<IE>${inscricao}</IE>`,
      tag("UF", proprietario.uf),
      tag("tpProp", proprietario.tipo),
    ].join(""),
  );
}

function veiculoDoXml(veiculo: VeiculoDoMdfe): string {
  return [
    tag("placa", veiculo.placa),
    tag("RENAVAM", digitos(veiculo.renavam)),
    tag("tara", quilos(veiculo.taraKg)),
    veiculo.capacidadeKg === null || veiculo.capacidadeKg === undefined ? "" : tag("capKG", quilos(veiculo.capacidadeKg)),
    proprietarioDoXml(veiculo.proprietario),
  ].join("");
}

function pagamentoDoXml(pagamento: PagamentoDoMdfe): string {
  const total = centavos(pagamento.valor);
  const informados = (pagamento.componentes ?? []).map((c) => ({ ...c, valor: centavos(c.valor) })).filter((c) => c.valor > 0);
  const soma = centavos(informados.reduce((acumulado, c) => acumulado + c.valor, 0));
  // A soma dos componentes tem de fechar com o contrato (regra F58, rejeição 746); senão vai um só, com o total.
  const componentes = informados.length > 0 && soma === total ? informados : [{ tipo: "04" as const, valor: total, descricao: null }];
  const conta = pagamento.conta;
  const banco =
    "pix" in conta
      ? tag("PIX", textoDoXml(conta.pix, 60))
      : "cnpjDaIpef" in conta
        ? tag("CNPJIPEF", conta.cnpjDaIpef)
        : tag("codBanco", textoDoXml(conta.banco, 5)) + tag("codAgencia", textoDoXml(conta.agencia, 10));
  return grupo(
    "infPag",
    [
      tag("xNome", textoDoXml(pagamento.nome, 60)),
      documentoDoXml(pagamento.documento),
      componentes
        .map((c) => grupo("Comp", tag("tpComp", c.tipo) + tag("vComp", decimal(c.valor, 2)) + (c.tipo === "99" ? tag("xComp", textoDoXml(c.descricao, 60)) : "")))
        .join(""),
      tag("vContrato", decimal(total, 2)),
      tag("indPag", pagamento.aPrazo ? "1" : "0"),
      // Adiantamento e parcelas só existem no pagamento a prazo (regras F53 e F63).
      pagamento.aPrazo && pagamento.adiantamento ? tag("vAdiant", decimal(centavos(pagamento.adiantamento), 2)) : "",
      pagamento.aPrazo
        ? (pagamento.parcelas ?? [])
            .map((parcela, indice) => grupo("infPrazo", tag("nParcela", String(indice + 1).padStart(3, "0")) + tag("dVenc", parcela.vencimento) + tag("vParcela", decimal(centavos(parcela.valor), 2))))
            .join("")
        : "",
      grupo("infBanc", banco),
    ].join(""),
  );
}

/** O grupo do modal rodoviário (`rodo`), que tem esquema próprio (mdfeModalRodoviario_v3.00.xsd). */
export function montarModalRodoviario(rntrc: string | null | undefined, rodo: RodoviarioDoMdfe): string {
  const valePedagio = rodo.valePedagio
    ? grupo(
        "valePed",
        rodo.valePedagio.dispositivos
          .map((dispositivo) =>
            grupo(
              "disp",
              [
                tag("CNPJForn", dispositivo.cnpjDoFornecedor),
                dispositivo.pagador ? (dispositivo.pagador.length === 11 ? tag("CPFPg", dispositivo.pagador) : tag("CNPJPg", dispositivo.pagador)) : "",
                tag("nCompra", digitos(dispositivo.compra).slice(0, 20)),
                tag("vValePed", decimal(centavos(dispositivo.valor), 2)),
                tag("tpValePed", dispositivo.tipo),
              ].join(""),
            ),
          )
          .join("") + tag("categCombVeic", rodo.valePedagio.categoria),
      )
    : "";

  const infANTT = grupo(
    "infANTT",
    [
      tag("RNTRC", digitos(rntrc)),
      rodo.ciots.map((ciot) => grupo("infCIOT", tag("CIOT", digitos(ciot.codigo)) + documentoDoXml(ciot.documento))).join(""),
      valePedagio,
      rodo.contratantes.map((contratante) => grupo("infContratante", tag("xNome", textoDoXml(contratante.nome, 60)) + documentoDoXml(contratante.documento))).join(""),
      rodo.pagamentos.map(pagamentoDoXml).join(""),
    ].join(""),
  );

  const veicTracao = grupo(
    "veicTracao",
    [
      veiculoDoXml(rodo.tracao),
      rodo.tracao.condutores.map((condutor) => grupo("condutor", tag("xNome", textoDoXml(condutor.nome, 60)) + tag("CPF", condutor.cpf))).join(""),
      tag("tpRod", rodo.tracao.rodado),
      tag("tpCar", rodo.tracao.carroceria),
      tag("UF", rodo.tracao.uf),
    ].join(""),
  );

  const reboques = rodo.reboques.map((reboque) => grupo("veicReboque", veiculoDoXml(reboque) + tag("tpCar", reboque.carroceria) + tag("UF", reboque.uf))).join("");

  return grupo("rodo", infANTT + veicTracao + reboques);
}

function seguroDoXml(seguro: SeguroDoMdfe): string {
  return grupo(
    "seg",
    [
      grupo("infResp", tag("respSeg", seguro.responsavel) + (seguro.documento ? documentoDoXml(seguro.documento) : "")),
      grupo("infSeg", tag("xSeg", textoDoXml(seguro.seguradora, 30)) + tag("CNPJ", seguro.cnpjDaSeguradora)),
      tag("nApol", textoDoXml(seguro.apolice, 20)),
      seguro.averbacoes.map((averbacao) => tag("nAver", textoDoXml(averbacao, 40))).join(""),
    ].join(""),
  );
}

function produtoDoXml(produto: ProdutoDoMdfe | null | undefined): string {
  if (!produto) return "";
  const lotacao = produto.lotacao
    ? grupo("infLotacao", grupo("infLocalCarrega", tag("CEP", produto.lotacao.cepDeCarregamento)) + grupo("infLocalDescarrega", tag("CEP", produto.lotacao.cepDeDescarregamento)))
    : "";
  return grupo("prodPred", tag("tpCarga", produto.tipoDeCarga) + tag("xProd", textoDoXml(produto.descricao, 120) || "DIVERSOS") + tag("NCM", digitos(produto.ncm)) + lotacao);
}

/** A URL do QR Code (MOC, Visão Geral, item 9.2.1, emissão normal): endereço + `?chMDFe=<chave>&tpAmb=<ambiente>`. */
export const urlDoQrCode = (endereco: string, chave: string, ambiente: Ambiente) => `${endereco}?chMDFe=${chave}&tpAmb=${codigoDoAmbiente(ambiente)}`;

/** Monta o MDF-e. Dado fora do formato é erro de programação: quem chama já conferiu (src/lib/mdfe/preparar.ts). */
export function montarMdfe(dados: DadosDoMdfe): MdfeMontado {
  const { emitente } = dados;
  const ambiente = emitente.ambiente;
  const chave = chaveDoMdfe({ uf: emitente.endereco.uf, emissao: dados.emissao, cnpj: emitente.cnpj, serie: emitente.serie, numero: dados.numero, codigo: dados.codigo });
  const id = `MDFe${chave}`;
  const tpTransp = tipoDeTransportador(dados.rodo.tracao.proprietario);
  const doCte = emitente.tipo === "1";

  const ide = grupo(
    "ide",
    [
      tag("cUF", CODIGO_DA_UF[emitente.endereco.uf]),
      tag("tpAmb", codigoDoAmbiente(ambiente)),
      tag("tpEmit", emitente.tipo),
      tag("tpTransp", tpTransp),
      tag("mod", MODELO_DO_MDFE),
      tag("serie", String(emitente.serie)),
      tag("nMDF", String(dados.numero)),
      tag("cMDF", dados.codigo),
      tag("cDV", chave.slice(43)),
      tag("modal", "1"),
      tag("dhEmi", dataHoraDoXml(dados.emissao, emitente.endereco.uf)),
      tag("tpEmis", TIPO_DE_EMISSAO_NORMAL),
      tag("procEmi", "0"),
      tag("verProc", VERSAO_DO_EMISSOR),
      tag("UFIni", dados.ufDeInicio),
      tag("UFFim", dados.ufDeFim),
      dados.carregamento.map((municipio) => grupo("infMunCarrega", tag("cMunCarrega", municipio.codigo) + tag("xMunCarrega", textoDoXml(municipio.nome, 60)))).join(""),
      dados.percurso.map((uf) => grupo("infPercurso", tag("UFPer", uf))).join(""),
      dados.inicioDaViagem ? tag("dhIniViagem", dataHoraDoXml(dados.inicioDaViagem, emitente.endereco.uf)) : "",
      dados.carregamentoPosterior ? tag("indCarregaPosterior", "1") : "",
    ].join(""),
  );

  const emit = grupo(
    "emit",
    [
      tag("CNPJ", emitente.cnpj),
      tag("IE", digitos(emitente.ie)),
      tag("xNome", textoDoXml(emitente.razaoSocial, 60)),
      tag("xFant", textoDoXml(emitente.fantasia, 60)),
      grupo("enderEmit", enderecoDoEmitente(emitente)),
    ].join(""),
  );

  const infModal = grupo("infModal", montarModalRodoviario(emitente.rntrc, dados.rodo), ` versaoModal="${VERSAO_DO_MDFE}"`);

  const infDoc = grupo(
    "infDoc",
    dados.descargas
      .map((descarga) =>
        grupo(
          "infMunDescarga",
          tag("cMunDescarga", descarga.municipio.codigo) +
            tag("xMunDescarga", textoDoXml(descarga.municipio.nome, 60)) +
            [...new Set(descarga.chaves)].map((chaveDoDocumento) => (doCte ? grupo("infCTe", tag("chCTe", chaveDoDocumento)) : grupo("infNFe", tag("chNFe", chaveDoDocumento)))).join(""),
        ),
      )
      .join(""),
  );

  const documentos = totalDeDocumentos(dados.descargas);
  const tot = grupo(
    "tot",
    [
      // A quantidade tem de fechar com os documentos relacionados (regra F51, rejeição 667).
      documentos > 0 ? tag(doCte ? "qCTe" : "qNFe", String(documentos)) : "",
      tag("vCarga", decimal(centavos(dados.valorDaCarga), 2)),
      tag("cUnid", "01"),
      tag("qCarga", decimal(dados.pesoKg, 4)),
    ].join(""),
  );

  const infMDFe = grupo(
    "infMDFe",
    [
      ide,
      emit,
      infModal,
      infDoc,
      dados.seguros.map(seguroDoXml).join(""),
      produtoDoXml(dados.produto),
      tot,
      (dados.lacres ?? []).map((lacre) => grupo("lacres", tag("nLacre", textoDoXml(lacre, 60)))).join(""),
      grupo("infAdic", tag("infCpl", textoDoXml(dados.observacao, 5000))),
      responsavelTecnicoDoXml(dados.responsavelTecnico),
    ].join(""),
    ` versao="${VERSAO_DO_MDFE}" Id="${id}"`,
  );

  const infMDFeSupl = grupo("infMDFeSupl", `<qrCodMDFe>${escapar(urlDoQrCode(dados.enderecoDoQrCode, chave, ambiente))}</qrCodMDFe>`);

  return { xml: `<MDFe xmlns="${NAMESPACE_DO_MDFE}">${infMDFe}${infMDFeSupl}</MDFe>`, chave, id, tipoDeTransportador: tpTransp, documentos };
}

/** O MDF-e autorizado com o protocolo (`mdfeProc`): é o arquivo que a transportadora guarda. */
export function montarProcMdfe(xmlAssinado: string, protocolo: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><mdfeProc xmlns="${NAMESPACE_DO_MDFE}" versao="${VERSAO_DO_MDFE}">${xmlAssinado}${protocolo}</mdfeProc>`;
}

/* ----------------------------------- Eventos ---------------------------------- */

/** Os eventos do emitente que este sistema envia (MOC, Visão Geral, item 6). */
export const TIPO_DO_EVENTO = {
  CANCELAMENTO: "110111",
  ENCERRAMENTO: "110112",
  INCLUSAO_DE_CONDUTOR: "110114",
  INCLUSAO_DE_DFE: "110115",
} as const;
export type TipoDoEvento = (typeof TIPO_DO_EVENTO)[keyof typeof TIPO_DO_EVENTO];

type BaseDoEvento = {
  chave: string;
  /** CNPJ do emitente (o autor do evento). */
  cnpj: string;
  ambiente: Ambiente;
  quando: Date;
};

export type EventoMontado = { xml: string; id: string; tipo: TipoDoEvento; sequencia: number };

/**
 * O envelope do evento, ainda sem assinatura (MOC, Visão Geral, item 5.1). O Id
 * é "ID" + tipo do evento + chave + sequência com 2 dígitos (até 99); o órgão é
 * a UF do emitente (os 2 primeiros dígitos da chave).
 */
function montarEvento(base: BaseDoEvento, tipo: TipoDoEvento, sequencia: number, detalhe: string): EventoMontado {
  const id = `ID${tipo}${base.chave}${String(sequencia).padStart(2, "0")}`;
  const infEvento = grupo(
    "infEvento",
    [
      tag("cOrgao", base.chave.slice(0, 2)),
      tag("tpAmb", codigoDoAmbiente(base.ambiente)),
      tag("CNPJ", base.cnpj),
      tag("chMDFe", base.chave),
      tag("dhEvento", dataHoraDoEvento(base.quando, base.chave)),
      tag("tpEvento", tipo),
      tag("nSeqEvento", String(sequencia)),
      grupo("detEvento", detalhe, ` versaoEvento="${VERSAO_DO_MDFE}"`),
    ].join(""),
    ` Id="${id}"`,
  );
  return { xml: `<eventoMDFe xmlns="${NAMESPACE_DO_MDFE}" versao="${VERSAO_DO_MDFE}">${infEvento}</eventoMDFe>`, id, tipo, sequencia };
}

/** Cancelamento (110111): o protocolo de autorização e a justificativa (15 a 255 letras). Sequência sempre 1 (regra K01). */
export function montarCancelamento(dados: BaseDoEvento & { protocolo: string; justificativa: string }): EventoMontado {
  return montarEvento(
    dados,
    TIPO_DO_EVENTO.CANCELAMENTO,
    1,
    grupo("evCancMDFe", tag("descEvento", "Cancelamento") + tag("nProt", dados.protocolo) + tag("xJust", textoDoXml(dados.justificativa, 255))),
  );
}

/** Encerramento (110112): o protocolo, o dia (AAAA-MM-DD) e o município em que a viagem terminou. Sequência sempre 1. */
export function montarEncerramento(dados: BaseDoEvento & { protocolo: string; dia: string; municipio: { codigo: string; uf: string } }): EventoMontado {
  return montarEvento(
    dados,
    TIPO_DO_EVENTO.ENCERRAMENTO,
    1,
    grupo(
      "evEncMDFe",
      tag("descEvento", "Encerramento") + tag("nProt", dados.protocolo) + tag("dtEnc", dados.dia) + tag("cUF", CODIGO_DA_UF[dados.municipio.uf]) + tag("cMun", dados.municipio.codigo),
    ),
  );
}

/** Inclusão de condutor (110114): um condutor por evento, sequência de 1 a 99. */
export function montarInclusaoDeCondutor(dados: BaseDoEvento & { sequencia: number; condutor: CondutorDoMdfe }): EventoMontado {
  return montarEvento(
    dados,
    TIPO_DO_EVENTO.INCLUSAO_DE_CONDUTOR,
    dados.sequencia,
    grupo("evIncCondutorMDFe", tag("descEvento", "Inclusao Condutor") + grupo("condutor", tag("xNome", textoDoXml(dados.condutor.nome, 60)) + tag("CPF", dados.condutor.cpf))),
  );
}

/**
 * Inclusão de DF-e (110115): só para MDF-e de carga própria emitido com
 * `indCarregaPosterior` (regra K05, rejeição 708). O esquema só aceita NF-e.
 */
export function montarInclusaoDeDfe(
  dados: BaseDoEvento & { sequencia: number; protocolo: string; carregamento: MunicipioDoMdfe; documentos: readonly { descarga: MunicipioDoMdfe; chave: string }[] },
): EventoMontado {
  return montarEvento(
    dados,
    TIPO_DO_EVENTO.INCLUSAO_DE_DFE,
    dados.sequencia,
    grupo(
      "evIncDFeMDFe",
      [
        tag("descEvento", "Inclusao DF-e"),
        tag("nProt", dados.protocolo),
        tag("cMunCarrega", dados.carregamento.codigo),
        tag("xMunCarrega", textoDoXml(dados.carregamento.nome, 60)),
        dados.documentos
          .map((documento) => grupo("infDoc", tag("cMunDescarga", documento.descarga.codigo) + tag("xMunDescarga", textoDoXml(documento.descarga.nome, 60)) + tag("chNFe", documento.chave)))
          .join(""),
      ].join(""),
    ),
  );
}

/** O evento registrado com o retorno da SEFAZ (`procEventoMDFe`): é o que fica guardado. */
export function montarProcEvento(eventoAssinado: string, retorno: string): string {
  return `<procEventoMDFe xmlns="${NAMESPACE_DO_MDFE}" versao="${VERSAO_DO_MDFE}">${eventoAssinado}${retorno}</procEventoMDFe>`;
}

/* ---------------------------------- Consultas --------------------------------- */

/** Status do serviço. No MDF-e a mensagem não leva a UF: o autorizador é nacional. */
export function mensagemDeStatus(ambiente: Ambiente): string {
  return `<consStatServMDFe xmlns="${NAMESPACE_DO_MDFE}" versao="${VERSAO_DO_MDFE}"><tpAmb>${codigoDoAmbiente(ambiente)}</tpAmb><xServ>STATUS</xServ></consStatServMDFe>`;
}

export function mensagemDeConsulta(chave: string, ambiente: Ambiente): string {
  return `<consSitMDFe xmlns="${NAMESPACE_DO_MDFE}" versao="${VERSAO_DO_MDFE}"><tpAmb>${codigoDoAmbiente(ambiente)}</tpAmb><xServ>CONSULTAR</xServ><chMDFe>${chave}</chMDFe></consSitMDFe>`;
}

/** Consulta dos MDF-e não encerrados do emitente (MOC, Visão Geral, item 4.4). */
export function mensagemDeNaoEncerrados(cnpj: string, ambiente: Ambiente): string {
  return `<consMDFeNaoEnc xmlns="${NAMESPACE_DO_MDFE}" versao="${VERSAO_DO_MDFE}"><tpAmb>${codigoDoAmbiente(ambiente)}</tpAmb><xServ>CONSULTAR NÃO ENCERRADOS</xServ><CNPJ>${cnpj}</CNPJ></consMDFeNaoEnc>`;
}

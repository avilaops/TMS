import { ALIQUOTAS_DE_2026, NOME_EM_HOMOLOGACAO, ONDE_CONFIGURAR, problemaDoIbsCbs, type ParteDoResumo, type ResumoDoCte } from "@/lib/cte";
import { FORMATO_DO_ENDERECO, enderecoDoPagador } from "@/lib/cobranca-gateway";
import { enderecoDoTexto } from "@/lib/endereco";
import { chaveValida, limparChave, participantesDaNota, partesDaChave, type EnderecoDaNota, type ParticipanteDaNota } from "@/lib/nfe";
import { normalizeText } from "@/lib/normalization";
import type { Municipio } from "@/lib/municipios";
import {
  BLOQUEIO_DO_DIFAL,
  cfopDaPrestacao,
  ibsCbsDaPrestacao,
  observacaoDaViagem,
  resolverIcms,
  type DadosDoCte,
  type EmitenteDoCte,
  type EnderecoDoCte,
  type LocalDoCte,
  type ParticipanteDoCte,
  type TomadorDoCte,
} from "@/lib/cte/montar";
import { dataHoraDoXml } from "@/lib/cte/chave";
import { semResponsavelTecnico, type ResponsavelTecnico } from "@/lib/cte/responsavel-tecnico";
import { centavos, digitos } from "@/lib/cte/texto";

/**
 * Da carga ao CT-e: decide quem é remetente, destinatário e tomador, acha os
 * códigos IBGE e diz o que falta. Função pura (a tabela de municípios chega por
 * parâmetro); quem lê a carga do banco é src/lib/cte-db.ts.
 *
 * De onde vem cada coisa:
 * - remetente e destinatário: do emitente e do destinatário da NF-e ligada à
 *   carga (o XML guardado tem CNPJ, inscrição estadual e endereço com código
 *   IBGE). Sem NF-e, só quando o nome é o do próprio cliente pagador (cadastro)
 *   ou, para o destinatário, o de um destinatário frequente dele com CNPJ/CPF;
 * - tomador: o cliente pagador da carga. Se o CNPJ dele é o do remetente, o
 *   tomador é o remetente; se é o do destinatário, o destinatário; senão é
 *   "outro", com os dados do cadastro do cliente;
 * - início e fim da prestação: a origem e o destino da carga ("Cidade - UF");
 * - valor da prestação: o frete da carga; valor da carga: o valor da NF.
 *
 * Nada é inventado: o que não se sabe vira pendência (impede a emissão) ou
 * aviso (não impede), com uma frase que diz onde resolver.
 */

export type AcharMunicipio = (texto: string | null | undefined, uf?: string | null) => Municipio | null;

export type ClienteDaCarga = {
  companyName: string;
  tradeName: string | null;
  cnpj: string;
  ie: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export type CargaDoCte = {
  trackingCode: string | null;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  invoiceKey: string | null;
  invoiceValue: number | null;
  freightValue: number | null;
  /** `{ composicao: [{ rotulo, valor }] }`, quando o frete saiu da tabela. */
  freightDetails: unknown;
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryDistrict: string | null;
  deliveryZip: string | null;
  client: ClienteDaCarga;
  /** As NF-e importadas e ligadas à carga. */
  notas: readonly { accessKey: string; xml: string }[];
  /** Os destinatários frequentes do cliente pagador. */
  destinatarios: readonly { name: string; document: string | null; address: string | null }[];
  viagem: { placa: string | null; motorista: string | null } | null;
};

export type DadosPreparados = Omit<DadosDoCte, "numero" | "codigo" | "emissao">;

export type Preparo = {
  /** Os dados prontos para a montagem. `null` enquanto houver pendência. */
  dados: DadosPreparados | null;
  pendencias: string[];
  avisos: string[];
  /** O que já se sabe, para a tela mostrar mesmo com pendência. Sem o número: quem sabe é o banco. */
  resumo: Omit<ResumoDoCte, "numeroPrevisto"> | null;
};

export const SEM_EMITENTE = "Os dados fiscais do emitente não foram preenchidos.";

const mesmoNome = (a: string, cliente: Pick<ClienteDaCarga, "companyName" | "tradeName">) => {
  const nome = normalizeText(a);
  return nome !== "" && (nome === normalizeText(cliente.companyName) || (cliente.tradeName !== null && nome === normalizeText(cliente.tradeName)));
};

/** Só dígitos ou "ISENTO"; o que não for uma coisa nem outra é como não ter. */
function inscricao(ie: string | null | undefined): string | null {
  const valor = (ie ?? "").trim().toUpperCase();
  if (valor === "ISENTO" || valor === "ISENTA") return "ISENTO";
  const numeros = digitos(valor);
  return numeros.length >= 2 && numeros.length <= 14 ? numeros : null;
}

/** CNPJ (14 posições; as 12 primeiras podem ter letras desde 2026) ou CPF (11 dígitos), sem pontuação. */
const documentoValido = (documento: string | null | undefined): string | null => {
  const limpo = (documento ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return /^[A-Z0-9]{12}[0-9]{2}$/.test(limpo) || /^[0-9]{11}$/.test(limpo) ? limpo : null;
};

/** O endereço completo o bastante para o esquema (logradouro, bairro e município com código), ou o que falta. */
function enderecoCompleto(
  partes: { logradouro: string | null; numero: string | null; complemento?: string | null; bairro: string | null; cep: string | null },
  municipio: Municipio | null,
): EnderecoDoCte | null {
  if (!municipio || !partes.logradouro || partes.logradouro.trim().length < 2 || !partes.bairro || partes.bairro.trim().length < 2) return null;
  return {
    logradouro: partes.logradouro,
    numero: partes.numero?.trim() || "S/N",
    complemento: partes.complemento ?? null,
    bairro: partes.bairro,
    codigoMunicipio: municipio.codigo,
    municipio: municipio.nome,
    uf: municipio.uf,
    cep: partes.cep,
  };
}

/** O município do endereço da nota: pelo nome e pela UF, conferindo o código que a nota traz. */
function municipioDaNota(endereco: EnderecoDaNota, achar: AcharMunicipio): Municipio | null {
  const pelaTabela = endereco.municipio && endereco.uf ? achar(`${endereco.municipio} - ${endereco.uf}`) : null;
  if (pelaTabela) return pelaTabela;
  // A cidade veio escrita de um jeito que a tabela não reconhece: vale o código da própria nota.
  return endereco.codigoMunicipio && endereco.municipio && endereco.uf ? { codigo: endereco.codigoMunicipio, nome: endereco.municipio, uf: endereco.uf } : null;
}

function daNota(parte: ParticipanteDaNota, achar: AcharMunicipio): ParticipanteDoCte | null {
  const documento = documentoValido(parte.documento);
  const endereco = enderecoCompleto(parte.endereco, municipioDaNota(parte.endereco, achar));
  if (!documento || !parte.nome || !endereco) return null;
  return { documento, ie: parte.ie, nome: parte.nome, fantasia: parte.fantasia, telefone: parte.telefone, endereco };
}

/** O cliente pagador como participante, com o endereço do cadastro lido no formato da busca por CNPJ. */
function doCadastro(cliente: ClienteDaCarga, achar: AcharMunicipio): ParticipanteDoCte | null {
  const documento = documentoValido(cliente.cnpj);
  const lido = enderecoDoPagador(cliente.address).endereco;
  if (!documento || !lido) return null;
  const endereco = enderecoCompleto(
    { logradouro: lido.street_name, numero: lido.street_number, bairro: lido.neighborhood, cep: lido.zip_code },
    achar(`${lido.city} - ${lido.federal_unit}`),
  );
  if (!endereco) return null;
  return { documento, ie: inscricao(cliente.ie), nome: cliente.companyName, fantasia: cliente.tradeName, telefone: cliente.phone, email: cliente.email, endereco };
}

const local = (municipio: Municipio): LocalDoCte => ({ codigoMunicipio: municipio.codigo, municipio: municipio.nome, uf: municipio.uf });

function documentoFormatado(documento: string): string {
  if (documento.length === 14) return documento.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5");
  return documento.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

const enderecoEmLinha = (endereco: EnderecoDoCte) => `${endereco.logradouro}, ${endereco.numero} - ${endereco.bairro}, ${endereco.municipio} - ${endereco.uf}`;

const parteDoResumo = (parte: ParticipanteDoCte): ParteDoResumo => ({
  nome: parte.nome,
  documento: documentoFormatado(parte.documento),
  ie: parte.ie ?? null,
  endereco: enderecoEmLinha(parte.endereco),
});

/** As chaves de NF-e da carga: as das notas importadas e a digitada na carga, se for mesmo de NF-e. */
function chavesDaCarga(carga: Pick<CargaDoCte, "notas" | "invoiceKey">): string[] {
  const digitada = limparChave(carga.invoiceKey ?? "");
  const chaves = carga.notas.map((nota) => nota.accessKey);
  if (chaveValida(digitada) && partesDaChave(digitada).modelo === "55") chaves.push(digitada);
  return [...new Set(chaves)];
}

function componentesDoFrete(detalhes: unknown): { nome: string; valor: number }[] {
  const composicao = (detalhes as { composicao?: unknown } | null)?.composicao;
  if (!Array.isArray(composicao)) return [];
  return composicao.flatMap((item) => {
    const { rotulo, valor } = (item ?? {}) as { rotulo?: unknown; valor?: unknown };
    return typeof rotulo === "string" && typeof valor === "number" && valor > 0 ? [{ nome: rotulo, valor }] : [];
  });
}

export const AVISO_DO_ICMS_DE_OUTRA_UF = (uf: string) =>
  `A prestação começa em ${uf}, fora da UF do emitente: o ICMS vai no grupo ICMSOutraUF, devido a ${uf}, com a alíquota interestadual. O recolhimento do imposto a ${uf} é por conta da empresa: confirme com o contador como fazer.`;
export const AVISO_DO_ICMS_RETIDO =
  "ICMS por substituição tributária (situação 60): o CT-e informa a base e o valor retidos, e o sistema não desconta esse ICMS da base do IBS/CBS. Confirme com o contador.";

/**
 * Monta os dados do CT-e da carga, ou diz o que falta. `responsavelTecnico`:
 * os dados da desenvolvedora do sistema (src/lib/cte/responsavel-tecnico.ts);
 * `null` = o CT-e vai sem o grupo, com aviso.
 */
export function prepararCte(
  carga: CargaDoCte,
  emitente: EmitenteDoCte | null,
  enderecoDoQrCode: string | null,
  achar: AcharMunicipio,
  agora: Date = new Date(),
  responsavelTecnico: ResponsavelTecnico | null = null,
): Preparo {
  if (!emitente || !enderecoDoQrCode) return { dados: null, pendencias: [SEM_EMITENTE], avisos: [], resumo: null };

  const pendencias: string[] = [];
  const avisos: string[] = [];
  const cliente = carga.client;

  // A primeira nota legível dá o remetente e o destinatário.
  const daPrimeiraNota = carga.notas.map((nota) => participantesDaNota(nota.xml)).find((lido) => lido !== null) ?? null;
  const chavesDeNfe = chavesDaCarga(carga);

  /* Remetente */
  let remetente: ParticipanteDoCte | null = null;
  if (daPrimeiraNota) {
    remetente = daNota(daPrimeiraNota.emitente, achar);
    if (!remetente) pendencias.push("A NF-e ligada à carga não traz o CNPJ/CPF e o endereço completo do emitente (o remetente do CT-e).");
  } else if (mesmoNome(carga.sender, cliente)) {
    remetente = doCadastro(cliente, achar);
    if (!remetente) pendencias.push(`O remetente é o cliente pagador, mas o endereço do cadastro dele não está completo. Escreva-o como "${FORMATO_DO_ENDERECO}".`);
  } else {
    pendencias.push("Sem NF-e ligada à carga, o sistema não tem o CNPJ/CPF nem o endereço do remetente. Importe a NF-e e ligue-a à carga.");
  }

  /* Destinatário */
  let destinatario: ParticipanteDoCte | null = null;
  const destino = achar(carga.destination);
  if (daPrimeiraNota) {
    destinatario = daNota(daPrimeiraNota.destinatario, achar);
    if (!destinatario) pendencias.push("A NF-e ligada à carga não traz o CNPJ/CPF e o endereço completo do destinatário.");
  } else if (mesmoNome(carga.receiver, cliente)) {
    destinatario = doCadastro(cliente, achar);
    if (!destinatario) pendencias.push(`O destinatário é o cliente pagador, mas o endereço do cadastro dele não está completo. Escreva-o como "${FORMATO_DO_ENDERECO}".`);
  } else {
    const frequente = carga.destinatarios.find((d) => normalizeText(d.name) === normalizeText(carga.receiver) && documentoValido(d.document) !== null);
    const doCadastroDele = enderecoDoTexto(frequente?.address);
    const endereco = enderecoCompleto(
      {
        logradouro: carga.deliveryStreet ?? doCadastroDele.deliveryStreet,
        numero: carga.deliveryNumber ?? doCadastroDele.deliveryNumber,
        bairro: carga.deliveryDistrict ?? doCadastroDele.deliveryDistrict,
        cep: carga.deliveryZip ?? doCadastroDele.deliveryZip,
      },
      destino,
    );
    const documento = documentoValido(frequente?.document);
    if (frequente && documento && endereco) destinatario = { documento, ie: null, nome: frequente.name, endereco };
    else if (!frequente) {
      pendencias.push("Sem NF-e ligada à carga, o sistema não tem o CNPJ/CPF do destinatário. Importe a NF-e, ou cadastre o destinatário (com CNPJ/CPF) nos destinatários frequentes do cliente.");
    } else pendencias.push("Falta o endereço da entrega (logradouro e bairro) na carga para o destinatário do CT-e.");
  }

  /* Início e fim da prestação */
  const origem = achar(carga.origin);
  if (!origem) pendencias.push(`A origem "${carga.origin}" não foi encontrada na tabela de municípios do IBGE. Escreva como "Cidade - UF".`);
  if (!destino) pendencias.push(`O destino "${carga.destination}" não foi encontrado na tabela de municípios do IBGE. Escreva como "Cidade - UF".`);

  /* Tomador: o cliente pagador */
  const documentoDoCliente = documentoValido(cliente.cnpj);
  let tomador: TomadorDoCte | null = null;
  let ieDoTomador: string | null = inscricao(cliente.ie);
  if (!documentoDoCliente) {
    pendencias.push("O cliente pagador não tem CNPJ/CPF válido no cadastro.");
  } else if (remetente && remetente.documento === documentoDoCliente) {
    tomador = { papel: "REMETENTE" };
    ieDoTomador = inscricao(remetente.ie) ?? ieDoTomador;
    remetente = { ...remetente, ie: ieDoTomador };
  } else if (destinatario && destinatario.documento === documentoDoCliente) {
    tomador = { papel: "DESTINATARIO" };
    ieDoTomador = inscricao(destinatario.ie) ?? ieDoTomador;
    destinatario = { ...destinatario, ie: ieDoTomador };
  } else if (remetente && destinatario) {
    const outro = doCadastro(cliente, achar);
    if (outro) tomador = { papel: "OUTRO", participante: outro };
    else {
      pendencias.push(
        `O cliente pagador não é o remetente nem o destinatário: o CT-e precisa do endereço dele. Escreva o endereço do cadastro como "${FORMATO_DO_ENDERECO}".`,
      );
    }
  }
  const contribuinte = ieDoTomador === null ? "9" : ieDoTomador === "ISENTO" ? "2" : "1";
  if (tomador && contribuinte === "9") {
    avisos.push("O cadastro do tomador não tem inscrição estadual: ele vai como não contribuinte do ICMS. Se ele é contribuinte, preencha a IE no cadastro do cliente.");
  }

  /* Valores */
  const frete = carga.freightValue !== null && carga.freightValue > 0 ? centavos(carga.freightValue) : null;
  if (frete === null) pendencias.push("A carga está sem valor de frete: é o valor da prestação do CT-e.");
  const valorDaCarga = carga.invoiceValue !== null && carga.invoiceValue > 0 ? centavos(carga.invoiceValue) : null;
  if (valorDaCarga === null) pendencias.push("A carga está sem o valor da mercadoria (valor da NF), que o CT-e rodoviário exige.");

  /* Documentos */
  if (chavesDeNfe.length === 0) {
    if (origem && destino && origem.uf !== destino.uf) {
      pendencias.push("Carga interestadual sem NF-e: a SEFAZ só aceita CT-e interestadual com a chave da nota (rejeição 813). Informe a chave da NF-e na carga ou importe a nota.");
    } else avisos.push("A carga não tem NF-e: o CT-e vai com uma declaração no lugar da nota.");
  }

  if (emitente.ambiente === "HOMOLOGACAO") {
    avisos.push(`Em homologação, a SEFAZ exige que o nome do remetente e do destinatário seja "${NOME_EM_HOMOLOGACAO}": é assim que vai no XML.`);
  }

  const ufDoEmitente = emitente.endereco.uf;
  const cfop = origem && destino ? cfopDaPrestacao({ ...emitente, uf: ufDoEmitente }, origem.uf, destino.uf) : "";

  /* ICMS: o grupo depende de onde a prestação começa e termina; o que o sistema não sabe calcular bloqueia. */
  const resolvido = frete !== null && origem && destino ? resolverIcms({ ...emitente, uf: ufDoEmitente }, frete, origem.uf, destino.uf) : null;
  if (resolvido && "bloqueio" in resolvido) pendencias.push(resolvido.bloqueio);
  const icms = resolvido && "icms" in resolvido ? resolvido.icms : null;
  if (icms?.grupo === "ICMSOutraUF" && origem) avisos.push(AVISO_DO_ICMS_DE_OUTRA_UF(origem.uf));
  if (icms?.retido) avisos.push(AVISO_DO_ICMS_RETIDO);
  // O diferencial de alíquota da prestação interestadual a não contribuinte (EC 87/2015) não é calculado: bloqueia.
  if (tomador && contribuinte === "9" && origem && destino && origem.uf !== destino.uf) pendencias.push(BLOQUEIO_DO_DIFAL);

  /* IBS e CBS */
  const parametros = emitente.ibsCbs;
  // Uma configuração antiga pode ter um par que não vale (o CST 400, por exemplo): a emissão para até a correção.
  const problemaDoPar = parametros ? problemaDoIbsCbs(parametros.cst, parametros.classe) : null;
  if (problemaDoPar) pendencias.push(`${problemaDoPar} Corrija em ${ONDE_CONFIGURAR}.`);
  const ibsCbs = frete !== null && icms && !problemaDoPar ? ibsCbsDaPrestacao(emitente, frete, icms) : null;
  if (!parametros && emitente.regime === "3") {
    avisos.push("A empresa é do regime normal e não tem CST e classificação tributária do IBS/CBS: a SEFAZ rejeita o CT-e sem esse grupo (rejeição 310, já em vigor em homologação). Preencha em Empresa → Fiscal.");
  }
  if (!responsavelTecnico) avisos.push(semResponsavelTecnico("cte"));
  // Em 2026 a SEFAZ só aceita as alíquotas de teste (rejeições 316, 321 e 326); em homologação aceita também as de 2027.
  const de2026 = parametros && dataHoraDoXml(agora, ufDoEmitente).startsWith("2026") && ibsCbs?.valores;
  if (de2026 && (parametros.ibsUf !== ALIQUOTAS_DE_2026.ibsUf || parametros.ibsMunicipio !== ALIQUOTAS_DE_2026.ibsMunicipio || parametros.cbs !== ALIQUOTAS_DE_2026.cbs)) {
    avisos.push("As alíquotas de IBS e CBS da empresa não são as de 2026 (IBS da UF 0,1%, IBS do município 0% e CBS 0,9%): em produção a SEFAZ rejeita o CT-e emitido em 2026 com outras alíquotas.");
  }

  const resumo: Omit<ResumoDoCte, "numeroPrevisto"> = {
    ambiente: emitente.ambiente,
    serie: emitente.serie,
    cfop,
    emitente: {
      nome: emitente.razaoSocial,
      documento: documentoFormatado(emitente.cnpj),
      ie: emitente.ie,
      endereco: enderecoEmLinha(emitente.endereco),
    },
    remetente: remetente && parteDoResumo(remetente),
    destinatario: destinatario && parteDoResumo(destinatario),
    tomador:
      tomador && documentoDoCliente
        ? { papel: tomador.papel, nome: cliente.companyName, documento: documentoFormatado(documentoDoCliente), contribuinte }
        : null,
    origem: origem ? `${origem.nome} - ${origem.uf}` : carga.origin,
    destino: destino ? `${destino.nome} - ${destino.uf}` : carga.destination,
    valorDaPrestacao: frete,
    valorDaCarga,
    icms: icms && { situacao: icms.situacao, grupo: icms.grupo, base: icms.base, aliquota: icms.aliquota, valor: icms.valor, retido: icms.retido },
    ibsCbs: ibsCbs && {
      cst: ibsCbs.cst,
      classe: ibsCbs.classe,
      base: ibsCbs.valores?.base ?? null,
      ibs: ibsCbs.valores ? centavos(ibsCbs.valores.ibsUf + ibsCbs.valores.ibsMunicipio) : 0,
      cbs: ibsCbs.valores?.cbs ?? 0,
    },
    peso: carga.weight,
    volumes: carga.volumes,
    chavesDeNfe,
  };

  if (pendencias.length > 0 || !remetente || !destinatario || !tomador || !origem || !destino || frete === null || valorDaCarga === null) {
    return { dados: null, pendencias, avisos, resumo };
  }

  return {
    dados: {
      emitente,
      remetente,
      destinatario,
      tomador,
      contribuinte,
      inicio: local(origem),
      fim: local(destino),
      valorDaPrestacao: frete,
      componentes: componentesDoFrete(carga.freightDetails),
      valorDaCarga,
      produto: daPrimeiraNota?.produto ?? "DIVERSOS",
      pesoKg: carga.weight,
      volumes: carga.volumes,
      chavesDeNfe,
      documento: carga.trackingCode,
      observacao: observacaoDaViagem(carga.viagem),
      enderecoDoQrCode,
      responsavelTecnico,
    },
    pendencias: [],
    avisos,
    resumo,
  };
}

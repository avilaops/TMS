import { cnpjValido } from "@/lib/cte";
import { semResponsavelTecnico, type ResponsavelTecnico } from "@/lib/cte/responsavel-tecnico";
import { digitos } from "@/lib/cte/texto";
import {
  CIOT_OBRIGATORIO_DESDE,
  ONDE_CONFIGURAR_O_MDFE,
  ciotObrigatorio,
  cpfValido,
  documentoValido,
  type Ambiente,
  type EntradasDoMdfe,
  type ResumoDoMdfe,
} from "@/lib/mdfe";
import { FORMATO_DA_CHAVE, modeloDaChave } from "@/lib/mdfe/chave";
import type { DadosDoMdfe, DescargaDoMdfe, EmitenteDoMdfe, MunicipioDoMdfe, ProprietarioDoVeiculo, ReboqueDoMdfe, SeguroDoMdfe, TracaoDoMdfe } from "@/lib/mdfe/montar";
import { tipoDeTransportador } from "@/lib/mdfe/montar";
import { PERCURSO_OBRIGATORIO, errosDoPercurso, inferirPercurso } from "@/lib/mdfe/percurso";
import type { Municipio } from "@/lib/municipios";
import { campo, chaveValida, filho, lerXml, limparChave, type No } from "@/lib/nfe";

/**
 * Da viagem ao MDF-e: separa as cargas por UF de descarregamento (um MDF-e
 * para cada), agrupa os documentos por município de descarga, acha a UF e os
 * municípios de carregamento, decide o percurso e diz o que falta. Função pura
 * (a tabela de municípios chega por parâmetro); quem lê a viagem do banco é
 * src/lib/mdfe-db.ts.
 *
 * De onde vem cada coisa:
 * - emitente tipo 1 (transportadora): os documentos são os CT-e das cargas.
 *   Município de início e de fim, valor da carga, peso, produto predominante e
 *   CEPs saem do XML do próprio CT-e (o MDF-e tem de fechar com ele). CT-e
 *   registrado à mão (de outro sistema) não tem XML: valem a origem, o destino,
 *   o valor e o peso da carga;
 * - emitente tipo 2 (carga própria): os documentos são as NF-e das cargas;
 *   origem, destino, valor e peso são os da carga;
 * - veículo, proprietário e condutor: o cadastro (Frota e Motoristas);
 * - percurso, CIOT, vale-pedágio, seguro, produto, pagamento, reboques e
 *   lacres: o que a pessoa informou na tela (`EntradasDoMdfe`), com o seguro
 *   padrão da empresa quando ela não informou.
 */

export type AcharMunicipio = (texto: string | null | undefined, uf?: string | null) => Municipio | null;

export type VeiculoDaViagem = {
  id: string;
  placa: string;
  renavam: string | null;
  taraKg: number | null;
  capacidadeKg: number | null;
  rodado: string | null;
  carroceria: string | null;
  uf: string | null;
  proprietario: { documento: string | null; nome: string | null; rntrc: string | null; ie: string | null; uf: string | null; tipo: string | null } | null;
};

export type CargaDaViagem = {
  id: string;
  trackingCode: string | null;
  origin: string;
  destination: string;
  weight: number;
  invoiceValue: number | null;
  invoiceKey: string | null;
  deliveryZip: string | null;
  cliente: { nome: string; documento: string | null };
  /** O CT-e da carga que vale neste ambiente: o autorizado por este sistema (com o XML) ou, em produção, o registrado à mão (sem XML). */
  cte: { chave: string; xml: string | null } | null;
  /** As NF-e importadas e ligadas à carga. */
  notas: readonly { chave: string; valor: number | null; peso: number | null }[];
};

export type ViagemDoMdfe = {
  id: string;
  codigo: string;
  /** Quando a viagem saiu (ou está prevista para sair). */
  saida: Date | null;
  motorista: { nome: string; cpf: string };
  veiculo: VeiculoDaViagem;
  cargas: readonly CargaDaViagem[];
};

/** O seguro que a empresa usa por padrão (a averbação é de cada viagem). */
export type SeguroPadrao = { seguradora: string; cnpjDaSeguradora: string; apolice: string } | null;

export type DadosPreparados = Omit<DadosDoMdfe, "numero" | "codigo" | "emissao">;

export type PreparoDoMdfe = {
  ufDeDescarga: string;
  /** Os dados prontos para a montagem. `null` enquanto houver pendência. */
  dados: DadosPreparados | null;
  pendencias: string[];
  avisos: string[];
  /** O que já se sabe, para a tela mostrar mesmo com pendência. Sem ambiente, série e número: quem sabe é o banco. */
  resumo: Omit<ResumoDoMdfe, "ambiente" | "serie" | "numeroPrevisto">;
  /** As entradas como ficaram, com o que o cadastro sugere onde a pessoa não informou. */
  entradas: EntradasDoMdfe;
};

export const SEM_EMITENTE = "Os dados fiscais do emitente não foram preenchidos.";
export const VIAGEM_SEM_CARGA = "A viagem não tem carga.";

/** Placa nacional, antiga ou Mercosul: é o que a SEFAZ aceita no MDF-e (Anexo I, regra F89, rejeição 646). */
const PLACA_NACIONAL = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;

const nomeDaCarga = (carga: Pick<CargaDaViagem, "trackingCode">) => carga.trackingCode ?? "sem código";

/* --------------------------- O documento de cada carga -------------------------- */

type Local = Municipio & { cep: string | null };

type DocumentoDaCarga = {
  carga: CargaDaViagem;
  chaves: string[];
  carrega: Local | null;
  descarga: Local | null;
  valor: number;
  pesoKg: number;
  produto: string | null;
};

const cepLimpo = (texto: string | null | undefined) => {
  const numeros = digitos(texto);
  return numeros.length === 8 ? numeros : null;
};

/** O município que o XML do CT-e diz (código, nome e UF), conferido: o código tem de ser da UF. */
function municipioDoCte(ide: No | undefined, sufixo: "Ini" | "Fim"): Municipio | null {
  const codigo = campo(ide, `cMun${sufixo}`);
  const nome = campo(ide, `xMun${sufixo}`);
  const uf = campo(ide, `UF${sufixo}`);
  return codigo && /^\d{7}$/.test(codigo) && nome && uf ? { codigo, nome, uf } : null;
}

/** O que o XML de um CT-e autorizado diz do transporte. `null` quando o XML não se lê. */
function lerCte(xml: string): Pick<DocumentoDaCarga, "carrega" | "descarga" | "valor" | "pesoKg" | "produto"> | null {
  let raiz: No;
  try {
    raiz = lerXml(xml);
  } catch {
    return null;
  }
  const cte = raiz.nome === "cteProc" ? filho(raiz, "CTe") : raiz;
  const inf = filho(cte, "infCte");
  const ide = filho(inf, "ide");
  const carga = filho(filho(inf, "infCTeNorm"), "infCarga");
  if (!ide) return null;
  const inicio = municipioDoCte(ide, "Ini");
  const fim = municipioDoCte(ide, "Fim");
  // O peso é a medida em kg (cUnid 01); as outras medidas (volumes, m³) não entram no total do MDF-e.
  const peso = (carga?.filhos ?? []).filter((no) => no.nome === "infQ" && campo(no, "cUnid") === "01").reduce((soma, no) => soma + (Number(campo(no, "qCarga")) || 0), 0);
  return {
    carrega: inicio && { ...inicio, cep: cepLimpo(campo(filho(filho(inf, "rem"), "enderReme"), "CEP")) },
    descarga: fim && { ...fim, cep: cepLimpo(campo(filho(filho(inf, "dest"), "enderDest"), "CEP")) },
    valor: Number(campo(carga, "vCarga")) || 0,
    pesoKg: peso,
    produto: campo(carga, "proPred"),
  };
}

function documentoDaCarga(carga: CargaDaViagem, tipo: EmitenteDoMdfe["tipo"], achar: AcharMunicipio): DocumentoDaCarga {
  const origem = achar(carga.origin);
  const destino = achar(carga.destination);
  const daCarga = {
    carrega: origem && { ...origem, cep: null },
    descarga: destino && { ...destino, cep: cepLimpo(carga.deliveryZip) },
    valor: carga.invoiceValue ?? 0,
    pesoKg: carga.weight,
    produto: null,
  };

  if (tipo === "1") {
    if (!carga.cte) return { carga, chaves: [], ...daCarga };
    const lido = carga.cte.xml ? lerCte(carga.cte.xml) : null;
    // O que o CT-e não disser vem da carga.
    return {
      carga,
      chaves: [carga.cte.chave],
      carrega: lido?.carrega ?? daCarga.carrega,
      descarga: lido?.descarga ? { ...lido.descarga, cep: lido.descarga.cep ?? daCarga.descarga?.cep ?? null } : daCarga.descarga,
      valor: lido ? lido.valor : daCarga.valor,
      pesoKg: lido && lido.pesoKg > 0 ? lido.pesoKg : daCarga.pesoKg,
      produto: lido?.produto ?? null,
    };
  }

  const digitada = limparChave(carga.invoiceKey ?? "");
  const chaves = carga.notas.map((nota) => nota.chave);
  if (chaveValida(digitada) && modeloDaChave(digitada) === "55") chaves.push(digitada);
  const dasNotas = carga.notas.reduce((soma, nota) => soma + (nota.valor ?? 0), 0);
  return { carga, chaves: [...new Set(chaves)], ...daCarga, valor: dasNotas > 0 ? dasNotas : daCarga.valor };
}

/* ----------------------------------- Veículo ---------------------------------- */

/** O proprietário do veículo de terceiro, ou o que falta dele. `null` sem pendência: o veículo é da empresa. */
function proprietarioDoVeiculo(veiculo: VeiculoDaViagem, cnpjDoEmitente: string | null, pendencias: string[]): ProprietarioDoVeiculo | null {
  const dono = veiculo.proprietario;
  const documento = (dono?.documento ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!dono || documento === "") return null;
  const onde = `do veículo ${veiculo.placa} (Frota)`;
  if (!documentoValido(documento)) {
    pendencias.push(`O CPF ou CNPJ do proprietário ${onde} não é válido.`);
    return null;
  }
  // Regra F64 (rejeição 740): proprietário igual ao emitente não se informa.
  if (documento === cnpjDoEmitente) return null;
  const rntrc = digitos(dono.rntrc);
  const nome = (dono.nome ?? "").trim();
  const faltas = [
    ...(nome.length >= 2 ? [] : ["o nome"]),
    ...(rntrc.length === 8 ? [] : ["o RNTRC (8 dígitos)"]),
    ...(dono.uf ? [] : ["a UF"]),
    ...(dono.tipo === "0" || dono.tipo === "1" || dono.tipo === "2" ? [] : ["o tipo (TAC agregado, TAC independente ou outros)"]),
  ];
  if (faltas.length > 0 || !dono.uf) {
    pendencias.push(`Falta no proprietário ${onde}: ${faltas.join(", ")}.`);
    return null;
  }
  return { documento, rntrc, nome, ie: dono.ie, uf: dono.uf, tipo: dono.tipo as ProprietarioDoVeiculo["tipo"] };
}

/** O que o esquema exige do veículo e o cadastro não tem. */
function faltasDoVeiculo(veiculo: VeiculoDaViagem, reboque: boolean): string[] {
  return [
    ...(PLACA_NACIONAL.test(veiculo.placa) ? [] : ["placa no padrão nacional"]),
    ...(veiculo.taraKg !== null && veiculo.taraKg >= 0 ? [] : ["tara (kg)"]),
    ...(reboque && !(veiculo.capacidadeKg !== null && veiculo.capacidadeKg >= 0) ? ["capacidade (kg)"] : []),
    ...(reboque || veiculo.rodado ? [] : ["tipo de rodado"]),
    ...(veiculo.carroceria ? [] : ["tipo de carroceria"]),
  ];
}

/* ---------------------------------- A viagem ---------------------------------- */

const semRepetir = <T>(itens: readonly T[], chave: (item: T) => string): T[] => {
  const vistos = new Set<string>();
  return itens.filter((item) => (vistos.has(chave(item)) ? false : (vistos.add(chave(item)), true)));
};

const maisComum = (textos: readonly (string | null)[]): string | null => {
  const contagem = new Map<string, number>();
  for (const texto of textos) if (texto) contagem.set(texto, (contagem.get(texto) ?? 0) + 1);
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

/** As UFs de descarregamento da viagem, na ordem das cargas: um MDF-e para cada (Ajuste SINIEF 21/10, cláusula terceira, § 2º). */
export function ufsDeDescarga(viagem: Pick<ViagemDoMdfe, "cargas">, tipo: EmitenteDoMdfe["tipo"], achar: AcharMunicipio): string[] {
  return [...new Set(viagem.cargas.flatMap((carga) => documentoDaCarga(carga, tipo, achar).descarga?.uf ?? []))];
}

export type Contexto = {
  emitente: EmitenteDoMdfe | null;
  seguroPadrao: SeguroPadrao;
  /** Os veículos escolhidos como reboque, já lidos do cadastro (os que não existem ficam de fora). */
  reboques: readonly VeiculoDaViagem[];
  enderecoDoQrCode: string;
  /** A desenvolvedora do sistema (src/lib/cte/responsavel-tecnico.ts). Nulo ou ausente: o MDF-e vai sem o grupo `infRespTec`, com aviso. */
  responsavelTecnico?: ResponsavelTecnico | null;
  achar: AcharMunicipio;
  agora?: Date;
};

/** Prepara o MDF-e de UMA UF de descarregamento da viagem, ou diz o que falta. */
export function prepararMdfe(viagem: ViagemDoMdfe, ufDeDescarga: string, entradasInformadas: EntradasDoMdfe, contexto: Contexto): PreparoDoMdfe {
  const { emitente, achar } = contexto;
  const agora = contexto.agora ?? new Date();
  const pendencias: string[] = [];
  const avisos: string[] = [];
  const tipo = emitente?.tipo ?? "1";
  const ambiente: Ambiente = emitente?.ambiente ?? "HOMOLOGACAO";

  /* ----- Documentos ----- */
  const todos = viagem.cargas.map((carga) => documentoDaCarga(carga, tipo, achar));
  for (const documento of todos) {
    if (!documento.descarga) pendencias.push(`A cidade de destino da carga ${nomeDaCarga(documento.carga)} ("${documento.carga.destination}") não está na tabela de municípios do IBGE. Corrija a carga.`);
  }
  const daUf = todos.filter((documento) => documento.descarga?.uf === ufDeDescarga);

  for (const documento of daUf) {
    const nome = nomeDaCarga(documento.carga);
    if (!documento.carrega) pendencias.push(`A cidade de origem da carga ${nome} ("${documento.carga.origin}") não está na tabela de municípios do IBGE. Corrija a carga.`);
    if (documento.chaves.length === 0) {
      pendencias.push(tipo === "1" ? `A carga ${nome} não tem CT-e autorizado neste ambiente: emita o CT-e antes do MDF-e.` : `A carga ${nome} não tem NF-e: importe a nota ou informe a chave na carga.`);
    }
    for (const chave of documento.chaves) {
      if (!FORMATO_DA_CHAVE.test(chave) || !chaveValida(chave)) pendencias.push(`A chave do documento da carga ${nome} não é válida.`);
    }
  }

  /* ----- Carregamento e descarregamento ----- */
  const ufsDeInicio = [...new Set(daUf.flatMap((documento) => documento.carrega?.uf ?? []))];
  const ufDeInicio = ufsDeInicio.length === 1 ? ufsDeInicio[0] : null;
  if (ufsDeInicio.length > 1) {
    pendencias.push(`As cargas com descarga em ${ufDeDescarga} carregam em mais de uma UF (${ufsDeInicio.join(", ")}): o MDF-e tem uma UF de carregamento só. Separe essas cargas em viagens diferentes.`);
  }
  const carregamento: MunicipioDoMdfe[] = semRepetir(
    daUf.flatMap((documento) => (documento.carrega ? [{ codigo: documento.carrega.codigo, nome: documento.carrega.nome }] : [])),
    (municipio) => municipio.codigo,
  );
  if (carregamento.length > 50) pendencias.push("O MDF-e aceita no máximo 50 municípios de carregamento.");

  // Uma chave só entra uma vez no documento, no primeiro município em que aparece (regras F28 e F29, rejeições 668 e 669).
  const jaRelacionadas = new Set<string>();
  const descargas: DescargaDoMdfe[] = [];
  for (const documento of daUf) {
    if (!documento.descarga) continue;
    const novas = documento.chaves.filter((chave) => (jaRelacionadas.has(chave) ? false : (jaRelacionadas.add(chave), true)));
    const existente = descargas.find((descarga) => descarga.municipio.codigo === documento.descarga?.codigo);
    if (existente) (existente.chaves as string[]).push(...novas);
    else descargas.push({ municipio: { codigo: documento.descarga.codigo, nome: documento.descarga.nome }, chaves: novas });
  }
  const documentos = jaRelacionadas.size;
  // "Carga lotação": um documento só. A SEFAZ passa a exigir NCM, CEPs e pagamento (NT 2025.001, regras F55a e F55b; Anexo I, F55).
  const lotacao = documentos === 1;

  /* ----- Percurso ----- */
  let percurso: string[] | null = [];
  let opcoesDePercurso: string[][] = [];
  if (ufDeInicio) {
    const inferido = inferirPercurso(ufDeInicio, ufDeDescarga);
    if (entradasInformadas.percurso) {
      percurso = [...entradasInformadas.percurso];
      pendencias.push(...errosDoPercurso(ufDeInicio, ufDeDescarga, percurso));
    } else if (inferido.tipo === "informar") {
      percurso = null;
      opcoesDePercurso = inferido.opcoes.map((opcao) => [...opcao]);
      pendencias.push(PERCURSO_OBRIGATORIO(ufDeInicio, ufDeDescarga));
    } else {
      percurso = [...inferido.percurso];
    }
    if (inferido.tipo === "informar") opcoesDePercurso = inferido.opcoes.map((opcao) => [...opcao]);
  }

  /* ----- Veículo, reboques e condutor ----- */
  const { veiculo } = viagem;
  const faltasDaTracao = faltasDoVeiculo(veiculo, false);
  if (faltasDaTracao.length > 0) pendencias.push(`Falta no cadastro do veículo ${veiculo.placa} (Frota): ${faltasDaTracao.join(", ")}.`);
  if (!veiculo.renavam) avisos.push(`O veículo ${veiculo.placa} está sem RENAVAM no cadastro: o MDF-e vai sem ele.`);
  const cnpjDoEmitente = emitente?.cnpj ?? null;
  const proprietario = proprietarioDoVeiculo(veiculo, cnpjDoEmitente, pendencias);
  const tpTransp = tipoDeTransportador(proprietario);

  const reboques: ReboqueDoMdfe[] = [];
  for (const reboque of contexto.reboques) {
    const faltas = faltasDoVeiculo(reboque, true);
    if (reboque.id === veiculo.id) pendencias.push("O veículo da viagem não pode ser também o reboque.");
    else if (faltas.length > 0) pendencias.push(`Falta no cadastro do reboque ${reboque.placa} (Frota): ${faltas.join(", ")}.`);
    else {
      reboques.push({
        placa: reboque.placa,
        renavam: reboque.renavam,
        taraKg: reboque.taraKg ?? 0,
        capacidadeKg: reboque.capacidadeKg ?? 0,
        carroceria: reboque.carroceria ?? "00",
        uf: reboque.uf,
        proprietario: proprietarioDoVeiculo(reboque, cnpjDoEmitente, pendencias),
      });
    }
  }
  if ((entradasInformadas.reboques?.length ?? 0) > contexto.reboques.length) pendencias.push("Um dos reboques escolhidos não existe mais na frota.");
  // NT 2024.001, regra F89c (rejeição 523): cavalo mecânico leva pelo menos um reboque.
  if (veiculo.rodado === "03" && contexto.reboques.length === 0) pendencias.push(`O veículo ${veiculo.placa} é um cavalo mecânico: escolha pelo menos um reboque.`);

  const cpf = digitos(viagem.motorista.cpf);
  if (!cpfValido(cpf)) pendencias.push(`O CPF do motorista ${viagem.motorista.nome} não é válido. Corrija em Motoristas.`);
  if (viagem.motorista.nome.trim().length < 2) pendencias.push("O motorista da viagem está sem nome.");

  /* ----- O que a norma exige de quem transporta para terceiros ----- */
  // As regras "de transportadora" valem para tpEmit 1 e para a carga própria em veículo de terceiro (tpEmit 2 com tpTransp).
  const comRegrasDeTransportador = tipo === "1" || tpTransp !== null;

  const ciots = entradasInformadas.ciots ?? [];
  if (comRegrasDeTransportador && ciots.length === 0) {
    const frase = `Informe o CIOT (ou, sem o código, o CPF ou CNPJ de quem o gerou): a SEFAZ exige o grupo do CIOT da transportadora (NT 2026.001, rejeição 684)`;
    if (ciotObrigatorio(ambiente, agora)) pendencias.push(`${frase}.`);
    else avisos.push(`${frase} a partir de ${CIOT_OBRIGATORIO_DESDE[ambiente].split("-").reverse().join("/")} em produção.`);
  }

  // Contratantes: com veículo de terceiro, um só, o próprio emitente (regra F65, rejeição 741); senão, os clientes das cargas.
  const contratantes = proprietario
    ? emitente
      ? [{ nome: emitente.razaoSocial, documento: emitente.cnpj }]
      : []
    : semRepetir(
        daUf.flatMap((documento) => {
          const numero = (documento.carga.cliente.documento ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
          return documentoValido(numero) ? [{ nome: documento.carga.cliente.nome, documento: numero }] : [];
        }),
        (contratante) => contratante.documento,
      );
  const valePedagio = entradasInformadas.valePedagio ?? null;
  // Regra F94 (rejeição 578): sem responsável pelo CIOT nem pelo vale-pedágio, o contratante é obrigatório.
  if (comRegrasDeTransportador && contratantes.length === 0 && ciots.length === 0 && !valePedagio?.pagador) {
    pendencias.push("Nenhum cliente das cargas tem CNPJ ou CPF válido no cadastro: o MDF-e precisa de pelo menos um contratante.");
  }

  /* ----- Seguro ----- */
  const padrao = contexto.seguroPadrao;
  const seguroInformado = entradasInformadas.seguro ?? (padrao ? { responsavel: "1" as const, documento: null, ...padrao, averbacoes: [] } : null);
  const seguros: SeguroDoMdfe[] = [];
  if (seguroInformado) {
    // Regra F92 (rejeição 699): seguradora, apólice e averbação, todas. Só para a transportadora (tpEmit 1).
    if (tipo === "1" && seguroInformado.averbacoes.length === 0) pendencias.push("Informe o número da averbação do seguro desta viagem.");
    seguros.push({ ...seguroInformado, documento: seguroInformado.documento ?? null });
  } else if (tipo === "1") {
    // Regra F91 (rejeição 698).
    pendencias.push(`O seguro da carga é obrigatório no MDF-e da transportadora: informe seguradora, apólice e averbação (o padrão da empresa fica em ${ONDE_CONFIGURAR_O_MDFE}).`);
  }

  /* ----- Produto predominante, lotação e pagamento ----- */
  const descricaoSugerida = maisComum(daUf.map((documento) => documento.produto)) ?? "DIVERSOS";
  const produtoInformado = entradasInformadas.produto ?? (comRegrasDeTransportador ? { tipoDeCarga: "05", descricao: descricaoSugerida, ncm: null } : null);
  const unico = lotacao ? daUf.find((documento) => documento.chaves.length > 0) : undefined;
  const lotacaoInformada =
    entradasInformadas.lotacao ?? (unico?.carrega?.cep && unico.descarga?.cep ? { cepDeCarregamento: unico.carrega.cep, cepDeDescarregamento: unico.descarga.cep } : null);
  const pagamento = entradasInformadas.pagamento ?? null;
  if (comRegrasDeTransportador && lotacao) {
    if (!produtoInformado?.ncm) pendencias.push("MDF-e com um documento só é carga lotação: informe o NCM do produto predominante (rejeição 301).");
    if (!lotacaoInformada) pendencias.push("Carga lotação: informe o CEP de carregamento e o de descarregamento (rejeição 726).");
    if (!pagamento) pendencias.push("Carga lotação: informe o pagamento do frete (quem paga, valor e conta ou Pix) (rejeição 302).");
  }

  if (valePedagio && !cnpjValido(valePedagio.cnpjDoFornecedor)) pendencias.push("O CNPJ da fornecedora do vale-pedágio não é válido.");

  /* ----- Totais ----- */
  const valorDaCarga = daUf.reduce((soma, documento) => soma + documento.valor, 0);
  const pesoKg = daUf.reduce((soma, documento) => soma + documento.pesoKg, 0);
  if (daUf.length > 0 && !(valorDaCarga > 0)) avisos.push("O valor total da carga está zerado: confira o valor das notas nas cargas.");
  if (daUf.length > 0 && !(pesoKg > 0)) avisos.push("O peso total da carga está zerado: confira o peso das cargas.");
  // MOC do MDF-e, Anexo I, regra F120 (rejeição 720): a UF pode exigir o grupo do responsável técnico.
  if (!contexto.responsavelTecnico) avisos.push(semResponsavelTecnico("mdfe"));

  if (viagem.cargas.length === 0) pendencias.push(VIAGEM_SEM_CARGA);
  else if (daUf.length === 0) pendencias.push(`A viagem não tem carga com descarga em ${ufDeDescarga}.`);
  if (!emitente) pendencias.unshift(SEM_EMITENTE);

  const entradas: EntradasDoMdfe = {
    ...entradasInformadas,
    // As UFs inferidas saem da tabela de divisas: são UFs válidas.
    percurso: entradasInformadas.percurso ?? (percurso as EntradasDoMdfe["percurso"]),
    seguro: seguroInformado,
    produto: produtoInformado,
    lotacao: lotacao ? lotacaoInformada : (entradasInformadas.lotacao ?? null),
  };

  const resumo: PreparoDoMdfe["resumo"] = {
    tipoDeEmitente: tipo,
    ufDeInicio,
    ufDeFim: ufDeDescarga,
    carregamento: carregamento.map((municipio) => municipio.nome),
    percurso,
    opcoesDePercurso,
    descargas: descargas.map((descarga) => ({ municipio: descarga.municipio.nome, documentos: descarga.chaves.length })),
    documentos,
    valorDaCarga,
    pesoKg,
    placa: veiculo.placa,
    reboques: contexto.reboques.map((reboque) => reboque.placa),
    condutor: viagem.motorista.nome,
    lotacao,
  };

  if (pendencias.length > 0 || !emitente || !ufDeInicio || percurso === null) return { ufDeDescarga, dados: null, pendencias: [...new Set(pendencias)], avisos, resumo, entradas };

  const tracao: TracaoDoMdfe = {
    placa: veiculo.placa,
    renavam: veiculo.renavam,
    taraKg: veiculo.taraKg ?? 0,
    capacidadeKg: veiculo.capacidadeKg,
    rodado: veiculo.rodado ?? "06",
    carroceria: veiculo.carroceria ?? "00",
    uf: veiculo.uf,
    proprietario,
    condutores: [{ nome: viagem.motorista.nome, cpf }],
  };

  const dados: DadosPreparados = {
    emitente,
    ufDeInicio,
    ufDeFim: ufDeDescarga,
    carregamento,
    percurso,
    inicioDaViagem: viagem.saida,
    descargas,
    rodo: {
      ciots: ciots.map((ciot) => ({ codigo: ciot.codigo ?? null, documento: ciot.documento })),
      valePedagio: valePedagio && {
        categoria: valePedagio.categoria,
        dispositivos: [{ cnpjDoFornecedor: valePedagio.cnpjDoFornecedor, pagador: valePedagio.pagador ?? null, compra: valePedagio.compra ?? null, valor: valePedagio.valor, tipo: valePedagio.tipo ?? null }],
      },
      // O grupo do contratante só é exigido de quem transporta para terceiros; na carga própria em veículo próprio ele não vai.
      contratantes: comRegrasDeTransportador ? contratantes : [],
      pagamentos: pagamento
        ? [{ nome: pagamento.nome ?? null, documento: pagamento.documento, valor: pagamento.valor, aPrazo: pagamento.aPrazo, adiantamento: pagamento.adiantamento ?? null, parcelas: pagamento.parcelas ?? [], conta: pagamento.conta }]
        : [],
      tracao,
      reboques,
    },
    seguros,
    produto: produtoInformado && {
      tipoDeCarga: produtoInformado.tipoDeCarga,
      descricao: produtoInformado.descricao,
      ncm: produtoInformado.ncm ?? null,
      // O grupo da lotação só vai quando o MDF-e é de um documento só.
      lotacao: lotacao ? lotacaoInformada : null,
    },
    valorDaCarga,
    pesoKg,
    lacres: entradasInformadas.lacres ?? [],
    observacao: `Viagem ${viagem.codigo}`,
    enderecoDoQrCode: contexto.enderecoDoQrCode,
    responsavelTecnico: contexto.responsavelTecnico ?? null,
  };

  return { ufDeDescarga, dados, pendencias: [], avisos, resumo, entradas };
}

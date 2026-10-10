import { createHash } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { gunzipSync } from "node:zlib";
import { digitoDaChave } from "../src/lib/nfe";
import type { DadosDoMdfe, EmitenteDoMdfe, RodoviarioDoMdfe, SeguroDoMdfe } from "../src/lib/mdfe/montar";
import { RESPONSAVEL_TECNICO, certificadoDoServidor, errosNoEsquema } from "./cte-apoio";

/**
 * Apoio dos testes do MDF-e: validação contra os esquemas oficiais
 * (fiscal/esquemas/mdfe-3.00), dados de exemplo e um servidor HTTPS local que
 * imita os web services do MDF-e. O certificado de teste é o do CT-e
 * (tests/cte-apoio.ts).
 *
 * Nada aqui fala com a SEFAZ de verdade nem usa certificado de verdade.
 */

export const PASTA_DOS_ESQUEMAS_DO_MDFE = "fiscal/esquemas/mdfe-3.00";

/** Os erros do XML contra um esquema do pacote do MDF-e (ex.: `mdfe_v3.00.xsd`). Vazio = válido. */
export const errosNoEsquemaDoMdfe = (xml: string, esquema: string) => errosNoEsquema(xml, esquema, PASTA_DOS_ESQUEMAS_DO_MDFE);

/** O conteúdo do `infModal` (o grupo `rodo`), que o esquema principal não confere. */
export const modalDoXml = (xml: string) => /<infModal[^>]*>([\s\S]*)<\/infModal>/.exec(xml)?.[1].replace("<rodo>", '<rodo xmlns="http://www.portalfiscal.inf.br/mdfe">') ?? "";

/** O conteúdo do `detEvento` de um evento, com o espaço de nomes, para validar no esquema do evento. */
export const detalheDoEvento = (xml: string) => /<detEvento[^>]*>([\s\S]*)<\/detEvento>/.exec(xml)?.[1].replace(/^<(\w+)>/, '<$1 xmlns="http://www.portalfiscal.inf.br/mdfe">') ?? "";

/* ------------------------------ Dados de exemplo ----------------------------- */

export const EMITENTE_DO_MDFE: EmitenteDoMdfe = {
  cnpj: "11222333000181",
  ie: "123456789012",
  razaoSocial: "Transportadora de Teste Ltda",
  fantasia: "Trans Teste",
  endereco: { logradouro: "Rua das Flores", numero: "120", complemento: "Galpão 2", bairro: "Centro", codigoMunicipio: "3530300", municipio: "Mirassol", uf: "SP", cep: "15130000" },
  telefone: "1732421000",
  rntrc: "12345678",
  serie: 1,
  ambiente: "HOMOLOGACAO",
  tipo: "1",
};

/** Uma chave de acesso de exemplo, com o dígito verificador certo. Modelo 57 = CT-e, 55 = NF-e. */
export function chaveDeExemplo(modelo: "55" | "57" | "58", numero: number, uf = "35", cnpj = "11222333000181"): string {
  const corpo = `${uf}2610${cnpj}${modelo}001${String(numero).padStart(9, "0")}1${String(numero).padStart(8, "0")}`;
  return `${corpo}${digitoDaChave(corpo)}`;
}

export const SEGURO: SeguroDoMdfe = { responsavel: "1", seguradora: "Seguradora de Teste S/A", cnpjDaSeguradora: "61198164000160", apolice: "AP-2026-0001", averbacoes: ["0612345678901234567890123456789012345678"] };

export const RODO: RodoviarioDoMdfe = {
  ciots: [],
  contratantes: [{ nome: "Indústria Remetente S/A", documento: "45543915000181" }],
  pagamentos: [],
  tracao: {
    placa: "ABC1D23",
    renavam: "12345678901",
    taraKg: 8500,
    capacidadeKg: 14000,
    rodado: "01",
    carroceria: "02",
    uf: "SP",
    condutores: [{ nome: "João da Silva", cpf: "52998224725" }],
  },
  reboques: [],
};

/** Um MDF-e completo de exemplo (transportadora, SP → MG, dois CT-e, com seguro e CIOT); cada teste troca o que quer. */
export function mdfeDeExemplo(trocas: Partial<DadosDoMdfe> = {}): DadosDoMdfe {
  return {
    emitente: EMITENTE_DO_MDFE,
    numero: 7,
    codigo: "48215937",
    emissao: new Date("2026-10-10T14:30:00.000Z"),
    ufDeInicio: "SP",
    ufDeFim: "MG",
    carregamento: [{ codigo: "3549805", nome: "São José do Rio Preto" }],
    percurso: [],
    inicioDaViagem: new Date("2026-10-10T16:00:00.000Z"),
    descargas: [
      { municipio: { codigo: "3106200", nome: "Belo Horizonte" }, chaves: [chaveDeExemplo("57", 15)] },
      { municipio: { codigo: "3170206", nome: "Uberlândia" }, chaves: [chaveDeExemplo("57", 16)] },
    ],
    rodo: { ...RODO, ciots: [{ codigo: "123456789012", documento: "11222333000181" }] },
    seguros: [SEGURO],
    produto: { tipoDeCarga: "05", descricao: "Peças automotivas" },
    valorDaCarga: 65001.8,
    pesoKg: 2501,
    lacres: [],
    observacao: "Viagem A1B2C3",
    enderecoDoQrCode: "https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode",
    ...trocas,
  };
}

const emitenteEm = (uf: "MT" | "AC"): EmitenteDoMdfe => ({
  ...EMITENTE_DO_MDFE,
  endereco:
    uf === "MT"
      ? { logradouro: "Av. do CPA", numero: "500", bairro: "Centro Político", codigoMunicipio: "5103403", municipio: "Cuiabá", uf: "MT", cep: "78049000" }
      : { logradouro: "Av. Ceará", numero: "900", bairro: "Centro", codigoMunicipio: "1200401", municipio: "Rio Branco", uf: "AC", cep: "69900000" },
});

/**
 * Os cenários de MDF-e das correções da revisão fiscal, que os testes validam
 * no esquema oficial e que são passados, à mão, pelo validador do serviço
 * fiscal da casa (`validar_xml_fiscal`).
 */
export const CENARIOS_DO_MDFE: Record<string, () => DadosDoMdfe> = {
  "sem-responsavel-tecnico": () => mdfeDeExemplo(),
  "com-responsavel-tecnico": () => mdfeDeExemplo({ responsavelTecnico: RESPONSAVEL_TECNICO }),
  "emitente-utc-4-mt": () => mdfeDeExemplo({ emitente: emitenteEm("MT"), responsavelTecnico: RESPONSAVEL_TECNICO }),
  "emitente-utc-5-ac": () => mdfeDeExemplo({ emitente: emitenteEm("AC") }),
};

/* ---------------------------- A SEFAZ de mentira ----------------------------- */

export type ModoDaSefazDoMdfe =
  | "autorizar"
  | "rejeitar"
  | "duplicidade"
  | "numero-usado"
  | "parado"
  /** A recepção rejeita por haver MDF-e não encerrado para a placa (611). */
  | "nao-encerrado"
  /** Recebe e nunca responde, sem processar. */
  | "mudo"
  /** Processa e nunca responde: a resposta "se perdeu". */
  | "mudo-processando"
  | "fault"
  | "sem-protocolo"
  | "outra-chave";

export type ChamadaDoMdfe = { servico: string; acao: string; dados: string; certificadoDoCliente: string | null };

type Autorizado = { protocolo: string; resumo: string; recebidoEm: string; ambiente: string; cnpj: string };

export type SefazDoMdfe = {
  url: string;
  autoridades: string[];
  modo: ModoDaSefazDoMdfe;
  /** O modo de UM serviço (pelo nome, ex.: `MDFeRecepcaoSinc`), quando difere do geral: a recepção muda e as consultas seguem respondendo. */
  modoDe: Partial<Record<string, ModoDaSefazDoMdfe>>;
  atrasoMs: number;
  /** Quantas consultas pela chave ainda respondem "não consta" (217) mesmo para um MDF-e autorizado. */
  consultasCegas: number;
  chamadas: ChamadaDoMdfe[];
  autorizados: Map<string, Autorizado>;
  encerrados: Set<string>;
  cancelados: Set<string>;
  /** MDF-e em aberto que não foram emitidos por este sistema: a consulta de não encerrados os devolve também. */
  abertosDeFora: { chave: string; protocolo: string }[];
  /** Os eventos que este servidor registrou, na ordem. */
  eventos: { chave: string; tipo: string; sequencia: string }[];
  fechar: () => Promise<void>;
};

const NS = "http://www.portalfiscal.inf.br/mdfe";

const envelope = (servico: string, metodo: string, conteudo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><${metodo}Result xmlns="${NS}/wsdl/${servico}">${conteudo}</${metodo}Result></soap:Body></soap:Envelope>`;

const horario = () => `${new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;

let sequencial = 0;
// O protocolo do MDF-e começa com 9 (autorizador nacional).
const novoProtocolo = () => `9352600${String(Date.now() % 100000).padStart(5, "0")}${String((sequencial += 1) % 1000).padStart(3, "0")}`;

function protocoloXml(chave: string, autorizado: Autorizado, cStat = 100, motivo = "Autorizado o uso do MDF-e") {
  return `<protMDFe versao="3.00"><infProt Id="ID${autorizado.protocolo}"><tpAmb>${autorizado.ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><chMDFe>${chave}</chMDFe><dhRecbto>${autorizado.recebidoEm}</dhRecbto><nProt>${autorizado.protocolo}</nProt><digVal>${autorizado.resumo}</digVal><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo></infProt></protMDFe>`;
}

const DESCRICAO_DO_EVENTO: Record<string, string> = { "110111": "Cancelamento", "110112": "Encerramento", "110114": "Inclusao Condutor", "110115": "Inclusao DF-e" };

/**
 * Sobe um servidor HTTPS em 127.0.0.1 que responde como os web services do
 * MDF-e (SVRS). Pede o certificado do cliente (autenticação mútua) e recusa com
 * 403 quem não apresenta um, como a SEFAZ.
 */
export async function subirSefazDoMdfe(): Promise<SefazDoMdfe> {
  const { chavePem, certificadoPem } = certificadoDoServidor();
  const estado: SefazDoMdfe = {
    url: "",
    autoridades: [certificadoPem],
    modo: "autorizar",
    modoDe: {},
    atrasoMs: 0,
    consultasCegas: 0,
    chamadas: [],
    autorizados: new Map(),
    encerrados: new Set(),
    cancelados: new Set(),
    abertosDeFora: [],
    eventos: [],
    fechar: async () => undefined,
  };

  const responder = (servico: string, dados: string, modo: ModoDaSefazDoMdfe): string | null => {
    const ambiente = /<tpAmb>([12])<\/tpAmb>/.exec(dados)?.[1] ?? "2";
    const retorno = (raiz: string, cStat: number, motivo: string, resto = "") =>
      `<${raiz} xmlns="${NS}" versao="3.00"><tpAmb>${ambiente}</tpAmb><cUF>35</cUF><verAplic>TESTE-1.0</verAplic><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo>${resto}</${raiz}>`;

    if (servico === "MDFeStatusServico") {
      const parado = modo === "parado";
      return envelope(
        servico,
        "mdfeStatusServicoMDF",
        `<retConsStatServMDFe xmlns="${NS}" versao="3.00"><tpAmb>${ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><cStat>${parado ? 108 : 107}</cStat><xMotivo>${parado ? "Serviço Paralisado Momentaneamente" : "Serviço em Operação"}</xMotivo><cUF>43</cUF><dhRecbto>${horario()}</dhRecbto><tMed>1</tMed></retConsStatServMDFe>`,
      );
    }

    if (servico === "MDFeRecepcaoSinc") {
      const metodo = "mdfeRecepcao";
      const chave = /Id="MDFe([0-9A-Z]{44})"/.exec(dados)?.[1] ?? "";
      const resumo = /<DigestValue>([^<]+)<\/DigestValue>/.exec(dados)?.[1] ?? "";
      if (modo === "parado") return envelope(servico, metodo, retorno("retMDFe", 108, "Serviço Paralisado Momentaneamente"));
      if (modo === "rejeitar") return envelope(servico, metodo, retorno("retMDFe", 698, "Rejeição: Seguro da carga é obrigatório para modal Prestador de Serviço de Transporte no modal rodoviário"));
      if (modo === "nao-encerrado") {
        return envelope(
          servico,
          metodo,
          retorno("retMDFe", 611, `Rejeição: Existe MDFe não encerrado para esta placa, tipo de emitente e UF descarregamento [chMDFe: ${chaveDeExemplo("58", 99)}][nProt:935260000000099]`),
        );
      }
      if (modo === "numero-usado") {
        return envelope(servico, metodo, retorno("retMDFe", 539, `Rejeição: Duplicidade de MDFe, com diferença na Chave de Acesso [chMDFe: ${chaveDeExemplo("58", 98)}]`));
      }
      if (modo === "duplicidade" || estado.autorizados.has(chave)) {
        return envelope(servico, metodo, retorno("retMDFe", 204, "Rejeição: Duplicidade de MDFe [nProt:935260000000001][dhAut: 2026-10-10T10:00:00-03:00]"));
      }
      if (modo === "sem-protocolo") return envelope(servico, metodo, retorno("retMDFe", 100, "Autorizado o uso do MDF-e"));
      const autorizado: Autorizado = { protocolo: novoProtocolo(), resumo, recebidoEm: horario(), ambiente, cnpj: chave.slice(6, 20) };
      if (modo === "outra-chave") {
        return envelope(servico, metodo, retorno("retMDFe", 100, "Autorizado o uso do MDF-e", protocoloXml(`${chave.slice(0, 43)}${(Number(chave[43]) + 1) % 10}`, autorizado)));
      }
      estado.autorizados.set(chave, autorizado);
      return envelope(servico, metodo, retorno("retMDFe", 100, "Autorizado o uso do MDF-e", protocoloXml(chave, autorizado)));
    }

    if (servico === "MDFeConsulta") {
      const chave = /<chMDFe>([0-9A-Z]{44})<\/chMDFe>/.exec(dados)?.[1] ?? "";
      const autorizado = estado.autorizados.get(chave);
      const raiz = (cStat: number, motivo: string, resto = "") =>
        `<retConsSitMDFe xmlns="${NS}" versao="3.00"><tpAmb>${ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo><cUF>43</cUF>${resto}</retConsSitMDFe>`;
      const cega = estado.consultasCegas > 0;
      if (cega) estado.consultasCegas -= 1;
      if (!autorizado || cega) return envelope(servico, "mdfeConsultaMDF", raiz(217, "Rejeição: MDF-e não consta na base de dados da SEFAZ"));
      if (estado.cancelados.has(chave)) return envelope(servico, "mdfeConsultaMDF", raiz(101, "Cancelamento de MDF-e homologado", protocoloXml(chave, autorizado, 101, "Cancelamento de MDF-e homologado")));
      if (estado.encerrados.has(chave)) return envelope(servico, "mdfeConsultaMDF", raiz(132, "Encerramento de MDF-e homologado", protocoloXml(chave, autorizado, 132, "Encerramento de MDF-e homologado")));
      return envelope(servico, "mdfeConsultaMDF", raiz(100, "Autorizado o uso do MDF-e", protocoloXml(chave, autorizado)));
    }

    if (servico === "MDFeConsNaoEnc") {
      const cnpj = /<CNPJ>([0-9A-Z]{14})<\/CNPJ>/.exec(dados)?.[1] ?? "";
      const raiz = (cStat: number, motivo: string, resto = "") =>
        `<retConsMDFeNaoEnc xmlns="${NS}" versao="3.00"><tpAmb>${ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo><cUF>43</cUF>${resto}</retConsMDFeNaoEnc>`;
      if (modo === "rejeitar") return envelope(servico, "mdfeConsNaoEnc", raiz(203, "Rejeição: Emissor não habilitado para emissão do MDF-e"));
      const abertos = [
        ...estado.abertosDeFora,
        ...[...estado.autorizados.entries()]
          .filter(([chave, autorizado]) => autorizado.cnpj === cnpj && autorizado.ambiente === ambiente && !estado.encerrados.has(chave) && !estado.cancelados.has(chave))
          .map(([chave, autorizado]) => ({ chave, protocolo: autorizado.protocolo })),
      ];
      if (abertos.length === 0) return envelope(servico, "mdfeConsNaoEnc", raiz(112, "MDF-e não encerrados não localizados"));
      return envelope(
        servico,
        "mdfeConsNaoEnc",
        raiz(111, "MDF-e não encerrados localizados", abertos.map((aberto) => `<infMDFe><chMDFe>${aberto.chave}</chMDFe><nProt>${aberto.protocolo}</nProt></infMDFe>`).join("")),
      );
    }

    if (servico === "MDFeRecepcaoEvento") {
      const metodo = "mdfeRecepcaoEvento";
      const chave = /<chMDFe>([0-9A-Z]{44})<\/chMDFe>/.exec(dados)?.[1] ?? "";
      const tipo = /<tpEvento>(\d{6})<\/tpEvento>/.exec(dados)?.[1] ?? "";
      const sequencia = /<nSeqEvento>(\d{1,3})<\/nSeqEvento>/.exec(dados)?.[1] ?? "1";
      const evento = (cStat: number, motivo: string, resto = "") =>
        `<retEventoMDFe xmlns="${NS}" versao="3.00"><infEvento><tpAmb>${ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><cOrgao>35</cOrgao><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo><chMDFe>${chave}</chMDFe><tpEvento>${tipo}</tpEvento>${resto}</infEvento></retEventoMDFe>`;
      if (modo === "rejeitar") {
        return envelope(servico, metodo, tipo === "110111" ? evento(220, "Rejeição: MDF-e autorizado há mais de 24 horas") : evento(615, "Rejeição: Data de encerramento anterior à data de autorização do MDF-e"));
      }
      if (!estado.autorizados.has(chave)) return envelope(servico, metodo, evento(217, "Rejeição: MDF-e não consta na base de dados da SEFAZ"));
      if (estado.cancelados.has(chave)) {
        return envelope(servico, metodo, evento(218, "Rejeição: MDF-e já está cancelado na base de dados da SEFAZ [nProt:935260000000002][dhCanc: 2026-10-10T10:00:00-03:00]"));
      }
      if (estado.encerrados.has(chave)) {
        return envelope(servico, metodo, evento(609, "Rejeição: MDF-e já está encerrado na base de dados da SEFAZ [nProt:935260000000003][dhEnc: 2026-10-10T10:00:00-03:00]"));
      }
      // Só MDF-e com indicação de carregamento posterior aceita inclusão de DF-e (regra K05).
      if (tipo === "110115") return envelope(servico, metodo, evento(708, "Rejeição: MDF-e deve possuir indicação de carregamento posterior para inclusão de DF-e"));
      if (estado.eventos.some((registrado) => registrado.chave === chave && registrado.tipo === tipo && registrado.sequencia === sequencia)) {
        return envelope(servico, metodo, evento(631, "Rejeição: Duplicidade de evento"));
      }
      if (tipo === "110111") estado.cancelados.add(chave);
      if (tipo === "110112") estado.encerrados.add(chave);
      estado.eventos.push({ chave, tipo, sequencia });
      return envelope(
        servico,
        metodo,
        evento(135, "Evento registrado e vinculado a MDF-e", `<xEvento>${DESCRICAO_DO_EVENTO[tipo] ?? "Evento"}</xEvento><nSeqEvento>${sequencia}</nSeqEvento><dhRegEvento>${horario()}</dhRegEvento><nProt>${novoProtocolo()}</nProt>`),
      );
    }
    return null;
  };

  const servidor: Server = createServer({ key: chavePem, cert: certificadoPem, requestCert: true, rejectUnauthorized: false, minVersion: "TLSv1.2" }, (req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (parte: Buffer) => partes.push(parte));
    req.on("end", () => {
      const corpo = Buffer.concat(partes).toString("utf8");
      const servico = (req.url ?? "").split("/").pop() ?? "";
      const bruto = /<mdfeDadosMsg[^>]*>([\s\S]*)<\/mdfeDadosMsg>/.exec(corpo)?.[1] ?? "";
      const dados = servico === "MDFeRecepcaoSinc" && bruto !== "" ? gunzipSync(Buffer.from(bruto, "base64")).toString("utf8") : bruto;
      const doCliente = (req.socket as TLSSocket).getPeerCertificate();
      const certificadoDoCliente = doCliente?.raw ? createHash("sha256").update(doCliente.raw).digest("hex") : null;
      estado.chamadas.push({ servico, acao: String(req.headers["content-type"] ?? ""), dados, certificadoDoCliente });

      if (!certificadoDoCliente) {
        res.writeHead(403, { "Content-Type": "text/html" }).end("<html><title>403 - Forbidden: Access is denied.</title></html>");
        return;
      }
      const modo = estado.modoDe[servico] ?? estado.modo;
      if (modo === "mudo") return; // nunca responde: o cliente desiste pelo tempo limite
      if (modo === "mudo-processando") {
        // Processa como se fosse autorizar (ou registrar o evento), e a resposta se perde.
        responder(servico, dados, "autorizar");
        return;
      }
      if (modo === "fault") {
        res.writeHead(500, { "Content-Type": "application/soap+xml; charset=utf-8" }).end(
          `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="pt-BR">Falha no processamento da mensagem</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>`,
        );
        return;
      }
      const resposta = responder(servico, dados, modo);
      const enviar = () => {
        if (resposta === null) res.writeHead(404).end();
        else res.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" }).end(resposta);
      };
      if (estado.atrasoMs > 0) setTimeout(enviar, estado.atrasoMs);
      else enviar();
    });
  });

  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  estado.url = `https://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  estado.fechar = () =>
    new Promise<void>((resolve) => {
      servidor.closeAllConnections();
      servidor.close(() => resolve());
    });
  return estado;
}

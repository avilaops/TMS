import type { Ambiente } from "@/lib/cte";
import { campo, lerXml, XmlInvalido, type No } from "@/lib/nfe";
import { diaNoBrasil } from "@/lib/financeiro";
import { problemaDaChave, UFS_DE_DESCARGA, type TipoDeDocumento } from "@/lib/subcontratacao";

export const LIMITE_XML_SUBCONTRATADA = 1024 * 1024;
export const XML_SUBCONTRATADA_GRANDE = "O XML da subcontratada deve ter no máximo 1 MB.";
export const XML_SUBCONTRATADA_INVALIDO = "Envie um XML completo de CT-e 4.00 ou MDF-e 3.00 com protocolo de autorização coerente.";

export type XmlDaSubcontratada = {
  kind: TipoDeDocumento;
  accessKey: string;
  issuedAt: string;
  environment: Ambiente;
  protocol: string;
  unloadState: string | null;
};

type Leitura = { ok: true; documento: XmlDaSubcontratada } | { ok: false; erro: string; grande?: boolean };

/** Campos críticos precisam ter um único nó, inclusive quando há namespaces. */
function unico(no: No, nome: string): No {
  const encontrados = no.filhos.filter((filho) => filho.nome === nome);
  if (encontrados.length !== 1) throw new XmlInvalido("campo ausente ou repetido");
  return encontrados[0];
}

function texto(no: No, nome: string): string {
  const elemento = unico(no, nome);
  if (elemento.filhos.length > 0 || elemento.texto.length > 200) throw new XmlInvalido("campo inválido");
  return campo(no, nome) ?? "";
}

/** Leitura estrutural, não verificação de assinatura nem consulta à SEFAZ. */
export function lerXmlDaSubcontratada(xml: string): Leitura {
  if (new TextEncoder().encode(xml).byteLength > LIMITE_XML_SUBCONTRATADA) return { ok: false, erro: XML_SUBCONTRATADA_GRANDE, grande: true };
  try {
    const raiz = lerXml(xml);
    const cte = raiz.nome === "cteProc";
    if (!cte && raiz.nome !== "mdfeProc") throw new XmlInvalido("tipo não suportado");
    const kind = cte ? "CTE" : "MDFE";
    const versao = cte ? "4.00" : "3.00";
    const documento = unico(raiz, cte ? "CTe" : "MDFe");
    const inf = unico(documento, cte ? "infCte" : "infMDFe");
    if (raiz.atributos.get("versao") !== versao || inf.atributos.get("versao") !== versao) throw new XmlInvalido("versão inválida");
    const ide = unico(inf, "ide");
    const emit = unico(inf, "emit");
    const prefixo = cte ? "CTe" : "MDFe";
    const id = inf.atributos.get("Id") ?? "";
    if (!id.startsWith(prefixo)) throw new XmlInvalido("identificador inválido");
    const accessKey = id.slice(prefixo.length);
    const problema = problemaDaChave(kind, accessKey);
    if (problema) return { ok: false, erro: problema };

    const numero = texto(ide, cte ? "nCT" : "nMDF");
    const serie = texto(ide, "serie");
    if (
      texto(ide, "mod") !== (cte ? "57" : "58") ||
      texto(emit, "CNPJ").toUpperCase() !== accessKey.slice(6, 20) ||
      texto(ide, "cUF") !== accessKey.slice(0, 2) ||
      texto(ide, cte ? "cCT" : "cMDF") !== accessKey.slice(35, 43) ||
      texto(ide, "cDV") !== accessKey.slice(43) ||
      !/^\d{1,9}$/.test(numero) || Number(numero) !== Number(accessKey.slice(25, 34)) ||
      !/^\d{1,3}$/.test(serie) || Number(serie) !== Number(accessKey.slice(22, 25)) ||
      texto(ide, "tpEmis") !== accessKey.slice(34, 35)
    ) throw new XmlInvalido("conteúdo divergente da chave");

    const dhEmi = texto(ide, "dhEmi");
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(dhEmi)) throw new XmlInvalido("emissão inválida");
    const issuedAt = dhEmi.slice(0, 10);
    const data = new Date(`${issuedAt}T00:00:00Z`);
    if (
      Number.isNaN(Date.parse(dhEmi)) || Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== issuedAt ||
      `${issuedAt.slice(2, 4)}${issuedAt.slice(5, 7)}` !== accessKey.slice(2, 6) || issuedAt > diaNoBrasil(new Date())
    ) throw new XmlInvalido("emissão divergente da chave");

    const codigoAmbiente = texto(ide, "tpAmb");
    if (codigoAmbiente !== "1" && codigoAmbiente !== "2") throw new XmlInvalido("ambiente inválido");
    const prot = unico(unico(raiz, cte ? "protCTe" : "protMDFe"), "infProt");
    const protocol = texto(prot, "nProt");
    if (
      texto(prot, cte ? "chCTe" : "chMDFe") !== accessKey || texto(prot, "tpAmb") !== codigoAmbiente ||
      texto(prot, "cStat") !== "100" || !/^\d{15}$/.test(protocol)
    ) throw new XmlInvalido("protocolo divergente");

    const unloadState = cte ? null : texto(ide, "UFFim");
    if (!cte && !UFS_DE_DESCARGA.includes(unloadState ?? "")) throw new XmlInvalido("UF de descarga inválida");
    return { ok: true, documento: { kind, accessKey, issuedAt, environment: codigoAmbiente === "1" ? "PRODUCAO" : "HOMOLOGACAO", protocol, unloadState } };
  } catch (erro) {
    if (erro instanceof XmlInvalido) return { ok: false, erro: XML_SUBCONTRATADA_INVALIDO };
    throw erro;
  }
}

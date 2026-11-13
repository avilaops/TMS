export const CHAVE_CTE_SUB = "35261099777111000176570010000003001000003001";
export const CHAVE_MDFE_SUB = "35261099777111000176580010000003011000003010";

/** XML mínimo de entrada, com valores independentes dos leitores de produção. */
export function xmlDaSubcontratada(tipo: "CTE" | "MDFE" = "CTE", ambiente = "1") {
  const cte = tipo === "CTE";
  const chave = cte ? CHAVE_CTE_SUB : CHAVE_MDFE_SUB;
  const raiz = cte ? "cteProc" : "mdfeProc";
  const documento = cte ? "CTe" : "MDFe";
  const inf = cte ? "infCte" : "infMDFe";
  const protocolo = cte ? "protCTe" : "protMDFe";
  const campoChave = cte ? "chCTe" : "chMDFe";
  const versao = cte ? "4.00" : "3.00";
  return `<?xml version="1.0" encoding="UTF-8"?>
<${raiz} versao="${versao}" xmlns="http://www.portalfiscal.inf.br/${cte ? "cte" : "mdfe"}">
  <${documento}><${inf} Id="${documento}${chave}" versao="${versao}">
    <ide><cUF>35</cUF><mod>${cte ? "57" : "58"}</mod><serie>1</serie><${cte ? "nCT" : "nMDF"}>${cte ? "300" : "301"}</${cte ? "nCT" : "nMDF"}>
      <${cte ? "cCT" : "cMDF"}>${cte ? "00000300" : "00000301"}</${cte ? "cCT" : "cMDF"}><cDV>${cte ? "1" : "0"}</cDV>
      <dhEmi>2026-10-03T13:00:00-03:00</dhEmi><tpAmb>${ambiente}</tpAmb><tpEmis>1</tpEmis>${cte ? "" : "<UFFim>MG</UFFim>"}</ide>
    <emit><CNPJ>99777111000176</CNPJ><xNome>Transportes &amp; Companhia</xNome></emit>
  </${inf}></${documento}>
  <${protocolo} versao="${versao}"><infProt><tpAmb>${ambiente}</tpAmb><${campoChave}>${chave}</${campoChave}>
    <nProt>135260000000300</nProt><cStat>100</cStat><xMotivo>Autorizado o uso</xMotivo>
  </infProt></${protocolo}>
</${raiz}>`;
}

"use client";

import { useEffect, useState } from "react";
import {
  ALIQUOTAS_DE_2026,
  CST_DO_IBSCBS,
  FISCAL_INDISPONIVEL,
  LIMITE_DO_CERTIFICADO_BYTES,
  REGIMES,
  REGIMES_DO_SIMPLES,
  ROTULO_DO_AMBIENTE,
  SITUACOES_DO_ICMS,
  type CertificadoDaEmpresa,
  type DadosFiscais,
  type FiscalDaEmpresa,
  type Regime,
} from "@/lib/cte";
import { UFS } from "@/lib/roteiro";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, LABEL } from "../deposito/comum";

/**
 * Empresa → Fiscal: os dados do emitente de CT-e e o certificado digital A1.
 *
 * No celular a seção tem três partes (Emitente, Tributos e Certificado), para
 * cada uma caber na tela; no computador fica tudo aberto. Os dados são um
 * formulário só, salvo de uma vez. O certificado é enviado à parte: o arquivo e
 * a senha saem da tela assim que são guardados, e a tela só mostra o titular, o
 * CNPJ e a validade.
 */

const FALHA_AO_SALVAR = "Não foi possível salvar.";

type Parte = "emitente" | "tributos" | "certificado";
type Formulario = Record<string, string>;

const EM_BRANCO: Formulario = {
  cnpj: "",
  ie: "",
  razaoSocial: "",
  fantasia: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "SP",
  cep: "",
  telefone: "",
  rntrc: "",
  regime: "3",
  serie: "1",
  proximoNumero: "1",
  ambiente: "HOMOLOGACAO",
  cfopDentro: "5353",
  cfopFora: "6353",
  icms: "00",
  aliquota: "12",
  ibsCbsCst: "000",
  ibsCbsClasse: "000001",
  ibsUf: String(ALIQUOTAS_DE_2026.ibsUf).replace(".", ","),
  ibsMunicipio: String(ALIQUOTAS_DE_2026.ibsMunicipio),
  cbs: String(ALIQUOTAS_DE_2026.cbs).replace(".", ","),
  pis: "0",
  cofins: "0",
  confirmacaoDoCnpj: "",
};

const comVirgula = (numero: number) => String(numero).replace(".", ",");

const doServidor = (dados: DadosFiscais): Formulario => ({
  ...EM_BRANCO,
  cnpj: dados.cnpj,
  ie: dados.ie,
  razaoSocial: dados.razaoSocial,
  fantasia: dados.fantasia ?? "",
  logradouro: dados.logradouro,
  numero: dados.numero,
  complemento: dados.complemento ?? "",
  bairro: dados.bairro,
  cidade: dados.cidade,
  uf: dados.uf,
  cep: dados.cep,
  telefone: dados.telefone ?? "",
  rntrc: dados.rntrc,
  regime: dados.regime,
  serie: String(dados.serie),
  proximoNumero: String(dados.proximoNumero),
  ambiente: dados.ambiente,
  cfopDentro: dados.cfopDentro,
  cfopFora: dados.cfopFora,
  icms: dados.icms,
  aliquota: comVirgula(dados.aliquota),
  ibsCbsCst: dados.ibsCbsCst ?? "",
  ibsCbsClasse: dados.ibsCbsClasse ?? "",
  ibsUf: comVirgula(dados.ibsUf),
  ibsMunicipio: comVirgula(dados.ibsMunicipio),
  cbs: comVirgula(dados.cbs),
  pis: comVirgula(dados.pis),
  cofins: comVirgula(dados.cofins),
});

const dia = (instante: string) => new Date(instante).toLocaleDateString("pt-BR", { timeZone: "UTC" });

/** O arquivo em base64, lido no próprio aparelho. */
async function emBase64(arquivo: File): Promise<string> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

export function Fiscal({ escondida }: { escondida: boolean }) {
  const [fiscal, setFiscal] = useState<FiscalDaEmpresa | null>(null);
  const [form, setForm] = useState<Formulario>(EM_BRANCO);
  const [parte, setParte] = useState<Parte>("emitente");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch("/api/empresa/fiscal")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: FiscalDaEmpresa | null) => {
        if (!ativo || !corpo) return;
        setFiscal(corpo);
        if (corpo.dados) setForm(doServidor(corpo.dados));
      })
      .catch(() => {
        // Sem a leitura a seção não aparece.
      });
    return () => {
      ativo = false;
    };
  }, []);

  const chamar = async (caminho: string, method: string, corpo: unknown, sucesso: string) => {
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch(caminho, { method, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      const resposta = (await res.json().catch(() => null)) as (FiscalDaEmpresa & { error?: string }) | null;
      if (!res.ok || !resposta) return setMensagem({ ok: false, texto: resposta?.error ?? FALHA_AO_SALVAR });
      setFiscal(resposta);
      if (resposta.dados) setForm(doServidor(resposta.dados));
      // O arquivo e a senha saem da tela assim que são guardados.
      setArquivo(null);
      setSenha("");
      setMensagem({ ok: true, texto: sucesso });
    } catch {
      setMensagem({ ok: false, texto: FALHA_AO_SALVAR });
    } finally {
      setOcupado(false);
    }
  };

  const enviarCertificado = async () => {
    if (!arquivo) return;
    if (arquivo.size > LIMITE_DO_CERTIFICADO_BYTES) return setMensagem({ ok: false, texto: "Arquivo grande demais para um certificado A1." });
    await chamar("/api/empresa/fiscal/certificado", "PUT", { arquivo: await emBase64(arquivo), senha }, "Certificado guardado.");
  };

  if (!fiscal) return null;

  const campo = (nome: string, rotulo: string, opcoes: { largo?: boolean; numerico?: boolean; opcional?: boolean; maximo?: number } = {}) => (
    <label className={`block space-y-1 min-w-0 ${opcoes.largo ? "col-span-2" : ""}`}>
      <span className={LABEL}>{rotulo}</span>
      <input
        required={!opcoes.opcional}
        data-campo={nome}
        inputMode={opcoes.numerico ? "decimal" : undefined}
        maxLength={opcoes.maximo}
        value={form[nome]}
        onChange={(e) => setForm((atual) => ({ ...atual, [nome]: e.target.value }))}
        className={INPUT}
      />
    </label>
  );
  const escolha = (nome: string, rotulo: string, opcoes: readonly (readonly [string, string])[]) => (
    <label className="block space-y-1 min-w-0">
      <span className={LABEL}>{rotulo}</span>
      <select data-campo={nome} value={form[nome]} onChange={(e) => setForm((atual) => ({ ...atual, [nome]: e.target.value }))} className={INPUT}>
        {opcoes.map(([valor, texto]) => (
          <option key={valor} value={valor}>
            {texto}
          </option>
        ))}
      </select>
    </label>
  );

  const simples = REGIMES_DO_SIMPLES.includes(form.regime as Regime);
  // Passar a produção pede o CNPJ digitado de novo: é a confirmação explícita.
  const indoParaProducao = form.ambiente === "PRODUCAO" && fiscal.dados?.ambiente !== "PRODUCAO";
  const visivel = (qual: Parte) => (parte === qual ? "" : "hidden md:block ");
  const GRADE = "grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4";

  return (
    <section aria-label="Fiscal" className={`${escondida ? "hidden md:block " : ""}${CARD} p-3 md:p-6 space-y-3`}>
      <div className="hidden md:block">
        <h2 className="font-semibold text-gray-900 dark:text-white">Fiscal: emissão de CT-e</h2>
        <p className="text-sm text-gray-500 mt-0.5">Dados do emitente, tributos e o certificado digital A1 que assina e transmite o CT-e.</p>
      </div>

      <div role="tablist" aria-label="Parte do fiscal" className="md:hidden grid grid-cols-3 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
        {(
          [
            ["emitente", "Emitente"],
            ["tributos", "Tributos"],
            ["certificado", "Certificado"],
          ] as const
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={parte === chave}
            data-parte-fiscal={chave}
            onClick={() => setParte(chave)}
            className={`py-1 rounded-lg text-xs font-semibold ${parte === chave ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <form
        data-form-fiscal
        onSubmit={(e) => {
          e.preventDefault();
          void chamar("/api/empresa/fiscal", "PUT", form, "Dados fiscais salvos.");
        }}
        className={`${parte === "certificado" ? "hidden md:block " : ""}space-y-3`}
      >
        <div className={`${visivel("emitente")}${GRADE}`}>
          {campo("cnpj", "CNPJ")}
          {campo("ie", "Inscrição estadual")}
          {campo("razaoSocial", "Razão social", { largo: true, maximo: 60 })}
          {campo("fantasia", "Nome fantasia", { opcional: true, maximo: 60 })}
          {campo("telefone", "Telefone", { opcional: true })}
          {campo("logradouro", "Logradouro", { maximo: 60 })}
          {campo("numero", "Número")}
          {campo("complemento", "Complemento", { opcional: true })}
          {campo("bairro", "Bairro")}
          {campo("cidade", "Cidade")}
          {escolha("uf", "UF", UFS.map((uf) => [uf, uf] as const))}
          {campo("cep", "CEP")}
          {campo("rntrc", "RNTRC")}
        </div>

        <div className={`${visivel("tributos")}${GRADE}`}>
          {escolha("regime", "Regime (CRT)", Object.entries(REGIMES))}
          {escolha("ambiente", "Ambiente", Object.entries(ROTULO_DO_AMBIENTE))}
          {campo("serie", "Série do CT-e", { numerico: true })}
          {campo("proximoNumero", "Próximo número", { numerico: true })}
          {campo("cfopDentro", "CFOP no estado", { numerico: true, maximo: 4 })}
          {campo("cfopFora", "CFOP fora do estado", { numerico: true, maximo: 4 })}
          {escolha("icms", "ICMS", Object.entries(SITUACOES_DO_ICMS))}
          {campo("aliquota", "Alíquota do ICMS (%)", { numerico: true })}
          {escolha("ibsCbsCst", "IBS/CBS: CST", [["", simples ? "Sem o grupo" : "Escolha"], ...Object.entries(CST_DO_IBSCBS).map(([cst, { rotulo }]) => [cst, rotulo] as const)])}
          {campo("ibsCbsClasse", "Classificação (cClassTrib)", { numerico: true, opcional: true, maximo: 6 })}
          {campo("ibsUf", "IBS da UF (%)", { numerico: true })}
          {campo("ibsMunicipio", "IBS do município (%)", { numerico: true })}
          {campo("cbs", "CBS (%)", { numerico: true })}
          <div className="grid grid-cols-2 gap-x-2 min-w-0">
            {campo("pis", "PIS (%)", { numerico: true })}
            {campo("cofins", "COFINS (%)", { numerico: true })}
          </div>
          {indoParaProducao && (
            <label data-confirmar-producao className="block space-y-1 min-w-0 col-span-2">
              <span className="text-xs md:text-sm font-medium text-amber-800">Produção emite CT-e com valor fiscal. Para confirmar, digite o CNPJ do emitente:</span>
              <input required data-campo="confirmacaoDoCnpj" value={form.confirmacaoDoCnpj} onChange={(e) => setForm((atual) => ({ ...atual, confirmacaoDoCnpj: e.target.value }))} className={INPUT} />
            </label>
          )}
        </div>

        <button type="submit" disabled={ocupado} className={`${BOTAO_AZUL} w-full md:w-auto`}>
          Salvar dados fiscais
        </button>
      </form>

      <div data-certificado className={`${visivel("certificado")}space-y-2 md:pt-3 md:border-t md:border-gray-100 md:dark:border-gray-800`}>
        <h3 className="font-semibold text-sm text-gray-900 dark:text-white">Certificado digital A1</h3>
        {!fiscal.disponivel ? (
          <p data-fiscal-indisponivel className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
            {FISCAL_INDISPONIVEL}
          </p>
        ) : (
          <>
            <Certificado certificado={fiscal.certificado} />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void enviarCertificado();
              }}
              className={GRADE}
            >
              <label className="block space-y-1 min-w-0">
                <span className={LABEL}>Arquivo .pfx ou .p12</span>
                <input required type="file" accept=".pfx,.p12,application/x-pkcs12" data-campo="arquivo" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className={`${INPUT} file:mr-2 file:text-xs`} />
              </label>
              <label className="block space-y-1 min-w-0">
                <span className={LABEL}>Senha do certificado</span>
                <input required type="password" autoComplete="off" data-campo="senha" value={senha} onChange={(e) => setSenha(e.target.value)} className={INPUT} />
              </label>
              <div className="col-span-2 flex flex-wrap gap-2">
                <button type="submit" disabled={ocupado || !fiscal.dados} className={BOTAO_AZUL}>
                  {fiscal.certificado ? "Trocar certificado" : "Enviar certificado"}
                </button>
                {fiscal.certificado && (
                  <button type="button" disabled={ocupado} onClick={() => void chamar("/api/empresa/fiscal/certificado", "DELETE", undefined, "Certificado removido.")} className={`${BOTAO_CLARO} text-red-600`}>
                    Remover
                  </button>
                )}
              </div>
              {!fiscal.dados && <p className="col-span-2 text-xs text-gray-500">Salve os dados fiscais antes de enviar o certificado.</p>}
            </form>
            <p className="text-xs text-gray-500">O arquivo e a senha ficam cifrados no servidor e não voltam para a tela.</p>
          </>
        )}
      </div>

      {mensagem && (
        <p role={mensagem.ok ? "status" : "alert"} className={`text-sm ${mensagem.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {mensagem.texto}
        </p>
      )}
    </section>
  );
}

function Certificado({ certificado }: { certificado: CertificadoDaEmpresa | null }) {
  if (!certificado) {
    return (
      <p data-sem-certificado className="text-sm text-gray-600 dark:text-gray-300">
        Nenhum certificado enviado. Sem ele o CT-e não é assinado nem transmitido.
      </p>
    );
  }
  const problema = certificado.vencido ? "Vencido" : certificado.confere === null ? "É de outro CNPJ" : null;
  return (
    <div data-certificado-guardado className={`text-sm rounded-xl p-2.5 border ${problema ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}>
      <p className="font-medium truncate">{certificado.titular}</p>
      <p className="text-xs">
        CNPJ {certificado.cnpj} · válido até {dia(certificado.validoAte)}
        {problema ? ` · ${problema}` : certificado.confere === "MESMA_EMPRESA" ? " · de outro estabelecimento da mesma empresa" : " · confere com o emitente"}
      </p>
    </div>
  );
}

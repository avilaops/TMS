import type { SugestaoParaOMdfe } from "@/lib/frete-contratado";
import type { EntradasDoMdfe } from "@/lib/mdfe";

/**
 * O formulário do MDF-e na tela (tudo texto, como os campos) e a ida e a volta
 * para o que a rota recebe (`EntradasDoMdfe`). Puro, para a tela e os testes.
 *
 * A tela oferece o caso comum: um CIOT, um dispositivo de vale-pedágio, uma
 * parcela no pagamento a prazo e até dois reboques. A rota aceita mais.
 */

export type FormularioDoMdfe = {
  /** UFs do meio do caminho, separadas por vírgula ou espaço: "PR, SC". */
  percurso: string;
  ciot: string;
  ciotDocumento: string;
  seguroResponsavel: "1" | "2";
  seguroDocumento: string;
  seguradora: string;
  cnpjDaSeguradora: string;
  apolice: string;
  /** Averbações separadas por vírgula. */
  averbacoes: string;
  tipoDeCarga: string;
  produto: string;
  ncm: string;
  cepDeCarregamento: string;
  cepDeDescarregamento: string;
  pagador: string;
  pagadorNome: string;
  valorDoFrete: string;
  aPrazo: boolean;
  adiantamento: string;
  vencimento: string;
  conta: "pix" | "banco" | "ipef";
  pix: string;
  banco: string;
  agencia: string;
  cnpjDaIpef: string;
  valePedagioCategoria: string;
  valePedagioFornecedor: string;
  valePedagioValor: string;
  valePedagioCompra: string;
  valePedagioTipo: string;
  reboque1: string;
  reboque2: string;
  /** Lacres separados por vírgula. */
  lacres: string;
};

export const FORMULARIO_EM_BRANCO: FormularioDoMdfe = {
  percurso: "",
  ciot: "",
  ciotDocumento: "",
  seguroResponsavel: "1",
  seguroDocumento: "",
  seguradora: "",
  cnpjDaSeguradora: "",
  apolice: "",
  averbacoes: "",
  tipoDeCarga: "05",
  produto: "",
  ncm: "",
  cepDeCarregamento: "",
  cepDeDescarregamento: "",
  pagador: "",
  pagadorNome: "",
  valorDoFrete: "",
  aPrazo: false,
  adiantamento: "",
  vencimento: "",
  conta: "pix",
  pix: "",
  banco: "",
  agencia: "",
  cnpjDaIpef: "",
  valePedagioCategoria: "",
  valePedagioFornecedor: "",
  valePedagioValor: "",
  valePedagioCompra: "",
  valePedagioTipo: "",
  reboque1: "",
  reboque2: "",
  lacres: "",
};

const lista = (texto: string) =>
  texto
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const numero = (valor: number | null | undefined) => (valor === null || valor === undefined ? "" : String(valor).replace(".", ","));

/** O formulário aberto com o que a conferência devolveu (o que a pessoa informou da última vez, ou o que o cadastro sugere). */
export function formularioDasEntradas(entradas: EntradasDoMdfe): FormularioDoMdfe {
  const { seguro, produto, lotacao, pagamento, valePedagio } = entradas;
  const ciot = entradas.ciots?.[0];
  const conta = pagamento?.conta;
  return {
    ...FORMULARIO_EM_BRANCO,
    percurso: (entradas.percurso ?? []).join(", "),
    ciot: ciot?.codigo ?? "",
    ciotDocumento: ciot?.documento ?? "",
    seguroResponsavel: seguro?.responsavel === "2" ? "2" : "1",
    seguroDocumento: seguro?.documento ?? "",
    seguradora: seguro?.seguradora ?? "",
    cnpjDaSeguradora: seguro?.cnpjDaSeguradora ?? "",
    apolice: seguro?.apolice ?? "",
    averbacoes: (seguro?.averbacoes ?? []).join(", "),
    tipoDeCarga: produto?.tipoDeCarga ?? "05",
    produto: produto?.descricao ?? "",
    ncm: produto?.ncm ?? "",
    cepDeCarregamento: lotacao?.cepDeCarregamento ?? "",
    cepDeDescarregamento: lotacao?.cepDeDescarregamento ?? "",
    pagador: pagamento?.documento ?? "",
    pagadorNome: pagamento?.nome ?? "",
    valorDoFrete: numero(pagamento?.valor),
    aPrazo: pagamento?.aPrazo ?? false,
    adiantamento: numero(pagamento?.adiantamento),
    vencimento: pagamento?.parcelas?.[0]?.vencimento ?? "",
    conta: conta && "banco" in conta ? "banco" : conta && "cnpjDaIpef" in conta ? "ipef" : "pix",
    pix: conta && "pix" in conta ? conta.pix : "",
    banco: conta && "banco" in conta ? conta.banco : "",
    agencia: conta && "banco" in conta ? conta.agencia : "",
    cnpjDaIpef: conta && "cnpjDaIpef" in conta ? conta.cnpjDaIpef : "",
    valePedagioCategoria: valePedagio?.categoria ?? "",
    valePedagioFornecedor: valePedagio?.cnpjDoFornecedor ?? "",
    valePedagioValor: numero(valePedagio?.valor),
    valePedagioCompra: valePedagio?.compra ?? "",
    valePedagioTipo: valePedagio?.tipo ?? "",
    reboque1: entradas.reboques?.[0] ?? "",
    reboque2: entradas.reboques?.[1] ?? "",
    lacres: (entradas.lacres ?? []).join(", "),
  };
}

/**
 * O que o contrato de frete da viagem sugere para os campos do pagamento do
 * frete, já como texto de campo. A tela mostra como exemplo (o campo continua
 * em branco e nada vai para a rota) e só copia para o formulário quando a
 * pessoa aceita (`aplicarSugestao`). O vencimento do saldo não vem do contrato:
 * continua com quem emite.
 */
export function camposDaSugestao(sugestao: SugestaoParaOMdfe): Pick<FormularioDoMdfe, "pagador" | "pagadorNome" | "valorDoFrete" | "aPrazo" | "adiantamento" | "pix"> {
  return {
    pagador: sugestao.pagador?.documento ?? "",
    pagadorNome: (sugestao.pagador?.nome ?? "").slice(0, 60),
    valorDoFrete: numero(sugestao.valor),
    aPrazo: sugestao.aPrazo,
    // À vista não leva adiantamento (regra F63 do MOC, rejeição 739).
    adiantamento: sugestao.aPrazo && sugestao.adiantamento > 0 ? numero(sugestao.adiantamento) : "",
    pix: sugestao.pix ?? "",
  };
}

/** O formulário com a sugestão do contrato aceita. Sem chave Pix na sugestão, a conta fica como estava. */
export function aplicarSugestao(form: FormularioDoMdfe, sugestao: SugestaoParaOMdfe): FormularioDoMdfe {
  const { pix, ...campos } = camposDaSugestao(sugestao);
  return { ...form, ...campos, ...(pix ? { conta: "pix" as const, pix } : {}) };
}

/** Só o pagamento do frete, como a rota do evento de pagamento o recebe. `null`: nem quem paga nem o valor foram informados. */
export const pagamentoDoFormulario = (form: FormularioDoMdfe): unknown => entradasDoFormulario(form, false).pagamento ?? null;

const valorDoTexto = (texto: string) => Number(texto.trim().replace(/\./g, "").replace(",", "."));

/**
 * O que vai para a rota. Grupo em branco não vai (a rota diz o que a norma
 * exige); grupo começado vai como está, e a validação da rota aponta o campo
 * que falta. `percursoInformado`: a pessoa mexeu no percurso (em branco, com
 * isso, quer dizer "sem UF no meio").
 */
export function entradasDoFormulario(form: FormularioDoMdfe, percursoInformado: boolean): Record<string, unknown> {
  const percurso = form.percurso.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const temSeguro = [form.seguradora, form.cnpjDaSeguradora, form.apolice, form.averbacoes].some((campo) => campo.trim() !== "");
  const temProduto = form.produto.trim() !== "" || form.ncm.trim() !== "";
  const temLotacao = form.cepDeCarregamento.trim() !== "" || form.cepDeDescarregamento.trim() !== "";
  const temPagamento = form.pagador.trim() !== "" || form.valorDoFrete.trim() !== "";
  const temValePedagio = form.valePedagioFornecedor.trim() !== "" || form.valePedagioValor.trim() !== "";
  const temCiot = form.ciot.trim() !== "" || form.ciotDocumento.trim() !== "";
  const frete = valorDoTexto(form.valorDoFrete);
  const adiantamento = form.adiantamento.trim() === "" ? 0 : valorDoTexto(form.adiantamento);
  const conta = form.conta === "banco" ? { banco: form.banco, agencia: form.agencia } : form.conta === "ipef" ? { cnpjDaIpef: form.cnpjDaIpef } : { pix: form.pix };

  return {
    ...(percursoInformado || percurso.length > 0 ? { percurso } : {}),
    ...(temCiot ? { ciots: [{ codigo: form.ciot, documento: form.ciotDocumento }] } : {}),
    ...(temSeguro
      ? {
          seguro: {
            responsavel: form.seguroResponsavel,
            documento: form.seguroResponsavel === "2" ? form.seguroDocumento : null,
            seguradora: form.seguradora,
            cnpjDaSeguradora: form.cnpjDaSeguradora,
            apolice: form.apolice,
            averbacoes: lista(form.averbacoes),
          },
        }
      : {}),
    ...(temProduto ? { produto: { tipoDeCarga: form.tipoDeCarga, descricao: form.produto, ncm: form.ncm } } : {}),
    ...(temLotacao ? { lotacao: { cepDeCarregamento: form.cepDeCarregamento, cepDeDescarregamento: form.cepDeDescarregamento } } : {}),
    ...(temPagamento
      ? {
          pagamento: {
            nome: form.pagadorNome,
            documento: form.pagador,
            valor: form.valorDoFrete,
            aPrazo: form.aPrazo,
            ...(form.aPrazo
              ? {
                  adiantamento: form.adiantamento,
                  // Uma parcela só, com o que sobra do adiantamento.
                  parcelas: [{ vencimento: form.vencimento, valor: Number.isFinite(frete - adiantamento) ? Math.round((frete - adiantamento) * 100) / 100 : form.valorDoFrete }],
                }
              : {}),
            conta,
          },
        }
      : {}),
    ...(temValePedagio
      ? {
          valePedagio: {
            categoria: form.valePedagioCategoria,
            cnpjDoFornecedor: form.valePedagioFornecedor,
            valor: form.valePedagioValor,
            compra: form.valePedagioCompra,
            tipo: form.valePedagioTipo,
          },
        }
      : {}),
    ...(form.reboque1 || form.reboque2 ? { reboques: [form.reboque1, form.reboque2].filter(Boolean) } : {}),
    ...(lista(form.lacres).length > 0 ? { lacres: lista(form.lacres) } : {}),
  };
}

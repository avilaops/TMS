import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  NAO_E_OFX,
  OFX_GRANDE,
  OFX_SEM_MOVIMENTO,
  OFX_VAZIO,
  OfxError,
  TAMANHO_MAXIMO_DO_OFX,
  diaDoOfx,
  lerOfx,
  mascararConta,
  textoDoOfx,
  valorDoOfx,
} from "../src/lib/ofx";
import {
  ENCARGOS_NAO_FECHAM,
  VALOR_DIFERENTE_A_PAGAR,
  acaoDaLinhaSchema,
  candidatosDaLinha,
  diasEntre,
  encargosDaConciliacao,
  formaDePagamentoDoExtrato,
  instanteDoDia,
  situacaoDaLinha,
  sugerirConciliacao,
  type LinhaDoExtrato,
  type RespostaDaConciliacao,
  type RespostaDaImportacao,
  type TituloCandidato,
} from "../src/lib/conciliacao";
import { diaNoBrasil } from "../src/lib/financeiro";
import { CAPACIDADES } from "../src/lib/permissoes";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

/* ------------------------- Extratos de exemplo (inventados) -------------------- */

type Movimento = { fitId?: string; data: string; valor: string; memo: string; tipo?: string; nome?: string };

/** Um extrato OFX 1.x (SGML): cabeçalho em linhas e campos sem fechamento, como os bancos exportam. */
function ofx1(movimentos: Movimento[], { banco = "9999", agencia = "0001", conta = "0099887-7" } = {}): string {
  const linhas = movimentos.map(
    (m) =>
      `<STMTTRN>\n<TRNTYPE>${m.tipo ?? (m.valor.startsWith("-") ? "DEBIT" : "CREDIT")}\n<DTPOSTED>${m.data}\n<TRNAMT>${m.valor}\n${m.fitId === undefined ? "" : `<FITID>${m.fitId}\n`}<CHECKNUM>000123\n${m.nome ? `<NAME>${m.nome}\n` : ""}<MEMO>${m.memo}\n</STMTTRN>`,
  );
  return [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "SECURITY:NONE",
    "ENCODING:USASCII",
    "CHARSET:1252",
    "COMPRESSION:NONE",
    "OLDFILEUID:NONE",
    "NEWFILEUID:NONE",
    "",
    "<OFX>",
    "<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20131010120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>",
    "<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>",
    "<STMTRS>",
    "<CURDEF>BRL",
    `<BANKACCTFROM><BANKID>${banco}<BRANCHID>${agencia}<ACCTID>${conta}<ACCTTYPE>CHECKING</BANKACCTFROM>`,
    "<BANKTRANLIST>",
    "<DTSTART>20131001120000[-3:BRT]",
    "<DTEND>20131031120000[-3:BRT]",
    ...linhas,
    "</BANKTRANLIST>",
    "<LEDGERBAL><BALAMT>10000.00<DTASOF>20131031</LEDGERBAL>",
    "</STMTRS></STMTTRNRS></BANKMSGSRSV1>",
    "</OFX>",
  ].join("\r\n");
}

/** O mesmo extrato em OFX 2.x (XML): tudo fechado, com declaração XML e instrução `<?OFX ...?>`. */
function ofx2(movimentos: Movimento[], { banco = "9999", agencia = "0001", conta = "0099887-7" } = {}): string {
  const linhas = movimentos.map(
    (m) =>
      `<STMTTRN><TRNTYPE>${m.tipo ?? (m.valor.startsWith("-") ? "DEBIT" : "CREDIT")}</TRNTYPE><DTPOSTED>${m.data}</DTPOSTED><TRNAMT>${m.valor}</TRNAMT>${m.fitId === undefined ? "" : `<FITID>${m.fitId}</FITID>`}${m.nome ? `<NAME>${m.nome}</NAME>` : ""}<MEMO>${m.memo}</MEMO></STMTTRN>`,
  );
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>20131010120000</DTSERVER><LANGUAGE>POR</LANGUAGE></SONRS></SIGNONMSGSRSV1>
  <BANKMSGSRSV1><STMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
    <STMTRS>
      <CURDEF>BRL</CURDEF>
      <BANKACCTFROM><BANKID>${banco}</BANKID><BRANCHID>${agencia}</BRANCHID><ACCTID>${conta}</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
      <BANKTRANLIST>
        <DTSTART>20131001</DTSTART>
        <DTEND>20131031</DTEND>
        ${linhas.join("\n        ")}
      </BANKTRANLIST>
      <LEDGERBAL><BALAMT>10000.00</BALAMT><DTASOF>20131031</DTASOF></LEDGERBAL>
    </STMTRS>
  </STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
}

const MOVIMENTOS: Movimento[] = [
  { fitId: "2013100500001", data: "20131005100000[-3:BRT]", valor: "1500.00", memo: "PIX RECEBIDO FAT000123 COMERCIAL AURORA" },
  { fitId: "2013100600001", data: "20131006", valor: "-45,90", memo: "TARIFA PACOTE SERVI&amp;OS" },
  { fitId: "2013100700001", data: "20131007235959.000[-3:BRT]", valor: "-1.234,56", memo: "PAGAMENTO DE BOLETO", nome: "POSTO ESTRELA" },
  { fitId: "SALDO", data: "20131001", valor: "0.00", memo: "SALDO ANTERIOR", tipo: "OTHER" },
];

/** O leitor de OFX, sem banco. */
describe("leitor de OFX", () => {
  const recusa = (texto: string) => {
    try {
      lerOfx(texto);
    } catch (erro) {
      expect(erro).toBeInstanceOf(OfxError);
      return (erro as Error).message;
    }
    throw new Error("O leitor deveria ter recusado o arquivo.");
  };

  it("lê OFX 1.x (SGML, campos sem fechamento): conta mascarada, período e movimentações", () => {
    const leitura = lerOfx(ofx1(MOVIMENTOS));
    expect(leitura.versao).toBe(1);
    expect(leitura.extratos).toHaveLength(1);
    const [extrato] = leitura.extratos;
    expect(extrato.conta).toEqual({ banco: "9999", agencia: "0001", numero: "0099887-7", mascarada: "••••87-7", tipo: "CHECKING" });
    expect(extrato.inicio).toBe("2013-10-01");
    expect(extrato.fim).toBe("2013-10-31");
    // A movimentação de valor zero ("saldo anterior") não entra.
    expect(extrato.transacoes).toEqual([
      { fitId: "2013100500001", dia: "2013-10-05", valor: 1500, tipo: "CREDIT", descricao: "PIX RECEBIDO FAT000123 COMERCIAL AURORA" },
      { fitId: "2013100600001", dia: "2013-10-06", valor: -45.9, tipo: "DEBIT", descricao: "TARIFA PACOTE SERVI&OS" },
      { fitId: "2013100700001", dia: "2013-10-07", valor: -1234.56, tipo: "DEBIT", descricao: "POSTO ESTRELA - PAGAMENTO DE BOLETO" },
    ]);
  });

  it("lê OFX 2.x (XML) e chega ao mesmo resultado do 1.x", () => {
    const leitura = lerOfx(ofx2(MOVIMENTOS));
    expect(leitura.versao).toBe(2);
    expect(leitura.extratos).toEqual(lerOfx(ofx1(MOVIMENTOS)).extratos);
  });

  it("datas: AAAAMMDD com hora, fração e fuso opcionais; vale o dia escrito; data que não existe é recusada", () => {
    expect(diaDoOfx("20131005")).toBe("2013-10-05");
    expect(diaDoOfx("20131005103000")).toBe("2013-10-05");
    expect(diaDoOfx("201310051030")).toBe("2013-10-05");
    expect(diaDoOfx("20131005235959.123[-3:BRT]")).toBe("2013-10-05");
    expect(diaDoOfx("20131005000000[0:GMT]")).toBe("2013-10-05");
    expect(diaDoOfx("20131005120000.000[-03:EST]")).toBe("2013-10-05");
    expect(diaDoOfx(" 20240229 ")).toBe("2024-02-29");
    for (const ruim of ["20130229", "20131332", "20131000", "2013-10-05", "05/10/2013", "2013100", "", "abc", null, undefined]) {
      expect(diaDoOfx(ruim), String(ruim)).toBeNull();
    }
  });

  it("valores: ponto ou vírgula como decimal, milhar dos dois jeitos, sinal, e o que não é número", () => {
    expect(valorDoOfx("-1234.56")).toBe(-1234.56);
    expect(valorDoOfx("1234,56")).toBe(1234.56);
    expect(valorDoOfx("-1.234,56")).toBe(-1234.56);
    expect(valorDoOfx("1,234.56")).toBe(1234.56);
    expect(valorDoOfx("1.234.567,89")).toBe(1234567.89);
    expect(valorDoOfx("+50.00")).toBe(50);
    expect(valorDoOfx("-0.10")).toBe(-0.1);
    expect(valorDoOfx(" 100 ")).toBe(100);
    expect(valorDoOfx("0")).toBe(0);
    for (const ruim of ["", "abc", "12a", "--5", "1.234.567", "R$ 10,00", ",", null, undefined]) {
      expect(valorDoOfx(ruim), String(ruim)).toBeNull();
    }
  });

  it("conta: só o fim do número aparece", () => {
    expect(mascararConta("0012345-6")).toBe("••••45-6");
    expect(mascararConta("123")).toBe("••••3");
    expect(mascararConta("12345")).toBe("••••2345");
    expect(mascararConta("")).toBe("conta não informada");
    expect(JSON.stringify(lerOfx(ofx1(MOVIMENTOS)).extratos[0].conta.mascarada)).not.toContain("0099887");
  });

  it("recusa, com mensagem clara, arquivo vazio, que não é OFX, sem movimentação e grande demais", () => {
    expect(recusa("")).toBe(OFX_VAZIO);
    expect(recusa("   \n  ")).toBe(OFX_VAZIO);
    expect(recusa("data;descricao;valor\n05/10/2013;PIX;100,00")).toBe(NAO_E_OFX);
    expect(recusa('{"extrato": []}')).toBe(NAO_E_OFX);
    expect(recusa("%PDF-1.4 extrato")).toBe(NAO_E_OFX);
    expect(recusa(ofx1([]))).toBe(OFX_SEM_MOVIMENTO);
    expect(recusa(ofx1([{ fitId: "Z", data: "20131001", valor: "0.00", memo: "SALDO ANTERIOR" }]))).toBe(OFX_SEM_MOVIMENTO);
    expect(recusa(`<OFX>${"x".repeat(TAMANHO_MAXIMO_DO_OFX)}</OFX>`)).toBe(OFX_GRANDE);
    expect(() => textoDoOfx(new Uint8Array(0))).toThrow(OFX_VAZIO);
    expect(() => textoDoOfx(new Uint8Array(TAMANHO_MAXIMO_DO_OFX + 1))).toThrow(OFX_GRANDE);
  });

  it("movimentação sem data ou sem valor legível derruba a importação, dizendo qual é", () => {
    expect(recusa(ofx1([MOVIMENTOS[0], { fitId: "B", data: "05/10/2013", valor: "10.00", memo: "x" }]))).toMatch(/movimentação 2 do extrato está sem data legível \("05\/10\/2013"\)/);
    expect(recusa(ofx2([{ fitId: "A", data: "20131005", valor: "dez", memo: "x" }]))).toMatch(/movimentação 1 do extrato \(2013-10-05\) está sem valor legível \("dez"\)/);
  });

  it("identificador: repetido na mesma conta ganha #2; ausente é montado com dia, valor e descrição, igual a cada leitura", () => {
    const repetidos = lerOfx(
      ofx1([
        { fitId: "IGUAL", data: "20131005", valor: "10.00", memo: "DEPOSITO A" },
        { fitId: "IGUAL", data: "20131005", valor: "20.00", memo: "DEPOSITO B" },
        { data: "20131006", valor: "30.00", memo: "SEM IDENTIFICADOR" },
        { data: "20131006", valor: "30.00", memo: "SEM IDENTIFICADOR" },
      ]),
    ).extratos[0].transacoes.map((t) => t.fitId);
    expect(repetidos[0]).toBe("IGUAL");
    expect(repetidos[1]).toBe("IGUAL#2");
    expect(repetidos[2]).toMatch(/^SEM-ID-2013-10-06-30\.00-/);
    expect(repetidos[3]).toBe(`${repetidos[2]}#2`);
    expect(new Set(repetidos).size).toBe(4);

    const deNovo = lerOfx(ofx2([{ data: "20131006", valor: "30.00", memo: "SEM IDENTIFICADOR" }])).extratos[0].transacoes[0].fitId;
    expect(deNovo).toBe(repetidos[2]);
  });

  it("arquivo com duas contas devolve um extrato por conta; fatura de cartão usa CCACCTFROM", () => {
    const duas = `<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>9999<ACCTID>11112222</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20131001<DTEND>20131031<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20131005<TRNAMT>10.00<FITID>A1<MEMO>CONTA UM</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>5555444433332222</CCACCTFROM>
<BANKTRANLIST><DTSTART>20131001<DTEND>20131031<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20131008<TRNAMT>-99.90<FITID>A1<MEMO>POSTO</STMTTRN></BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;
    const { extratos } = lerOfx(duas);
    expect(extratos.map((e) => [e.conta.mascarada, e.conta.tipo, e.transacoes.length])).toEqual([
      ["••••2222", null, 1],
      ["••••2222", "CREDITCARD", 1],
    ]);
    // Mesmo identificador em contas diferentes não é repetição.
    expect(extratos.map((e) => e.transacoes[0].fitId)).toEqual(["A1", "A1"]);
    expect(extratos[1].conta.banco).toBeNull();
  });

  it("bytes: UTF-8 é lido como UTF-8; o que não é UTF-8 válido é lido como Windows-1252", () => {
    const texto = ofx1([{ fitId: "A", data: "20131005", valor: "10.00", memo: "LIQUIDAÇÃO DE COBRANÇA" }]);
    expect(lerOfx(textoDoOfx(new TextEncoder().encode(texto))).extratos[0].transacoes[0].descricao).toBe("LIQUIDAÇÃO DE COBRANÇA");
    expect(lerOfx(textoDoOfx(new Uint8Array(Buffer.from(texto, "latin1")))).extratos[0].transacoes[0].descricao).toBe("LIQUIDAÇÃO DE COBRANÇA");
  });
});

/** As regras da conciliação, sem banco. */
describe("regras da conciliação", () => {
  const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);
  const linha = (extra: Partial<LinhaDoExtrato> = {}): LinhaDoExtrato => ({ id: "L1", postedAt: dia("2013-10-10"), amount: 500, description: "TED RECEBIDA", ...extra });
  const titulo = (extra: Partial<TituloCandidato> = {}): TituloCandidato => ({
    id: "T1",
    type: "INCOME",
    amount: 500,
    status: "PENDING",
    dueDate: dia("2013-10-10"),
    paidAt: null,
    ...extra,
  });
  const ids = (linhaDoExtrato: LinhaDoExtrato, titulos: TituloCandidato[], janela?: number) => candidatosDaLinha(linhaDoExtrato, titulos, { janela }).map((c) => c.id);

  it("valor igual e mesmo sinal: crédito casa com a receber, débito com a pagar", () => {
    const titulos = [titulo({ id: "receber" }), titulo({ id: "pagar", type: "EXPENSE" }), titulo({ id: "outro-valor", amount: 500.01 })];
    expect(ids(linha(), titulos)).toEqual(["receber"]);
    expect(ids(linha({ amount: -500 }), titulos)).toEqual(["pagar"]);
    const [candidato] = candidatosDaLinha(linha(), titulos);
    expect(candidato).toMatchObject({ forte: true, diferenca: 0 });
    expect(candidato.motivos).toEqual(["valor igual", "vence no mesmo dia"]);
    // Centavos de ponto flutuante não atrapalham.
    expect(ids(linha({ amount: 0.1 + 0.2 }), [titulo({ amount: 0.3 })])).toEqual(["T1"]);
  });

  it("janela: vencimento a até 5 dias é forte; fora dela o título em aberto vira sugestão fraca; a janela é configurável", () => {
    const perto = titulo({ id: "perto", dueDate: dia("2013-10-05") });
    const longe = titulo({ id: "longe", dueDate: dia("2013-09-20") });
    const candidatos = candidatosDaLinha(linha(), [longe, perto]);
    expect(candidatos.map((c) => [c.id, c.forte])).toEqual([
      ["perto", true],
      ["longe", false],
    ]);
    expect(candidatos[1].motivos).toContain("vence a 20 dias (fora da janela)");
    expect(candidatosDaLinha(linha(), [titulo({ dueDate: dia("2013-10-04") })])[0].forte).toBe(false);
    expect(candidatosDaLinha(linha(), [titulo({ dueDate: dia("2013-10-16") })])[0].forte).toBe(false);
    expect(candidatosDaLinha(linha(), [longe], { janela: 30 })[0].forte).toBe(true);
    expect(candidatosDaLinha(linha(), [perto], { janela: 2 })[0].forte).toBe(false);
    // Mais perto da data, mais pontos.
    expect(ids(linha(), [titulo({ id: "a3", dueDate: dia("2013-10-13") }), titulo({ id: "a1", dueDate: dia("2013-10-09") })])).toEqual(["a1", "a3"]);
    expect(diasEntre("2013-10-10", "2013-10-13")).toBe(3);
    expect(diasEntre("2013-10-10", "2013-09-30")).toBe(-10);
  });

  it("título já pago: compara pelo dia do pagamento (no Brasil) e pelo valor que entrou de fato", () => {
    const pago = titulo({ status: "PAID", dueDate: dia("2013-09-01"), paidAt: new Date("2013-10-10T15:00:00.000Z") });
    expect(candidatosDaLinha(linha(), [pago])[0]).toMatchObject({ forte: true, motivos: ["valor igual", "pago no mesmo dia"] });
    // 01:00 UTC do dia 11 ainda é dia 10 no Brasil.
    expect(candidatosDaLinha(linha(), [{ ...pago, paidAt: new Date("2013-10-11T01:00:00.000Z") }])[0].motivos).toContain("pago no mesmo dia");
    // Pago fora da janela e sem identificação: é outro pagamento.
    expect(ids(linha(), [{ ...pago, paidAt: new Date("2013-09-01T15:00:00.000Z") }])).toEqual([]);
    // Pago com juros: o que passou no banco foi o valor recebido, não o original.
    const comJuros = titulo({ status: "PAID", amount: 480, paidAmount: 500, paidAt: new Date("2013-10-09T15:00:00.000Z") });
    expect(ids(linha(), [comJuros])).toEqual(["T1"]);
    expect(ids(linha({ amount: 480 }), [comJuros])).toEqual([]);
  });

  it("txid do Pix na descrição identifica o título, mesmo fora da janela e mesmo com valor diferente (sugestão fraca)", () => {
    const daFatura = titulo({ id: "fat", dueDate: dia("2013-08-01"), invoice: { number: 123 } });
    const pix = linha({ description: "PIX RECEBIDO - FAT000123 - COMERCIAL AURORA" });
    const [candidato] = candidatosDaLinha(pix, [daFatura]);
    expect(candidato.forte).toBe(true);
    expect(candidato.motivos).toEqual(expect.arrayContaining(["valor igual", "txid do Pix (FAT000123)"]));

    // Outro número colado não é o txid.
    expect(ids(linha({ description: "PIX FAT0001234" }), [daFatura])).toEqual(["fat"]);
    expect(candidatosDaLinha(linha({ description: "PIX FAT0001234" }), [daFatura])[0].forte).toBe(false);

    // Pagou com juros: aparece como sugestão, nunca como forte.
    const comJuros = candidatosDaLinha(linha({ amount: 512.5, description: "pix fat000123" }), [daFatura]);
    expect(comJuros).toHaveLength(1);
    expect(comJuros[0]).toMatchObject({ forte: false, diferenca: 12.5 });
    expect(comJuros[0].motivos.join(" ")).toMatch(/valor difere em R\$\s12,50 \(a mais\)/);
    // Valor diferente sem txid não é candidato.
    expect(ids(linha({ amount: 512.5 }), [daFatura])).toEqual([]);

    // Título sem fatura: o txid é TIT + id.
    const manual = titulo({ id: "3f2c1a9e-aaaa-4bbb-8ccc-1234567890ab", dueDate: null });
    expect(candidatosDaLinha(linha({ description: "PIX TIT3F2C1A9EAAAA4BBB8CCC12 FULANO" }), [manual])[0]).toMatchObject({ forte: true });
    expect(candidatosDaLinha(linha(), [manual])[0]).toMatchObject({ forte: false, motivos: ["valor igual", "sem vencimento"] });
  });

  it("número da fatura e nome do cliente na descrição somam pontos; palavra genérica da razão social não conta", () => {
    const aurora = titulo({ id: "aurora", invoice: { number: 45 }, dueDate: dia("2013-07-01"), client: { companyName: "Comercial Aurora Ltda", tradeName: "Aurora" } });
    const boreal = titulo({ id: "boreal", client: { companyName: "Comercial Boreal Ltda", tradeName: null } });

    const porFatura = candidatosDaLinha(linha({ description: "TED REF FATURA Nº 045" }), [aurora]);
    expect(porFatura[0]).toMatchObject({ forte: true });
    expect(porFatura[0].motivos).toContain("fatura nº 45 na descrição");
    expect(candidatosDaLinha(linha({ description: "TED REF FATURA 450" }), [aurora])[0].forte).toBe(false);

    const porNome = candidatosDaLinha(linha({ description: "TED RECEBIDA COMERCIAL BOREAL" }), [titulo({ id: "sem-nome" }), boreal]);
    expect(porNome.map((c) => c.id)).toEqual(["boreal", "sem-nome"]);
    expect(porNome[0].motivos).toContain("nome na descrição");
    // "Comercial" e "Ltda" sozinhos não identificam ninguém.
    expect(candidatosDaLinha(linha({ description: "TED COMERCIAL LTDA" }), [boreal])[0].motivos).not.toContain("nome na descrição");
    // Fornecedor (contraparte) também vale, no lado a pagar.
    const posto = titulo({ id: "posto", type: "EXPENSE", counterparty: "Posto Estrela" });
    expect(candidatosDaLinha(linha({ amount: -500, description: "PAGTO POSTO ESTRELA" }), [posto])[0].motivos).toContain("nome na descrição");
  });

  it("certeiro: exatamente um candidato forte; dois iguais na janela é ambíguo; o identificado desempata", () => {
    const a = titulo({ id: "a" });
    const b = titulo({ id: "b", dueDate: dia("2013-10-11") });
    expect(sugerirConciliacao([linha()], [a]).get("L1")).toMatchObject({ certeiro: "a" });
    expect(sugerirConciliacao([linha()], [a, b]).get("L1")?.certeiro).toBeNull();
    expect(sugerirConciliacao([linha()], [a, b]).get("L1")?.candidatos).toHaveLength(2);

    // Dois na janela, mas a descrição traz o txid de um deles.
    const daFatura = titulo({ id: "fat", invoice: { number: 77 } });
    expect(sugerirConciliacao([linha({ description: "PIX FAT000077" })], [a, b, daFatura]).get("L1")?.certeiro).toBe("fat");

    // Só candidato fraco (fora da janela): sugere, mas não é certeiro.
    expect(sugerirConciliacao([linha()], [titulo({ dueDate: dia("2013-08-01") })]).get("L1")).toMatchObject({ certeiro: null, candidatos: [{ id: "T1", forte: false }] });
    expect(sugerirConciliacao([linha()], []).get("L1")).toEqual({ candidatos: [], certeiro: null });
  });

  it("um título que seria o certeiro de duas linhas não é certeiro de nenhuma", () => {
    const sugestoes = sugerirConciliacao([linha({ id: "L1" }), linha({ id: "L2", postedAt: dia("2013-10-11") }), linha({ id: "L3", amount: 70 })], [titulo(), titulo({ id: "T70", amount: 70 })]);
    expect(sugestoes.get("L1")?.certeiro).toBeNull();
    expect(sugestoes.get("L2")?.certeiro).toBeNull();
    expect(sugestoes.get("L3")?.certeiro).toBe("T70");
  });

  it("encargos da conciliação: a mais vira juros, a menos vira desconto; informados precisam fechar; a pagar não aceita diferença", () => {
    const receber = { type: "INCOME", amount: 1000 };
    expect(encargosDaConciliacao(receber, 1000)).toEqual({ encargos: {}, erro: null });
    expect(encargosDaConciliacao(receber, 1012.34)).toEqual({ encargos: { juros: 12.34 }, erro: null });
    expect(encargosDaConciliacao(receber, 990)).toEqual({ encargos: { desconto: 10 }, erro: null });
    expect(encargosDaConciliacao(receber, 1030, { juros: 10, multa: 20 })).toEqual({ encargos: { juros: 10, multa: 20 }, erro: null });
    expect(encargosDaConciliacao(receber, 1030, { juros: 10 })).toEqual({ encargos: null, erro: ENCARGOS_NAO_FECHAM });
    expect(encargosDaConciliacao(receber, 1000, { desconto: 5 })).toEqual({ encargos: null, erro: ENCARGOS_NAO_FECHAM });

    const pagar = { type: "EXPENSE", amount: 200 };
    expect(encargosDaConciliacao(pagar, 200)).toEqual({ encargos: {}, erro: null });
    expect(encargosDaConciliacao(pagar, 203)).toEqual({ encargos: null, erro: VALOR_DIFERENTE_A_PAGAR });
    expect(encargosDaConciliacao(pagar, 200, { juros: 0 })).toEqual({ encargos: null, erro: VALOR_DIFERENTE_A_PAGAR });
  });

  it("forma de pagamento inferida da descrição e do tipo da movimentação", () => {
    const forma = (description: string, kind: string | null = null) => formaDePagamentoDoExtrato({ description, kind });
    expect(forma("PIX RECEBIDO FULANO")).toBe("PIX");
    expect(forma("Pix enviado - posto")).toBe("PIX");
    expect(forma("LIQUIDAÇÃO DE COBRANÇA")).toBe("BOLETO");
    expect(forma("PAGAMENTO DE BOLETO")).toBe("BOLETO");
    expect(forma("TED RECEBIDA 123")).toBe("TRANSFERENCIA");
    expect(forma("TRANSFERÊNCIA ENTRE CONTAS")).toBe("TRANSFERENCIA");
    expect(forma("CREDITO", "XFER")).toBe("TRANSFERENCIA");
    expect(forma("COMPRA CARTAO DEBITO")).toBe("CARTAO");
    expect(forma("POSTO ESTRELA", "POS")).toBe("CARTAO");
    expect(forma("SAQUE 24H")).toBe("DINHEIRO");
    expect(forma("TARIFA PACOTE")).toBeNull();
    // "pixel" e "documento" não são Pix nem DOC.
    expect(forma("COMPRA PIXEL DOCUMENTOS")).toBeNull();
  });

  it("dia do extrato vira o meio-dia do Brasil na baixa; conciliada sem lançamento volta a pendente", () => {
    expect(instanteDoDia("2013-10-10").toISOString()).toBe("2013-10-10T15:00:00.000Z");
    expect(diaNoBrasil(instanteDoDia("2013-10-10"))).toBe("2013-10-10");
    expect(situacaoDaLinha({ status: "RECONCILED", transactionId: "x" })).toBe("RECONCILED");
    expect(situacaoDaLinha({ status: "RECONCILED", transactionId: null })).toBe("PENDING");
    expect(situacaoDaLinha({ status: "IGNORED", transactionId: null })).toBe("IGNORED");
    expect(situacaoDaLinha({ status: "PENDING", transactionId: null })).toBe("PENDING");
  });

  it("validação da ação: conciliar pede o lançamento; encargo negativo e ação desconhecida são recusados", () => {
    expect(acaoDaLinhaSchema.safeParse({ action: "conciliar", transactionId: "abc" }).success).toBe(true);
    expect(acaoDaLinhaSchema.parse({ action: "conciliar", transactionId: "abc", juros: "1,50", multa: "" })).toMatchObject({ juros: 1.5 });
    expect(acaoDaLinhaSchema.safeParse({ action: "conciliar" }).success).toBe(false);
    expect(acaoDaLinhaSchema.safeParse({ action: "conciliar", transactionId: "abc", desconto: -1 }).success).toBe(false);
    expect(acaoDaLinhaSchema.parse({ action: "criar", category: " Tarifa bancária ", counterparty: "" })).toEqual({ action: "criar", category: "Tarifa bancária", counterparty: null });
    expect(acaoDaLinhaSchema.safeParse({ action: "ignorar" }).success).toBe(true);
    expect(acaoDaLinhaSchema.safeParse({ action: "desfazer" }).success).toBe(true);
    for (const ruim of [{}, null, { action: "apagar" }, { action: "criar", description: "x".repeat(201) }]) {
      expect(acaoDaLinhaSchema.safeParse(ruim).success, JSON.stringify(ruim)).toBe(false);
    }
  });

  it("conciliar paga fatura: quem lança no financeiro é o mesmo grupo que baixa fatura", () => {
    expect([...CAPACIDADES.financeiro].sort()).toEqual([...CAPACIDADES.faturamento].sort());
  });
});

/** Rotas da conciliação, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[conciliacao.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado. O banco
// "9999" e o "9998" não existem: são as contas dos extratos de teste.
const PREFIXO = "teste-conciliacao-";
const MEMO = "TESTE-CONCILIACAO";
const BANCOS = ["9999", "9998"];
const CNPJ = "99444333000980";
const CNPJ_DA_OUTRA = "99444333000809";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type Perfil = "ADMIN" | "FINANCE" | "DIRECTOR" | "OPERATION";
type Corpo = Record<string, unknown> & { error?: string };

suite("rotas da conciliação bancária", () => {
  let banco: typeof import("../src/lib/prisma");
  let conciliacao: typeof import("../src/app/api/financeiro/conciliacao/route");
  let linhaRota: typeof import("../src/app/api/financeiro/conciliacao/[id]/route");
  let certeirosRota: typeof import("../src/app/api/financeiro/conciliacao/certeiros/route");
  let lancamentoPorId: typeof import("../src/app/api/financeiro/[id]/route");
  let faturas: typeof import("../src/app/api/faturas/route");
  let faturaPorId: typeof import("../src/app/api/faturas/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;

  const entrarComo = (perfil: Perfil | null) => sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query}`, {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const arquivo = (conteudo: string | Uint8Array) => new Request("http://localhost/api/teste", { method: "POST", headers: { "Content-Type": "application/x-ofx", "x-forwarded-for": "203.0.113.7" }, body: conteudo as BodyInit });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const memo = (texto: string) => `${MEMO} ${texto}`;
  const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.bankStatementLine.deleteMany({ where: { bankId: { in: BANCOS } } });
    await sistema.financialTransaction.deleteMany({
      where: { OR: [{ description: { startsWith: PREFIXO } }, { description: { startsWith: MEMO } }, { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } }] },
    });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await sistema.invoice.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    await limparMovimento();
    await banco.sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  /** Envia um extrato com as movimentações e devolve a resposta da importação. */
  const importar = async (movimentos: Movimento[], opcoes?: Parameters<typeof ofx1>[1], perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    const res = await conciliacao.POST(arquivo(ofx1(movimentos, opcoes)));
    return { status: res.status, corpo: (await res.json()) as RespostaDaImportacao & Corpo };
  };

  const listar = async (situacao = "pendentes") => {
    entrarComo("ADMIN");
    const res = await conciliacao.GET(req("GET", undefined, `?situacao=${situacao}`));
    const corpo = (await res.json()) as RespostaDaConciliacao;
    // O banco de teste é dividido: só as linhas desta suite.
    return { ...corpo, linhas: corpo.linhas.filter((l) => l.description.startsWith(MEMO)) };
  };

  /** A linha do extrato desta suite que tem o texto na descrição. */
  const linhaCom = async (texto: string) => banco.default.bankStatementLine.findFirstOrThrow({ where: { bankId: { in: BANCOS }, description: { contains: texto } } });

  const agir = async (linhaId: string, corpo: Record<string, unknown>, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    const res = await linhaRota.PATCH(req("PATCH", corpo), ctx(linhaId));
    return { status: res.status, corpo: (await res.json()) as Corpo };
  };

  const titulo = (dados: { amount: number; type?: string; dueDate?: string | null; status?: string; paidAt?: Date; nome?: string }) =>
    banco.default.financialTransaction.create({
      data: {
        type: dados.type ?? "INCOME",
        amount: dados.amount,
        description: `${PREFIXO}${dados.nome ?? "título"}`,
        dueDate: dados.dueDate === null ? null : dia(dados.dueDate ?? "2013-10-10"),
        status: dados.status ?? "PENDING",
        paidAt: dados.paidAt ?? null,
      },
    });

  const gravado = (id: string) => banco.default.financialTransaction.findUniqueOrThrow({ where: { id } });
  const trilha = async (entityId: string) =>
    (await banco.sistema.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((a) => a.action);

  async function emitirFatura(valor: number) {
    const carga = await banco.default.collection.create({
      data: { clientId: clienteId, sender: "Remetente", receiver: "Destinatário", origin: "Mirassol - SP", destination: "Votuporanga - SP", volumes: 1, weight: 10, status: "DELIVERED", freightValue: valor },
    });
    entrarComo("ADMIN");
    const res = await faturas.POST(req("POST", { clientId: clienteId, collectionIds: [carga.id], dueDate: "2013-10-20" }));
    expect(res.status).toBe(201);
    const fatura = (await res.json()) as { id: string; number: number };
    const lancamento = await banco.default.financialTransaction.findUniqueOrThrow({ where: { invoiceId: fatura.id } });
    return { fatura, lancamento };
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    conciliacao = await import("../src/app/api/financeiro/conciliacao/route");
    linhaRota = await import("../src/app/api/financeiro/conciliacao/[id]/route");
    certeirosRota = await import("../src/app/api/financeiro/conciliacao/certeiros/route");
    lancamentoPorId = await import("../src/app/api/financeiro/[id]/route");
    faturas = await import("../src/app/api/faturas/route");
    faturaPorId = await import("../src/app/api/faturas/[id]/route");
    await limpar();

    for (const perfil of ["ADMIN", "FINANCE", "DIRECTOR", "OPERATION"] as const) {
      ids[perfil] = (
        await banco.default.user.create({ data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })
      ).id;
    }
    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}Comercial Aurora Ltda`, cnpj: CNPJ } })).id;
  }, 120_000);

  beforeEach(async () => {
    sessao.mockReset();
    await limparMovimento();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("permissão", () => {
    it("só quem lança no financeiro: sem sessão 401; operação e diretoria (só lê) 403; financeiro e administrador passam", async () => {
      await importar([{ fitId: "P1", data: "20131010", valor: "10.00", memo: memo("permissão") }]);
      const linha = await linhaCom("permissão");
      const chamadas: [string, () => Promise<Response>][] = [
        ["GET", () => conciliacao.GET(req())],
        ["POST", () => conciliacao.POST(arquivo("não é ofx"))],
        ["PATCH", () => linhaRota.PATCH(req("PATCH", { action: "ignorar" }), ctx(SEM_ID))],
        ["POST certeiros", () => certeirosRota.POST(req("POST", {}))],
      ];
      for (const [rota, chamar] of chamadas) {
        entrarComo(null);
        expect((await chamar()).status, `${rota} sem sessão`).toBe(401);
        for (const perfil of ["OPERATION", "DIRECTOR"] as const) {
          entrarComo(perfil);
          expect((await chamar()).status, `${rota} como ${perfil}`).toBe(403);
        }
        for (const perfil of ["FINANCE", "ADMIN"] as const) {
          entrarComo(perfil);
          expect([401, 403], `${rota} como ${perfil}`).not.toContain((await chamar()).status);
        }
      }
      // Nada do que foi recusado mexeu na linha.
      expect((await linhaCom("permissão")).status).toBe(linha.status);
    });
  });

  describe("importação", () => {
    const TRES: Movimento[] = [
      { fitId: "I1", data: "20131005100000[-3:BRT]", valor: "1500.00", memo: memo("PIX RECEBIDO") },
      { fitId: "I2", data: "20131006", valor: "-45,90", memo: memo("TARIFA PACOTE") },
      { fitId: "I3", data: "20131007", valor: "0.00", memo: memo("SALDO") },
    ];

    it("cada movimentação vira uma linha pendente, com conta mascarada, dia e valor com sinal; fica na auditoria", async () => {
      const { status, corpo } = await importar(TRES);
      expect(status).toBe(201);
      expect(corpo).toEqual({ importadas: 2, repetidas: 0, contas: [{ conta: "••••87-7", banco: "9999", inicio: "2013-10-01", fim: "2013-10-31", movimentacoes: 2 }] });

      const linhas = await banco.default.bankStatementLine.findMany({ where: { bankId: "9999" }, orderBy: { postedAt: "asc" } });
      expect(linhas.map((l) => [l.fitId, l.postedAt.toISOString(), l.amount, l.kind, l.status, l.account, l.transactionId])).toEqual([
        ["I1", "2013-10-05T00:00:00.000Z", 1500, "CREDIT", "PENDING", "••••87-7", null],
        ["I2", "2013-10-06T00:00:00.000Z", -45.9, "DEBIT", "PENDING", "••••87-7", null],
      ]);
      // O número inteiro da conta não está em coluna nenhuma.
      expect(JSON.stringify(linhas)).not.toContain("0099887");

      const auditoria = await banco.sistema.auditLog.findFirst({ where: { action: "conciliacao.importar", userId: ids.ADMIN }, orderBy: { createdAt: "desc" } });
      expect(auditoria).toMatchObject({ entity: "extrato", ip: "203.0.113.7", after: { importadas: 2, repetidas: 0 } });
    });

    it("reimportar o mesmo extrato não duplica; período sobreposto traz só o que é novo", async () => {
      await importar(TRES);
      const deNovo = await importar(TRES);
      expect(deNovo.status).toBe(201);
      expect(deNovo.corpo).toMatchObject({ importadas: 0, repetidas: 2 });
      expect(await banco.default.bankStatementLine.count({ where: { bankId: "9999" } })).toBe(2);

      // O mesmo em OFX 2.x, com uma movimentação a mais.
      entrarComo("ADMIN");
      const res = await conciliacao.POST(arquivo(ofx2([...TRES, { fitId: "I4", data: "20131008", valor: "77.70", memo: memo("NOVA") }])));
      expect(await res.json()).toMatchObject({ importadas: 1, repetidas: 2 });
      expect(await banco.default.bankStatementLine.count({ where: { bankId: "9999" } })).toBe(3);

      // Linha já conciliada ou ignorada não volta a pendente ao reimportar.
      const tarifa = await linhaCom("TARIFA");
      expect((await agir(tarifa.id, { action: "ignorar" })).status).toBe(200);
      await importar(TRES);
      expect((await linhaCom("TARIFA")).status).toBe("IGNORED");
    });

    it("o mesmo identificador em outra conta é outra movimentação", async () => {
      await importar(TRES);
      const outraConta = await importar(TRES, { banco: "9998", conta: "0011223-3" });
      expect(outraConta.corpo).toMatchObject({ importadas: 2, repetidas: 0 });
      expect(await banco.default.bankStatementLine.count({ where: { bankId: { in: BANCOS } } })).toBe(4);
    });

    it("arquivo em Windows-1252 é lido com os acentos certos", async () => {
      entrarComo("ADMIN");
      const texto = ofx1([{ fitId: "W1", data: "20131009", valor: "12.34", memo: memo("LIQUIDAÇÃO DE COBRANÇA") }]);
      const res = await conciliacao.POST(arquivo(new Uint8Array(Buffer.from(texto, "latin1"))));
      expect(res.status).toBe(201);
      expect((await linhaCom("LIQUIDA")).description).toBe(memo("LIQUIDAÇÃO DE COBRANÇA"));
    });

    it("arquivo que não é OFX, vazio ou sem movimentação é 400; grande demais é 413; nada é gravado", async () => {
      entrarComo("ADMIN");
      const antes = await banco.default.bankStatementLine.count();
      for (const [conteudo, mensagem] of [
        ["data;valor\n05/10/2013;10,00", NAO_E_OFX],
        ["", OFX_VAZIO],
        [ofx1([]), OFX_SEM_MOVIMENTO],
        ["{}", NAO_E_OFX],
      ] as const) {
        const res = await conciliacao.POST(arquivo(conteudo));
        expect(res.status, mensagem).toBe(400);
        expect(((await res.json()) as Corpo).error).toBe(mensagem);
      }
      const grande = await conciliacao.POST(arquivo(`<OFX>${"x".repeat(TAMANHO_MAXIMO_DO_OFX)}</OFX>`));
      expect(grande.status).toBe(413);
      expect(((await grande.json()) as Corpo).error).toBe(OFX_GRANDE);
      expect(await banco.default.bankStatementLine.count()).toBe(antes);
    });
  });

  describe("lista e sugestão", () => {
    it("a pendente vem com o candidato e o motivo; valor único na janela é certeiro; a contagem separa as situações", async () => {
      const unico = await titulo({ amount: 7311.17, dueDate: "2013-10-12", nome: "único" });
      await titulo({ amount: 4122.09, dueDate: "2013-10-09", nome: "gêmeo um" });
      await titulo({ amount: 4122.09, dueDate: "2013-10-11", nome: "gêmeo dois" });
      await importar([
        { fitId: "S1", data: "20131010", valor: "7311.17", memo: memo("TED CERTEIRA") },
        { fitId: "S2", data: "20131010", valor: "4122.09", memo: memo("TED AMBIGUA") },
        { fitId: "S3", data: "20131010", valor: "-9876.54", memo: memo("SEM PAR") },
      ]);

      const { linhas, contagem, certeiros } = await listar();
      expect(linhas).toHaveLength(3);
      expect(contagem.pendentes).toBeGreaterThanOrEqual(3);
      expect(certeiros).toBeGreaterThanOrEqual(1);

      const certeira = linhas.find((l) => l.description.includes("CERTEIRA"))!;
      expect(certeira.certeiro).toBe(unico.id);
      expect(certeira.candidatos[0]).toMatchObject({ id: unico.id, forte: true, diferenca: 0, titulo: { id: unico.id, amount: 7311.17, status: "PENDING" } });
      expect(certeira.candidatos[0].motivos).toEqual(["valor igual", "vence a 2 dias"]);
      expect(certeira).toMatchObject({ status: "PENDING", account: "••••87-7", amount: 7311.17, postedAt: "2013-10-10T00:00:00.000Z" });

      const ambigua = linhas.find((l) => l.description.includes("AMBIGUA"))!;
      expect(ambigua.certeiro).toBeNull();
      expect(ambigua.candidatos).toHaveLength(2);

      const semPar = linhas.find((l) => l.description.includes("SEM PAR"))!;
      expect(semPar).toMatchObject({ certeiro: null, candidatos: [] });
      expect(JSON.stringify(linhas)).not.toContain("tenantId");
      expect(JSON.stringify(linhas)).not.toContain("accountKey");
    });
  });

  describe("conciliar e desfazer", () => {
    it("título em aberto de valor igual: recebe a baixa com a data do extrato e a forma inferida; desfazer reabre", async () => {
      const aberto = await titulo({ amount: 6205.33 });
      await importar([{ fitId: "C1", data: "20131008", valor: "6205.33", memo: memo("PIX RECEBIDO CLIENTE") }]);
      const linha = await linhaCom("PIX RECEBIDO CLIENTE");

      const { status, corpo } = await agir(linha.id, { action: "conciliar", transactionId: aberto.id }, "FINANCE");
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ id: linha.id, action: "conciliar", transactionId: aberto.id, baixou: true });

      const pago = await gravado(aberto.id);
      expect(pago).toMatchObject({ status: "PAID", paymentMethod: "PIX", amount: 6205.33, paidAmount: null, interest: null, fine: null, discount: null });
      expect(diaNoBrasil(pago.paidAt!)).toBe("2013-10-08");
      expect(await linhaCom("PIX RECEBIDO CLIENTE")).toMatchObject({ status: "RECONCILED", transactionId: aberto.id, settled: true });
      expect(await trilha(aberto.id)).toEqual(["lancamento.pagar"]);
      expect(await trilha(linha.id)).toEqual(["conciliacao.conciliar"]);

      // Sai das pendentes e aparece nas conciliadas, com o lançamento.
      expect((await listar()).linhas).toHaveLength(0);
      const conciliadas = (await listar("conciliadas")).linhas;
      expect(conciliadas).toHaveLength(1);
      expect(conciliadas[0]).toMatchObject({ status: "RECONCILED", settled: true, transaction: { id: aberto.id, status: "PAID" }, candidatos: [] });

      // Conciliado não é reaberto nem excluído pelo Financeiro.
      entrarComo("ADMIN");
      const reabrir = await lancamentoPorId.PATCH(req("PATCH", { action: "reabrir" }), ctx(aberto.id));
      expect(reabrir.status).toBe(409);
      expect(((await reabrir.json()) as Corpo).error).toMatch(/conciliado com o extrato/);
      entrarComo("ADMIN");
      expect((await lancamentoPorId.DELETE(req("DELETE"), ctx(aberto.id))).status).toBe(409);
      expect((await gravado(aberto.id)).status).toBe("PAID");

      const desfeito = await agir(linha.id, { action: "desfazer" });
      expect(desfeito.status).toBe(200);
      expect(desfeito.corpo).toMatchObject({ reabriu: true });
      expect(await gravado(aberto.id)).toMatchObject({ status: "PENDING", paidAt: null, paymentMethod: null, paidAmount: null });
      expect(await linhaCom("PIX RECEBIDO CLIENTE")).toMatchObject({ status: "PENDING", transactionId: null, settled: false, reconciledAt: null });
      expect(await trilha(aberto.id)).toEqual(["lancamento.pagar", "lancamento.reabrir"]);
      expect(await trilha(linha.id)).toEqual(["conciliacao.conciliar", "conciliacao.desfazer"]);

      // Depois de desfeito, o Financeiro volta a mandar no lançamento.
      entrarComo("ADMIN");
      expect((await lancamentoPorId.DELETE(req("DELETE"), ctx(aberto.id))).status).toBe(200);
    });

    it("valor recebido diferente em título a receber: a mais vira juros, a menos vira desconto, ou o que for informado e fechar", async () => {
      const comJuros = await titulo({ amount: 1000, nome: "juros" });
      const comDesconto = await titulo({ amount: 1000, nome: "desconto" });
      const informado = await titulo({ amount: 1000, nome: "informado" });
      await importar([
        { fitId: "J1", data: "20131015", valor: "1012.50", memo: memo("TED A MAIS") },
        { fitId: "J2", data: "20131015", valor: "990.00", memo: memo("TED A MENOS") },
        { fitId: "J3", data: "20131015", valor: "1030.00", memo: memo("TED INFORMADA") },
      ]);

      expect((await agir((await linhaCom("A MAIS")).id, { action: "conciliar", transactionId: comJuros.id })).status).toBe(200);
      expect(await gravado(comJuros.id)).toMatchObject({ status: "PAID", amount: 1000, interest: 12.5, fine: 0, discount: 0, paidAmount: 1012.5, paymentMethod: "TRANSFERENCIA" });

      expect((await agir((await linhaCom("A MENOS")).id, { action: "conciliar", transactionId: comDesconto.id })).status).toBe(200);
      expect(await gravado(comDesconto.id)).toMatchObject({ status: "PAID", interest: 0, fine: 0, discount: 10, paidAmount: 990 });

      const linha = await linhaCom("INFORMADA");
      const naoFecha = await agir(linha.id, { action: "conciliar", transactionId: informado.id, juros: "10", multa: "5" });
      expect(naoFecha.status).toBe(400);
      expect(naoFecha.corpo.error).toBe(ENCARGOS_NAO_FECHAM);
      expect((await gravado(informado.id)).status).toBe("PENDING");
      expect((await agir(linha.id, { action: "conciliar", transactionId: informado.id, juros: "10", multa: "20" })).status).toBe(200);
      expect(await gravado(informado.id)).toMatchObject({ interest: 10, fine: 20, discount: 0, paidAmount: 1030 });
    });

    it("despesa: valor igual paga pelo valor; valor diferente é recusado; sinal trocado também", async () => {
      const despesa = await titulo({ amount: 350.4, type: "EXPENSE", nome: "despesa" });
      const receita = await titulo({ amount: 350.4, nome: "receita" });
      await importar([
        { fitId: "D1", data: "20131011", valor: "-350.40", memo: memo("PAGAMENTO DE BOLETO") },
        { fitId: "D2", data: "20131011", valor: "-353.00", memo: memo("BOLETO COM MORA") },
      ]);
      const igual = await linhaCom("PAGAMENTO DE BOLETO");
      const diferente = await linhaCom("COM MORA");

      const trocado = await agir(igual.id, { action: "conciliar", transactionId: receita.id });
      expect(trocado.status).toBe(400);
      expect(trocado.corpo.error).toMatch(/débito com lançamento a pagar/);

      const recusada = await agir(diferente.id, { action: "conciliar", transactionId: despesa.id });
      expect(recusada.status).toBe(400);
      expect(recusada.corpo.error).toBe(VALOR_DIFERENTE_A_PAGAR);
      expect((await gravado(despesa.id)).status).toBe("PENDING");
      expect((await linhaCom("COM MORA")).status).toBe("PENDING");

      expect((await agir(igual.id, { action: "conciliar", transactionId: despesa.id })).status).toBe(200);
      expect(await gravado(despesa.id)).toMatchObject({ status: "PAID", paymentMethod: "BOLETO", paidAmount: null });
    });

    it("lançamento já pago: só liga; desfazer só desliga e ele continua pago", async () => {
      const pagoEm = new Date("2013-10-09T14:00:00.000Z");
      const jaPago = await titulo({ amount: 815.25, status: "PAID", paidAt: pagoEm, nome: "já pago" });
      await importar([{ fitId: "G1", data: "20131010", valor: "815.25", memo: memo("DEPOSITO") }]);
      const linha = await linhaCom("DEPOSITO");

      // Aparece como candidato pelo dia do pagamento.
      expect((await listar()).linhas[0]).toMatchObject({ certeiro: jaPago.id, candidatos: [{ id: jaPago.id, motivos: ["valor igual", "pago a 1 dia"] }] });

      const comEncargo = await agir(linha.id, { action: "conciliar", transactionId: jaPago.id, juros: "1" });
      expect(comEncargo.status).toBe(400);

      expect((await agir(linha.id, { action: "conciliar", transactionId: jaPago.id })).corpo).toMatchObject({ baixou: false });
      expect(await gravado(jaPago.id)).toMatchObject({ status: "PAID", paidAt: pagoEm, paymentMethod: null });
      expect(await linhaCom("DEPOSITO")).toMatchObject({ status: "RECONCILED", settled: false });
      expect(await trilha(jaPago.id)).toEqual([]);

      expect((await agir(linha.id, { action: "desfazer" })).corpo).toMatchObject({ reabriu: false });
      expect(await gravado(jaPago.id)).toMatchObject({ status: "PAID", paidAt: pagoEm });
      expect((await linhaCom("DEPOSITO")).status).toBe("PENDING");
    });

    it("uma linha concilia uma vez e um lançamento casa com uma linha só", async () => {
      const a = await titulo({ amount: 222.22, nome: "a" });
      const b = await titulo({ amount: 222.22, nome: "b" });
      await importar([
        { fitId: "U1", data: "20131010", valor: "222.22", memo: memo("PRIMEIRA") },
        { fitId: "U2", data: "20131010", valor: "222.22", memo: memo("SEGUNDA") },
      ]);
      const primeira = await linhaCom("PRIMEIRA");
      const segunda = await linhaCom("SEGUNDA");

      expect((await agir(primeira.id, { action: "conciliar", transactionId: a.id })).status).toBe(200);
      const repetida = await agir(primeira.id, { action: "conciliar", transactionId: b.id });
      expect(repetida.status).toBe(409);
      expect(repetida.corpo.error).toMatch(/já foi conciliada ou ignorada/);
      const mesmoTitulo = await agir(segunda.id, { action: "conciliar", transactionId: a.id });
      expect(mesmoTitulo.status).toBe(409);
      expect(mesmoTitulo.corpo.error).toMatch(/já está conciliado com outra linha/);
      expect((await gravado(b.id)).status).toBe("PENDING");

      // O lançamento conciliado some dos candidatos da outra linha.
      const pendentes = (await listar()).linhas;
      expect(pendentes).toHaveLength(1);
      expect(pendentes[0].candidatos.map((c) => c.id)).toEqual([b.id]);

      expect((await agir(primeira.id, { action: "ignorar" })).status).toBe(409);
      expect((await agir(segunda.id, { action: "desfazer" })).status).toBe(409);
      expect((await agir(segunda.id, { action: "conciliar", transactionId: SEM_ID })).status).toBe(404);
      expect((await agir(SEM_ID, { action: "ignorar" })).status).toBe(404);
      expect((await agir(segunda.id, { action: "apagar" })).status).toBe(400);
      expect((await agir(segunda.id, { action: "conciliar" })).status).toBe(400);
    });
  });

  describe("criar lançamento e ignorar", () => {
    it("criar: nasce pago no dia do extrato, pelo valor e com a categoria, já conciliado; desfazer só desliga", async () => {
      await importar([{ fitId: "T1", data: "20131006", valor: "-45,90", memo: memo("TARIFA PACOTE") }]);
      const linha = await linhaCom("TARIFA PACOTE");

      const { status, corpo } = await agir(linha.id, { action: "criar", category: "Tarifa bancária", counterparty: "Banco de Teste" }, "FINANCE");
      expect(status).toBe(200);
      const criado = await gravado(corpo.transactionId as string);
      expect(criado).toMatchObject({
        type: "EXPENSE",
        amount: 45.9,
        description: memo("TARIFA PACOTE"),
        status: "PAID",
        category: "Tarifa bancária",
        counterparty: "Banco de Teste",
        dueDate: null,
        paymentMethod: null,
        invoiceId: null,
      });
      expect(diaNoBrasil(criado.paidAt!)).toBe("2013-10-06");
      expect(await linhaCom("TARIFA PACOTE")).toMatchObject({ status: "RECONCILED", transactionId: criado.id, settled: false });
      expect(await trilha(criado.id)).toEqual(["lancamento.criar"]);
      expect(await trilha(linha.id)).toEqual(["conciliacao.criar"]);

      expect((await agir(linha.id, { action: "criar" })).status).toBe(409);

      expect((await agir(linha.id, { action: "desfazer" })).corpo).toMatchObject({ reabriu: false });
      expect((await gravado(criado.id)).status).toBe("PAID");
      // Pendente de novo, o lançamento criado é o candidato certeiro: não se cria outro.
      expect((await listar()).linhas[0]).toMatchObject({ certeiro: criado.id });
    });

    it("criar com descrição própria e crédito vira receita; cliente que não existe é 400", async () => {
      await importar([{ fitId: "R1", data: "20131012", valor: "18.77", memo: memo("REND APLIC") }]);
      const linha = await linhaCom("REND APLIC");
      expect((await agir(linha.id, { action: "criar", clientId: SEM_ID })).status).toBe(400);
      const { corpo } = await agir(linha.id, { action: "criar", description: `${PREFIXO}rendimento`, category: "Rendimento", clientId: clienteId });
      expect(await gravado(corpo.transactionId as string)).toMatchObject({ type: "INCOME", amount: 18.77, description: `${PREFIXO}rendimento`, clientId: clienteId, status: "PAID" });
    });

    it("ignorar tira da fila sem lançamento; desfazer devolve", async () => {
      await importar([{ fitId: "N1", data: "20131012", valor: "-500.00", memo: memo("TRANSF MESMA TITULARIDADE") }]);
      const linha = await linhaCom("MESMA TITULARIDADE");
      const lancamentos = await banco.default.financialTransaction.count();

      expect((await agir(linha.id, { action: "ignorar" })).status).toBe(200);
      expect(await linhaCom("MESMA TITULARIDADE")).toMatchObject({ status: "IGNORED", transactionId: null });
      expect((await listar()).linhas).toHaveLength(0);
      const ignoradas = (await listar("ignoradas")).linhas;
      expect(ignoradas).toHaveLength(1);
      expect(ignoradas[0]).toMatchObject({ status: "IGNORED", transaction: null, candidatos: [] });
      expect((await agir(linha.id, { action: "ignorar" })).status).toBe(409);

      expect((await agir(linha.id, { action: "desfazer" })).status).toBe(200);
      expect((await linhaCom("MESMA TITULARIDADE")).status).toBe("PENDING");
      expect(await banco.default.financialTransaction.count()).toBe(lancamentos);
      expect(await trilha(linha.id)).toEqual(["conciliacao.ignorar", "conciliacao.desfazer"]);
    });
  });

  describe("fatura", () => {
    it("conciliar com o lançamento de uma fatura paga a FATURA (e o lançamento junto), pelo txid do Pix; desfazer reabre a fatura", async () => {
      const { fatura, lancamento } = await emitirFatura(2468.13);
      const txid = `FAT${String(fatura.number).padStart(6, "0")}`;
      await importar([{ fitId: "F1", data: "20131018", valor: "2468.13", memo: memo(`PIX RECEBIDO ${txid} AURORA`) }]);
      const linha = await linhaCom(txid);

      const sugerida = (await listar()).linhas[0];
      expect(sugerida.certeiro).toBe(lancamento.id);
      expect(sugerida.candidatos[0].motivos).toEqual(expect.arrayContaining(["valor igual", `txid do Pix (${txid})`]));
      expect(sugerida.candidatos[0].titulo.invoice).toMatchObject({ number: fatura.number });

      expect((await agir(linha.id, { action: "conciliar", transactionId: lancamento.id })).status).toBe(200);
      const paga = await banco.default.invoice.findUniqueOrThrow({ where: { id: fatura.id } });
      expect(paga.status).toBe("PAID");
      expect(diaNoBrasil(paga.paidAt!)).toBe("2013-10-18");
      const pago = await gravado(lancamento.id);
      expect(pago).toMatchObject({ status: "PAID", paymentMethod: "PIX", paidAmount: null });
      expect(pago.paidAt).toEqual(paga.paidAt);
      expect(await trilha(fatura.id)).toEqual(["fatura.emitir", "fatura.pagar"]);

      // Fatura conciliada não é reaberta pelo Faturamento: é pela conciliação.
      entrarComo("ADMIN");
      const reabrir = await faturaPorId.PATCH(req("PATCH", { action: "reabrir" }), ctx(fatura.id));
      expect(reabrir.status).toBe(409);
      expect(((await reabrir.json()) as Corpo).error).toMatch(/conciliado com o extrato/);

      expect((await agir(linha.id, { action: "desfazer" })).corpo).toMatchObject({ reabriu: true });
      expect(await banco.default.invoice.findUniqueOrThrow({ where: { id: fatura.id } })).toMatchObject({ status: "OPEN", paidAt: null });
      expect(await gravado(lancamento.id)).toMatchObject({ status: "PENDING", paidAt: null, paymentMethod: null });
      expect(await trilha(fatura.id)).toEqual(["fatura.emitir", "fatura.pagar", "fatura.reabrir"]);

      // Solta, a fatura volta a ser do Faturamento: paga e reabre por lá, como sempre.
      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "pagar" }), ctx(fatura.id))).status).toBe(200);
      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "reabrir" }), ctx(fatura.id))).status).toBe(200);
    });

    it("fatura recebida com juros: o total da fatura não muda e o valor recebido vai para o lançamento", async () => {
      const { fatura, lancamento } = await emitirFatura(1000);
      const txid = `FAT${String(fatura.number).padStart(6, "0")}`;
      await importar([{ fitId: "F2", data: "20131025", valor: "1023.00", memo: memo(`PIX ${txid}`) }]);

      // Valor diferente: aparece pela identificação, mas não é certeiro.
      const sugerida = (await listar()).linhas[0];
      expect(sugerida).toMatchObject({ certeiro: null, candidatos: [{ id: lancamento.id, forte: false, diferenca: 23 }] });

      expect((await agir((await linhaCom(txid)).id, { action: "conciliar", transactionId: lancamento.id })).status).toBe(200);
      expect(await banco.default.invoice.findUniqueOrThrow({ where: { id: fatura.id } })).toMatchObject({ status: "PAID", total: 1000 });
      expect(await gravado(lancamento.id)).toMatchObject({ status: "PAID", amount: 1000, interest: 23, fine: 0, discount: 0, paidAmount: 1023 });
    });
  });

  describe("conciliar os certeiros", () => {
    it("concilia de uma vez só as linhas com um único candidato forte; a ambígua e a sem par ficam", async () => {
      const um = await titulo({ amount: 3301.01, nome: "lote um" });
      const dois = await titulo({ amount: 3302.02, type: "EXPENSE", nome: "lote dois" });
      const gemeoA = await titulo({ amount: 3303.03, nome: "lote gêmeo a" });
      const gemeoB = await titulo({ amount: 3303.03, nome: "lote gêmeo b" });
      await importar([
        { fitId: "B1", data: "20131010", valor: "3301.01", memo: memo("LOTE UM PIX") },
        { fitId: "B2", data: "20131011", valor: "-3302.02", memo: memo("LOTE DOIS TED") },
        { fitId: "B3", data: "20131010", valor: "3303.03", memo: memo("LOTE AMBIGUA") },
        { fitId: "B4", data: "20131010", valor: "3304.04", memo: memo("LOTE SEM PAR") },
      ]);

      entrarComo("FINANCE");
      const res = await certeirosRota.POST(req("POST"));
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as { conciliadas: number; falhas: unknown[] };
      expect(corpo.falhas).toEqual([]);
      expect(corpo.conciliadas).toBeGreaterThanOrEqual(2);

      expect(await gravado(um.id)).toMatchObject({ status: "PAID", paymentMethod: "PIX" });
      expect(await gravado(dois.id)).toMatchObject({ status: "PAID", paymentMethod: "TRANSFERENCIA" });
      expect((await gravado(gemeoA.id)).status).toBe("PENDING");
      expect((await gravado(gemeoB.id)).status).toBe("PENDING");
      expect((await linhaCom("LOTE UM")).status).toBe("RECONCILED");
      expect((await linhaCom("LOTE DOIS")).status).toBe("RECONCILED");
      expect((await linhaCom("LOTE AMBIGUA")).status).toBe("PENDING");
      expect((await linhaCom("LOTE SEM PAR")).status).toBe("PENDING");
      expect(await trilha((await linhaCom("LOTE UM")).id)).toEqual(["conciliacao.conciliar"]);

      // De novo: não há mais certeiro desta suite, e nada muda.
      entrarComo("FINANCE");
      await certeirosRota.POST(req("POST"));
      expect((await linhaCom("LOTE AMBIGUA")).status).toBe("PENDING");
      expect((await gravado(gemeoA.id)).status).toBe("PENDING");
    });
  });

  describe("isolamento entre empresas", () => {
    it("linha e lançamento de outra empresa não aparecem nem são alcançados; o mesmo extrato entra nas duas sem colidir", async () => {
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id);
      const movimentos: Movimento[] = [{ fitId: "X1", data: "20131010", valor: "5150.15", memo: memo("DAS DUAS EMPRESAS") }];
      const { chaveDaConta } = await import("../src/lib/conciliacao-db");

      // A outra empresa tem o mesmo extrato (mesma conta, mesmo identificador) e um título de mesmo valor.
      const linhaDaOutra = await outra.db.bankStatementLine.create({
        data: { accountKey: chaveDaConta({ banco: "9999", agencia: "0001", numero: "0099887-7" }), bankId: "9999", account: "••••87-7", fitId: "X1", postedAt: dia("2013-10-10"), amount: 5150.15, description: memo("DAS DUAS EMPRESAS") },
      });
      const tituloDaOutra = await outra.db.financialTransaction.create({ data: { type: "INCOME", amount: 5150.15, description: `${PREFIXO}da outra`, dueDate: dia("2013-10-10") } });

      expect((await importar(movimentos)).corpo).toMatchObject({ importadas: 1, repetidas: 0 });
      const minha = await linhaCom("DAS DUAS EMPRESAS");
      expect(minha.id).not.toBe(linhaDaOutra.id);

      // A lista só tem a minha linha, e o título da outra empresa não é candidato.
      const { linhas } = await listar();
      expect(linhas.map((l) => l.id)).toEqual([minha.id]);
      expect(linhas[0].candidatos).toEqual([]);

      // A linha da outra é 404; o título da outra é 404.
      expect((await agir(linhaDaOutra.id, { action: "ignorar" })).status).toBe(404);
      expect((await agir(linhaDaOutra.id, { action: "desfazer" })).status).toBe(404);
      const cruzado = await agir(minha.id, { action: "conciliar", transactionId: tituloDaOutra.id });
      expect(cruzado.status).toBe(404);

      // O lote desta empresa não toca na outra.
      entrarComo("ADMIN");
      await certeirosRota.POST(req("POST"));
      expect(await outra.db.bankStatementLine.findUniqueOrThrow({ where: { id: linhaDaOutra.id } })).toMatchObject({ status: "PENDING", transactionId: null });
      expect((await outra.db.financialTransaction.findUniqueOrThrow({ where: { id: tituloDaOutra.id } })).status).toBe("PENDING");

      // E o banco recusa ligar a linha a lançamento de outra empresa, mesmo por fora das rotas.
      await expect(banco.default.bankStatementLine.update({ where: { id: minha.id }, data: { transactionId: tituloDaOutra.id } })).rejects.toThrow();
    });
  });
});

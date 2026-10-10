import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import { createManifestSchema } from "../src/lib/manifestos";
import { custoRateado, dreDoPeriodo, margemPorCliente, montarResultado, type Resultado } from "../src/lib/relatorios";
import {
  EXPENSE_TYPES,
  EXPENSE_TYPE_LABEL,
  MAX_PARADAS_NO_LINK,
  RETURN_BEFORE_DEPARTURE,
  RETURN_BEFORE_DEPARTURE_KM,
  abastecidoNaViagem,
  acertoDaViagem,
  centroDeCustoDaViagem,
  codigoDaViagem,
  createTripExpenseSchema,
  descricaoDoLancamento,
  finalizadaEm,
  finalizadaNoPeriodo,
  geraAbastecimento,
  incoerenciaDaViagem,
  janelaDaViagem,
  kmRodados,
  linkDaRota,
  moverParada,
  ordemCompleta,
  ordenarParadas,
  orderSchema,
  paraCampoDeDataHora,
  totalLancado,
  tripExpenseActionSchema,
  updateTripDataSchema,
  type AcertoDaViagem,
} from "../src/lib/viagem";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const dia = (data: string) => new Date(`${data}T00:00:00.000Z`);

/** As regras da viagem, sem banco: linhas na mão, dia de referência na mão. */
describe("regras da viagem", () => {
  describe("rota no mapa", () => {
    const parametros = (url: string | null) => new URL(url ?? "").searchParams;

    it("sem parada com endereço não há link", () => {
      expect(linkDaRota([])).toEqual({ url: null, incluidas: 0, deFora: 0 });
      expect(linkDaRota(["", "   "])).toEqual({ url: null, incluidas: 0, deFora: 0 });
    });

    it("uma parada é o destino; com mais, a última é o destino e as anteriores vão em ordem", () => {
      const uma = linkDaRota(["Mirassol - SP"]);
      expect(uma.url).toBe("https://www.google.com/maps/dir/?api=1&destination=Mirassol%20-%20SP&travelmode=driving");
      expect(uma).toMatchObject({ incluidas: 1, deFora: 0 });

      const tres = linkDaRota(["Mirassol - SP", "Bady Bassitt - SP", "Votuporanga - SP"]);
      expect(tres.url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
      expect(parametros(tres.url).get("destination")).toBe("Votuporanga - SP");
      expect(parametros(tres.url).get("waypoints")).toBe("Mirassol - SP|Bady Bassitt - SP");
      expect(parametros(tres.url).get("travelmode")).toBe("driving");
      // A origem não vai: o mapa parte de onde o aparelho está.
      expect(parametros(tres.url).has("origin")).toBe(false);
    });

    it("codifica acento, vírgula, &, #, barra e a barra vertical entre as paradas", () => {
      const { url } = linkDaRota(["Av. São João, 100 & Cia #2 / fundos", "São José do Rio Preto - SP"]);
      expect(url).toContain("destination=S%C3%A3o%20Jos%C3%A9%20do%20Rio%20Preto%20-%20SP");
      expect(url).toContain("waypoints=Av.%20S%C3%A3o%20Jo%C3%A3o%2C%20100%20%26%20Cia%20%232%20%2F%20fundos");
      // Nada do endereço escapa cru para a consulta.
      expect(url?.split("?")[1]).not.toMatch(/[ #|]|São/);
      expect(parametros(url).get("waypoints")).toBe("Av. São João, 100 & Cia #2 / fundos");

      expect(linkDaRota(["A", "B", "C"]).url).toContain("waypoints=A%7CB");
    });

    it("ignora endereço em branco, apara espaços e junta paradas seguidas no mesmo endereço", () => {
      const { url, incluidas } = linkDaRota(["  Mirassol   - SP ", "", "mirassol - sp", "Tanabi", "Mirassol - SP"]);
      expect(incluidas).toBe(3);
      expect(parametros(url).get("waypoints")).toBe("Mirassol - SP|Tanabi");
      expect(parametros(url).get("destination")).toBe("Mirassol - SP");
    });

    it("passando do limite do link entram as primeiras paradas, e o que ficou de fora é contado", () => {
      const paradas = Array.from({ length: 13 }, (_, i) => `Cidade ${i + 1}`);
      const { url, incluidas, deFora } = linkDaRota(paradas);
      expect(MAX_PARADAS_NO_LINK).toBe(10);
      expect(incluidas).toBe(10);
      expect(deFora).toBe(3);
      expect(parametros(url).get("destination")).toBe("Cidade 10");
      expect(parametros(url).get("waypoints")?.split("|")).toEqual(paradas.slice(0, 9));

      expect(linkDaRota(paradas.slice(0, 10))).toMatchObject({ incluidas: 10, deFora: 0 });
    });
  });

  describe("ordem das entregas", () => {
    it("vale a sequência; carga sem sequência vai para o fim, pela data de criação", () => {
      const cargas = [
        { id: "sem-2", manifestSequence: null, createdAt: "2026-03-02T10:00:00Z" },
        { id: "terceira", manifestSequence: 3, createdAt: "2026-03-01T10:00:00Z" },
        { id: "sem-1", manifestSequence: null, createdAt: "2026-03-01T10:00:00Z" },
        { id: "primeira", manifestSequence: 1, createdAt: "2026-03-05T10:00:00Z" },
      ];
      expect(ordenarParadas(cargas).map((c) => c.id)).toEqual(["primeira", "terceira", "sem-1", "sem-2"]);
      // Não mexe na lista recebida.
      expect(cargas[0].id).toBe("sem-2");
      // Empate fica na ordem em que veio.
      expect(ordenarParadas([{ id: "a", manifestSequence: null }, { id: "b", manifestSequence: null }]).map((c) => c.id)).toEqual(["a", "b"]);
    });

    it("subir e descer trocam com a vizinha; na ponta e com id desconhecido nada muda", () => {
      const ids = ["a", "b", "c"];
      expect(moverParada(ids, "b", "subir")).toEqual(["b", "a", "c"]);
      expect(moverParada(ids, "b", "descer")).toEqual(["a", "c", "b"]);
      expect(moverParada(ids, "a", "subir")).toEqual(ids);
      expect(moverParada(ids, "c", "descer")).toEqual(ids);
      expect(moverParada(ids, "x", "subir")).toEqual(ids);
      expect(ids).toEqual(["a", "b", "c"]);
    });

    it("a ordem pedida precisa ter exatamente as cargas da viagem", () => {
      expect(ordemCompleta(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
      expect(ordemCompleta(["a", "b", "c"], ["a", "b"])).toBe(false);
      expect(ordemCompleta(["a", "b"], ["a", "x"])).toBe(false);
      expect(ordemCompleta(["a", "b"], ["a", "a"])).toBe(false);
      expect(orderSchema.safeParse({ collectionIds: ["a", "a"] }).success).toBe(false);
      expect(orderSchema.safeParse({ collectionIds: [] }).success).toBe(false);
      expect(orderSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("tempo e km da viagem", () => {
    it("km rodados é o retorno menos a saída; sem os dois, ou invertido, não há medida", () => {
      expect(kmRodados(1000, 1350)).toBe(350);
      expect(kmRodados(1000, 1000)).toBe(0);
      expect(kmRodados(null, 1350)).toBeNull();
      expect(kmRodados(1000, undefined)).toBeNull();
      expect(kmRodados(1350, 1000)).toBeNull();
    });

    it("a finalização é a data própria; viagem anterior a ela vale pela última alteração", () => {
      const base = { createdAt: "2026-03-01T12:00:00Z", updatedAt: "2026-03-09T12:00:00Z" };
      expect(finalizadaEm({ ...base, status: "FINISHED", finishedAt: "2026-03-05T12:00:00Z" })).toEqual(new Date("2026-03-05T12:00:00Z"));
      expect(finalizadaEm({ ...base, status: "FINISHED", finishedAt: null })).toEqual(new Date("2026-03-09T12:00:00Z"));
      expect(finalizadaEm({ ...base, status: "FINISHED" })).toEqual(new Date("2026-03-09T12:00:00Z"));
      expect(finalizadaEm({ ...base, status: "ROUTE", finishedAt: null })).toBeNull();

      const noPeriodo = { gte: new Date("2026-03-01T03:00:00Z"), lt: new Date("2026-04-01T03:00:00Z") };
      expect(finalizadaNoPeriodo(noPeriodo)).toEqual({
        status: "FINISHED",
        OR: [{ finishedAt: noPeriodo }, { finishedAt: null, updatedAt: noPeriodo }],
      });
    });

    it("a janela vai do dia da saída ao da finalização, no relógio do Brasil; em rota vai até hoje", () => {
      const hoje = new Date("2026-03-20T15:00:00Z");
      // 01:30 UTC do dia 3 ainda é dia 2 no Brasil.
      const finalizada = { status: "FINISHED", createdAt: "2026-03-01T12:00:00Z", updatedAt: "2026-03-10T12:00:00Z", departedAt: "2026-03-03T01:30:00Z", finishedAt: "2026-03-05T12:00:00Z" };
      expect(janelaDaViagem(finalizada, hoje)).toEqual({ inicio: "2026-03-02", fim: "2026-03-05" });
      // Sem a data da saída vale a da criação; sem a da finalização, a da última alteração.
      expect(janelaDaViagem({ ...finalizada, departedAt: null, finishedAt: null }, hoje)).toEqual({ inicio: "2026-03-01", fim: "2026-03-10" });
      expect(janelaDaViagem({ ...finalizada, status: "ROUTE", finishedAt: null }, hoje)).toEqual({ inicio: "2026-03-02", fim: "2026-03-20" });

      const janela = { inicio: "2026-03-02", fim: "2026-03-05" };
      expect(abastecidoNaViagem({ date: dia("2026-03-02") }, janela)).toBe(true);
      expect(abastecidoNaViagem({ date: dia("2026-03-05") }, janela)).toBe(true);
      expect(abastecidoNaViagem({ date: dia("2026-03-01") }, janela)).toBe(false);
      expect(abastecidoNaViagem({ date: dia("2026-03-06") }, janela)).toBe(false);
    });

    it("o campo de data e hora mostra o instante no relógio do Brasil", () => {
      expect(paraCampoDeDataHora("2026-03-03T01:30:00.000Z")).toBe("2026-03-02T22:30");
      expect(paraCampoDeDataHora(new Date("2026-03-02T11:05:00.000Z"))).toBe("2026-03-02T08:05");
      expect(paraCampoDeDataHora(null)).toBe("");
      expect(paraCampoDeDataHora("lixo")).toBe("");
    });
  });

  describe("despesas", () => {
    it("cada tipo tem rótulo, e o lançamento leva a viagem na descrição e no centro de custo", () => {
      for (const tipo of EXPENSE_TYPES) expect(EXPENSE_TYPE_LABEL[tipo]).toBeTruthy();
      expect(codigoDaViagem("abcdef12-3456")).toBe("ABCDEF");
      expect(descricaoDoLancamento("TOLL", "abcdef12-3456")).toBe("Pedágio: viagem #ABCDEF");
      expect(centroDeCustoDaViagem("abcdef12-3456")).toBe("Viagem #ABCDEF");
    });

    it("só combustível com litros e hodômetro gera abastecimento na frota", () => {
      expect(geraAbastecimento({ type: "FUEL", liters: 50, odometer: 1000 })).toBe(true);
      expect(geraAbastecimento({ type: "FUEL", liters: 50, odometer: 0 })).toBe(true);
      expect(geraAbastecimento({ type: "FUEL", liters: 50, odometer: null })).toBe(false);
      expect(geraAbastecimento({ type: "FUEL", liters: null, odometer: 1000 })).toBe(false);
      expect(geraAbastecimento({ type: "TOLL", liters: 50, odometer: 1000 })).toBe(false);
    });

    it("o total lançado deixa a recusada de fora", () => {
      expect(
        totalLancado([
          { amount: 10.1, status: "PENDING" },
          { amount: 20.2, status: "APPROVED" },
          { amount: 99, status: "REJECTED" },
        ]),
      ).toBe(30.3);
      expect(totalLancado([])).toBe(0);
    });

    it("a despesa aceita número com vírgula, exige valor e data, e só o combustível guarda litros e hodômetro", () => {
      const combustivel = createTripExpenseSchema.parse({ type: "FUEL", amount: "350,90", date: "2026-03-10", notes: " Posto Rio ", liters: "60,5", odometer: "120000" });
      expect(combustivel).toMatchObject({ type: "FUEL", amount: 350.9, notes: "Posto Rio", liters: 60.5, odometer: 120000 });
      expect(combustivel.date).toEqual(dia("2026-03-10"));

      const pedagio = createTripExpenseSchema.parse({ type: "TOLL", amount: 12.5, date: "2026-03-10", notes: "", liters: "60", odometer: "120000" });
      expect(pedagio).toMatchObject({ notes: null, liters: null, odometer: null });

      const recusa = (corpo: unknown) => createTripExpenseSchema.safeParse(corpo).error?.issues[0]?.message;
      expect(recusa({ type: "MULTA", amount: "10", date: "2026-03-10" })).toBe("Tipo de despesa inválido.");
      expect(recusa({ type: "TOLL", amount: "0", date: "2026-03-10" })).toMatch(/maior que zero/);
      expect(recusa({ type: "TOLL", amount: "abc", date: "2026-03-10" })).toMatch(/maior que zero/);
      expect(recusa({ type: "TOLL", amount: "10" })).toBe("Informe a data da despesa.");
      expect(recusa({ type: "FUEL", amount: "10", date: "2026-03-10", liters: "0" })).toMatch(/litros/i);
      expect(recusa({ type: "FUEL", amount: "10", date: "2026-03-10", odometer: "12,5" })).toMatch(/hodômetro/i);
      expect(recusa(null)).toBe("Dados inválidos.");
    });

    it("o administrador aprova (a pagar ou já paga) ou recusa", () => {
      expect(tripExpenseActionSchema.parse({ action: "aprovar" })).toEqual({ action: "aprovar" });
      expect(tripExpenseActionSchema.parse({ action: "aprovar", paid: true, paymentMethod: "PIX" })).toEqual({ action: "aprovar", paid: true, paymentMethod: "PIX" });
      expect(tripExpenseActionSchema.parse({ action: "recusar" })).toEqual({ action: "recusar" });
      expect(tripExpenseActionSchema.safeParse({ action: "pagar" }).success).toBe(false);
      expect(tripExpenseActionSchema.safeParse({ action: "aprovar", paymentMethod: "CHEQUE" }).success).toBe(false);
    });
  });

  describe("dados da viagem", () => {
    it("campo em branco apaga, campo ausente não mexe, e a hora sem fuso é a do Brasil", () => {
      const dados = updateTripDataSchema.parse({ helperId: "", departureOdometer: "1000", returnOdometer: "", plannedDepartureAt: "2026-03-10T08:00", notes: "  levar paleteira " });
      expect(dados).toEqual({
        helperId: null,
        departureOdometer: 1000,
        returnOdometer: null,
        plannedDepartureAt: new Date("2026-03-10T11:00:00.000Z"),
        notes: "levar paleteira",
      });
      expect("plannedReturnAt" in dados).toBe(false);
      expect(updateTripDataSchema.parse({ plannedReturnAt: "2026-03-10T11:00:00.000Z" }).plannedReturnAt).toEqual(new Date("2026-03-10T11:00:00.000Z"));
      expect(updateTripDataSchema.parse({ plannedReturnAt: "" }).plannedReturnAt).toBeNull();
    });

    it("recusa corpo vazio, km que não é inteiro e data que não é data", () => {
      const recusa = (corpo: unknown) => updateTripDataSchema.safeParse(corpo).error?.issues[0]?.message;
      expect(recusa({})).toBe("Informe ao menos um campo para alterar.");
      expect(recusa({ departureOdometer: "12,5" })).toMatch(/hodômetro/i);
      expect(recusa({ returnOdometer: "-1" })).toMatch(/hodômetro/i);
      expect(recusa({ plannedDepartureAt: "amanhã" })).toBe("Previsão de saída inválida.");
      expect(recusa({ notes: "x".repeat(1001) })).toBe("Observação muito longa.");
    });

    it("retorno antes da saída é incoerência, no hodômetro e na previsão", () => {
      const coerente = { departureOdometer: 1000, returnOdometer: 1200, plannedDepartureAt: new Date("2026-03-10T11:00:00Z"), plannedReturnAt: new Date("2026-03-11T11:00:00Z") };
      expect(incoerenciaDaViagem(coerente)).toBeNull();
      expect(incoerenciaDaViagem({ ...coerente, returnOdometer: 999 })).toBe(RETURN_BEFORE_DEPARTURE_KM);
      expect(incoerenciaDaViagem({ ...coerente, plannedReturnAt: new Date("2026-03-09T11:00:00Z") })).toBe(RETURN_BEFORE_DEPARTURE);
      expect(incoerenciaDaViagem({ departureOdometer: null, returnOdometer: 5, plannedDepartureAt: null, plannedReturnAt: null })).toBeNull();
    });

    it("a montagem da viagem aceita os mesmos dados, todos opcionais", () => {
      const minimo = createManifestSchema.parse({ driverId: "m", vehicleId: "v", collectionIds: ["c"] });
      expect(minimo).toEqual({ driverId: "m", vehicleId: "v", collectionIds: ["c"] });
      const completo = createManifestSchema.parse({ driverId: "m", vehicleId: "v", collectionIds: ["c"], helperId: "h", departureOdometer: "500", notes: "obs" });
      expect(completo).toMatchObject({ helperId: "h", departureOdometer: 500, notes: "obs" });
    });
  });

  describe("acerto da viagem", () => {
    const VAZIO = { cargas: [], despesas: [], abastecimentos: [], adiantamentos: [] };

    it("sem nada, tudo zerado e sem margem nem km", () => {
      expect(acertoDaViagem(VAZIO)).toEqual<AcertoDaViagem>({
        cargas: 0,
        cargasACotar: 0,
        frete: 0,
        despesas: 0,
        despesasPorTipo: [],
        pendentes: { quantidade: 0, total: 0 },
        combustivel: 0,
        custoTotal: 0,
        resultado: 0,
        margem: null,
        km: null,
        custoPorKm: null,
        adiantado: 0,
      });
    });

    it("resultado = frete − despesas aprovadas − combustível, com margem, km e custo por km", () => {
      const acerto = acertoDaViagem({
        cargas: [{ freightValue: 1000 }, { freightValue: 500.5 }, { freightValue: null }],
        despesas: [
          { type: "TOLL", amount: 80.1, status: "APPROVED" },
          { type: "TOLL", amount: 19.9, status: "APPROVED" },
          { type: "FOOD", amount: 60, status: "APPROVED" },
          { type: "LODGING", amount: 200, status: "PENDING" },
          { type: "OTHER", amount: 999, status: "REJECTED" },
        ],
        abastecimentos: [{ totalCost: 300.25 }, { totalCost: 100 }],
        adiantamentos: [{ amount: 150 }, { amount: 50 }],
        departureOdometer: 10_000,
        returnOdometer: 10_400,
      });

      expect(acerto).toEqual<AcertoDaViagem>({
        cargas: 3,
        cargasACotar: 1,
        frete: 1500.5,
        despesas: 160,
        despesasPorTipo: [
          { type: "TOLL", total: 100 },
          { type: "FOOD", total: 60 },
        ],
        pendentes: { quantidade: 1, total: 200 },
        combustivel: 400.25,
        custoTotal: 560.25,
        resultado: 940.25,
        margem: 62.7,
        km: 400,
        custoPorKm: 1.4,
        adiantado: 200,
      });
    });

    it("viagem que custou mais do que rendeu fica com resultado e margem negativos", () => {
      const acerto = acertoDaViagem({ ...VAZIO, cargas: [{ freightValue: 100 }], despesas: [{ type: "MAINTENANCE", amount: 250, status: "APPROVED" }] });
      expect(acerto).toMatchObject({ frete: 100, custoTotal: 250, resultado: -150, margem: -150 });
      // Sem frete não há do que tirar a margem.
      expect(acertoDaViagem({ ...VAZIO, despesas: [{ type: "TOLL", amount: 10, status: "APPROVED" }] })).toMatchObject({ resultado: -10, margem: null });
    });
  });

  describe("resultado do período", () => {
    it("o DRE soma receita e despesa por categoria, pelo valor que entrou de fato", () => {
      const dre = dreDoPeriodo([
        { type: "INCOME", amount: 1000, category: "Frete" },
        { type: "INCOME", amount: 500, category: " Frete ", paidAmount: 520 },
        { type: "INCOME", amount: 100, category: null },
        { type: "EXPENSE", amount: 300, category: "Combustível" },
        { type: "EXPENSE", amount: 80.5, category: "Pedágio" },
        { type: "EXPENSE", amount: 19.5, category: "" },
      ]);
      expect(dre).toEqual<Resultado["dre"]>({
        receitas: [
          { categoria: "Frete", total: 1520 },
          { categoria: "Sem categoria", total: 100 },
        ],
        receita: 1620,
        despesas: [
          { categoria: "Combustível", total: 300 },
          { categoria: "Pedágio", total: 80.5 },
          { categoria: "Sem categoria", total: 19.5 },
        ],
        despesa: 400,
        resultado: 1220,
        margem: 75.3,
      });
      expect(dreDoPeriodo([])).toEqual({ receitas: [], receita: 0, despesas: [], despesa: 0, resultado: 0, margem: null });
    });

    it("o custo da viagem é rateado pelo peso; viagem sem peso divide por igual", () => {
      expect(custoRateado({ weight: 300 }, { id: "v", custo: 400, peso: 1000, cargas: 3 })).toBe(120);
      expect(custoRateado({ weight: 0 }, { id: "v", custo: 400, peso: 0, cargas: 4 })).toBe(100);
      expect(custoRateado({ weight: 0 }, { id: "v", custo: 400, peso: 0, cargas: 0 })).toBe(0);
    });

    it("a margem por cliente tira do frete a parte do custo de cada viagem", () => {
      const ana = { id: "ana", companyName: "Ana Ltda", tradeName: "Ana" };
      const bia = { id: "bia", companyName: "Bia Ltda", tradeName: null };
      const clientes = margemPorCliente(
        [
          { client: ana, weight: 750, freightValue: 900, manifestId: "v1" },
          { client: bia, weight: 250, freightValue: 100, manifestId: "v1" },
          { client: ana, weight: 100, freightValue: 200, manifestId: "v2" },
          // Entregue fora de viagem: não leva custo. Sem frete: soma zero.
          { client: bia, weight: 50, freightValue: null, manifestId: null },
          // Viagem que a rota não mandou: sem custo, em vez de quebrar.
          { client: bia, weight: 10, freightValue: 30, manifestId: "sumida" },
        ],
        [
          { id: "v1", custo: 400, peso: 1000, cargas: 2 },
          // A viagem tem 400 kg no total; a carga da Ana é um quarto dela.
          { id: "v2", custo: 100, peso: 400, cargas: 3 },
        ],
      );

      expect(clientes).toEqual([
        { clientId: "ana", nome: "Ana", entregas: 2, peso: 850, frete: 1100, custo: 325, resultado: 775, margem: 70.5 },
        { clientId: "bia", nome: "Bia Ltda", entregas: 3, peso: 310, frete: 130, custo: 100, resultado: 30, margem: 23.1 },
      ]);
    });

    it("o resultado por viagem vem da mais recente para a mais antiga, com o total", () => {
      const resultado = montarResultado({
        pagos: [],
        entregues: [],
        custos: [],
        finalizadas: [
          { id: "antiga", finalizadaEm: "2026-03-02T12:00:00Z", motorista: "Ana", placa: "AAA1A11", cargas: 2, frete: 1000, custo: 250, km: 300 },
          { id: "nova", finalizadaEm: "2026-03-09T12:00:00Z", motorista: "Bia", placa: "BBB1B11", cargas: 1, frete: 0, custo: 50, km: null },
        ],
      });
      expect(resultado.viagens.map((v) => [v.id, v.resultado, v.margem])).toEqual([
        ["nova", -50, null],
        ["antiga", 750, 75],
      ]);
      expect(resultado.totalDasViagens).toEqual({ frete: 1000, custo: 300, resultado: 700, margem: 70 });
      expect(resultado.clientes).toEqual([]);
    });
  });
});

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[viagem.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-viagem-";
const CNPJ = "99222111000155";
const CNPJ_SEGUNDO = "99222111000236";
const CNPJ_DA_OUTRA = "99222111000317";
const CNPJS = [CNPJ, CNPJ_SEGUNDO, CNPJ_DA_OUTRA];
const CPF_MOTORISTA = "77788899901";
const CPF_SEGUNDO = "77788899902";
const CPF_MOTORISTA_DA_OUTRA = "77788899903";
const CPFS_DE_MOTORISTA = [CPF_MOTORISTA, CPF_SEGUNDO, CPF_MOTORISTA_DA_OUTRA];
const CPF_AJUDANTE = "77788899911";
const CPF_AJUDANTE_INATIVO = "77788899912";
const CPF_AJUDANTE_DA_OUTRA = "77788899913";
const CPFS_DE_AJUDANTE = [CPF_AJUDANTE, CPF_AJUDANTE_INATIVO, CPF_AJUDANTE_DA_OUTRA];
const PLACA = "VGM1A23";
const PLACA_DA_OUTRA = "VGM1A24";
const PLACAS = [PLACA, PLACA_DA_OUTRA];
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type Corpo = Record<string, unknown> & { id: string; error?: string };
type Perfil = "ADMIN" | "OPERATION" | "CLIENT" | "DRIVER" | "DRIVER2";

suite("rotas da viagem", () => {
  let banco: typeof import("../src/lib/prisma");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let liberar: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let finalizar: typeof import("../src/app/api/manifestos/[id]/finalizar/route");
  let retirar: typeof import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
  let dadosRota: typeof import("../src/app/api/manifestos/[id]/dados/route");
  let ordemRota: typeof import("../src/app/api/manifestos/[id]/ordem/route");
  let despesasRota: typeof import("../src/app/api/manifestos/[id]/despesas/route");
  let despesaRota: typeof import("../src/app/api/manifestos/[id]/despesas/[despesaId]/route");
  let acertoRota: typeof import("../src/app/api/manifestos/[id]/acerto/route");
  let viagensDoMotorista: typeof import("../src/app/api/driver/manifestos/route");
  let despesasDoMotorista: typeof import("../src/app/api/driver/manifestos/[id]/despesas/route");
  let relatorios: typeof import("../src/app/api/relatorios/route");
  let produtividade: typeof import("../src/app/api/equipe/produtividade/route");

  const sessao = vi.mocked(getServerSession);
  const ids: Record<Perfil, string> = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "", DRIVER2: "" };
  let clienteId: string;
  let segundoClienteId: string;
  let motoristaId: string;
  let veiculoId: string;
  let ajudanteId: string;
  let ajudanteInativoId: string;
  const daOutra = { motoristaId: "", ajudanteId: "", veiculoId: "", clienteId: "", viagemId: "" };

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil === "DRIVER2" ? "DRIVER" : perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query}`, {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const ctxDespesa = (id: string, despesaId: string) => ({ params: Promise.resolve({ id, despesaId }) });

  const nome = (n: string) => `${PREFIXO}${n}`;
  const em = (data: string, hora = "12:00") => new Date(`${data}T${hora}:00-03:00`);

  const chamar = async (resposta: Promise<Response>) => {
    const res = await resposta;
    return { status: res.status, corpo: (await res.json()) as Corpo };
  };

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.crewAdvance.deleteMany({ where: { driver: { cpf: { in: CPFS_DE_MOTORISTA } } } });
    // As despesas somem com a viagem (ON DELETE CASCADE).
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: CNPJS } } } });
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: { in: PLACAS } } } });
    await sistema.fueling.deleteMany({ where: { vehicle: { plate: { in: PLACAS } } } });
    await sistema.financialTransaction.deleteMany({ where: { counterparty: { startsWith: PREFIXO } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.vehicle.deleteMany({ where: { plate: { in: PLACAS } } });
    await sistema.helper.deleteMany({ where: { cpf: { in: CPFS_DE_AJUDANTE } } });
    await sistema.driver.deleteMany({ where: { cpf: { in: CPFS_DE_MOTORISTA } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: CNPJS } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  type DadosDaCarga = { status?: string; destino?: string; peso?: number; frete?: number | null; cliente?: string; entregueEm?: Date; sequencia?: number | null };

  const carga = (dados: DadosDaCarga = {}) => ({
    clientId: dados.cliente ?? clienteId,
    sender: "Remetente",
    receiver: nome("destinatário"),
    origin: "Rio Preto - SP",
    destination: dados.destino ?? "Mirassol - SP",
    volumes: 1,
    weight: dados.peso ?? 10,
    status: dados.status ?? "ROUTE",
    freightValue: dados.frete === undefined ? 100 : dados.frete,
    manifestSequence: dados.sequencia ?? null,
    ...(dados.entregueEm ? { statusHistory: { create: [{ fromStatus: "ROUTE", toStatus: "DELIVERED", createdAt: dados.entregueEm }] } } : {}),
  });

  /** Viagem gravada direto no banco, com as cargas na ordem recebida. Devolve os ids das cargas nessa ordem. */
  async function viajar(status: string, cargas: DadosDaCarga[] = [{}], extra: Partial<Prisma.ManifestUncheckedCreateInput> = {}) {
    const viagem = await banco.default.manifest.create({
      data: { driverId: motoristaId, vehicleId: veiculoId, status, ...extra },
    });
    const cargaIds: string[] = [];
    for (const dados of cargas) {
      const criada = await banco.default.collection.create({ data: { ...carga(dados), manifestId: viagem.id, driverId: motoristaId } });
      cargaIds.push(criada.id);
    }
    return { id: viagem.id, cargaIds };
  }

  const lancar = (viagemId: string, corpo: Record<string, unknown> = {}, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return chamar(despesasRota.POST(req("POST", { type: "TOLL", amount: "50", date: "2012-05-10", ...corpo }), ctx(viagemId)));
  };
  const conferir = (viagemId: string, despesaId: string, corpo: Record<string, unknown>, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return chamar(despesaRota.PATCH(req("PATCH", corpo), ctxDespesa(viagemId, despesaId)));
  };
  const trilha = (entityId: string) =>
    banco.sistema.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true, userId: true, userRole: true, ip: true, before: true, after: true, summary: true } });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    manifestos = await import("../src/app/api/manifestos/route");
    liberar = await import("../src/app/api/manifestos/[id]/liberar/route");
    finalizar = await import("../src/app/api/manifestos/[id]/finalizar/route");
    retirar = await import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
    dadosRota = await import("../src/app/api/manifestos/[id]/dados/route");
    ordemRota = await import("../src/app/api/manifestos/[id]/ordem/route");
    despesasRota = await import("../src/app/api/manifestos/[id]/despesas/route");
    despesaRota = await import("../src/app/api/manifestos/[id]/despesas/[despesaId]/route");
    acertoRota = await import("../src/app/api/manifestos/[id]/acerto/route");
    viagensDoMotorista = await import("../src/app/api/driver/manifestos/route");
    despesasDoMotorista = await import("../src/app/api/driver/manifestos/[id]/despesas/route");
    relatorios = await import("../src/app/api/relatorios/route");
    produtividade = await import("../src/app/api/equipe/produtividade/route");
    await limpar();

    const db = banco.default;
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER", "DRIVER2"] as const) {
      ids[perfil] = (
        await db.user.create({
          data: { name: nome(perfil), email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil === "DRIVER2" ? "DRIVER" : perfil },
        })
      ).id;
    }
    clienteId = (await db.client.create({ data: { companyName: nome("cliente"), cnpj: CNPJ } })).id;
    segundoClienteId = (await db.client.create({ data: { companyName: nome("segundo cliente"), cnpj: CNPJ_SEGUNDO } })).id;
    const motorista = { cnh: "77777777701", cnhExpiry: new Date("2031-06-30"), category: "C" };
    motoristaId = (await db.driver.create({ data: { ...motorista, userId: ids.DRIVER, cpf: CPF_MOTORISTA } })).id;
    // O segundo motorista só existe para tentar entrar na viagem do primeiro.
    await db.driver.create({ data: { ...motorista, userId: ids.DRIVER2, cpf: CPF_SEGUNDO } });
    veiculoId = (await db.vehicle.create({ data: { plate: PLACA, model: nome("caminhão"), type: "TRUCK" } })).id;
    ajudanteId = (await db.helper.create({ data: { name: nome("ajudante"), cpf: CPF_AJUDANTE } })).id;
    ajudanteInativoId = (await db.helper.create({ data: { name: nome("ajudante inativo"), cpf: CPF_AJUDANTE_INATIVO, active: false } })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const usuario = await outra.user.create({ data: { name: nome("motorista da outra"), email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
    daOutra.motoristaId = (await outra.driver.create({ data: { ...motorista, userId: usuario.id, cpf: CPF_MOTORISTA_DA_OUTRA } })).id;
    daOutra.ajudanteId = (await outra.helper.create({ data: { name: nome("ajudante da outra"), cpf: CPF_AJUDANTE_DA_OUTRA } })).id;
    daOutra.veiculoId = (await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: nome("da outra"), type: "TRUCK" } })).id;
    daOutra.clienteId = (await outra.client.create({ data: { companyName: nome("cliente da outra"), cnpj: CNPJ_DA_OUTRA } })).id;
  });

  beforeEach(async () => {
    sessao.mockReset();
    await limparMovimento();
    await banco.sistema.vehicle.update({ where: { id: veiculoId }, data: { status: "AVAILABLE" } });

    // A viagem da outra empresa, finalizada em maio de 2012, com frete, despesa aprovada e abastecimento.
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const viagem = await outra.manifest.create({
      data: { driverId: daOutra.motoristaId, vehicleId: daOutra.veiculoId, status: "FINISHED", departedAt: em("2012-05-02"), finishedAt: em("2012-05-04") },
    });
    daOutra.viagemId = viagem.id;
    await outra.collection.create({
      data: { ...carga({ status: "DELIVERED", frete: 7777, peso: 999, entregueEm: em("2012-05-03"), cliente: daOutra.clienteId }), manifestId: viagem.id },
    });
    await outra.tripExpense.create({ data: { manifestId: viagem.id, type: "TOLL", amount: 6666, date: dia("2012-05-03"), status: "APPROVED" } });
    await outra.fueling.create({ data: { vehicleId: daOutra.veiculoId, date: dia("2012-05-03"), liters: 10, totalCost: 5555, odometer: 100 } });
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("permissão", () => {
    it("dados, ordem e despesas são da equipe interna: sem sessão 401; cliente e motorista 403", async () => {
      const viagem = await viajar("ROUTE");
      const despesa = (await lancar(viagem.id)).corpo;
      const rotas: [string, () => Promise<Response>][] = [
        ["PATCH dados", () => dadosRota.PATCH(req("PATCH", { notes: "invasor" }), ctx(viagem.id))],
        ["PUT ordem", () => ordemRota.PUT(req("PUT", { collectionIds: viagem.cargaIds }), ctx(viagem.id))],
        ["GET despesas", () => despesasRota.GET(req(), ctx(viagem.id))],
        ["POST despesas", () => despesasRota.POST(req("POST", { type: "TOLL", amount: "1", date: "2012-05-10" }), ctx(viagem.id))],
        ["DELETE despesa", () => despesaRota.DELETE(req("DELETE"), ctxDespesa(viagem.id, despesa.id))],
        ["PATCH despesa", () => despesaRota.PATCH(req("PATCH", { action: "aprovar" }), ctxDespesa(viagem.id, despesa.id))],
        ["GET acerto", () => acertoRota.GET(req(), ctx(viagem.id))],
      ];

      for (const [rota, chamada] of rotas) {
        entrarComo(null);
        expect((await chamada()).status, `${rota} sem sessão`).toBe(401);
        for (const perfil of ["CLIENT", "DRIVER"] as const) {
          entrarComo(perfil);
          expect((await chamada()).status, `${rota} como ${perfil}`).toBe(403);
        }
      }

      // Nada foi gravado pelas chamadas recusadas.
      expect(await banco.sistema.tripExpense.count({ where: { manifestId: viagem.id } })).toBe(1);
      expect((await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).notes).toBeNull();
    });

    it("aprovar despesa e ver o acerto é dinheiro: a operação leva 403 e nada vai para o Financeiro", async () => {
      const viagem = await viajar("FINISHED", [{ status: "DELIVERED" }]);
      const despesa = (await lancar(viagem.id)).corpo;

      expect((await conferir(viagem.id, despesa.id, { action: "aprovar" }, "OPERATION")).status).toBe(403);
      expect((await conferir(viagem.id, despesa.id, { action: "recusar" }, "OPERATION")).status).toBe(403);
      entrarComo("OPERATION");
      expect((await acertoRota.GET(req(), ctx(viagem.id))).status).toBe(403);

      expect((await banco.sistema.tripExpense.findUniqueOrThrow({ where: { id: despesa.id } })).status).toBe("PENDING");
      expect(await banco.sistema.financialTransaction.count({ where: { counterparty: { startsWith: PREFIXO } } })).toBe(0);
    });

    it("as despesas do aplicativo são do motorista: sem sessão e equipe interna levam 401", async () => {
      const viagem = await viajar("ROUTE");
      for (const perfil of [null, "ADMIN", "OPERATION", "CLIENT"] as const) {
        entrarComo(perfil);
        expect((await despesasDoMotorista.GET(req(), ctx(viagem.id))).status, `GET como ${perfil}`).toBe(401);
        entrarComo(perfil);
        expect((await despesasDoMotorista.POST(req("POST", { type: "TOLL", amount: "1", date: "2012-05-10" }), ctx(viagem.id))).status, `POST como ${perfil}`).toBe(401);
      }
      expect(await banco.sistema.tripExpense.count({ where: { manifestId: viagem.id } })).toBe(0);
    });
  });

  describe("dados da viagem", () => {
    it("grava ajudante, hodômetro, previsões e observação, e registra na auditoria só o que mudou", async () => {
      const viagem = await viajar("ROUTE");
      entrarComo("OPERATION");
      const { status, corpo } = await chamar(
        dadosRota.PATCH(
          req("PATCH", { helperId: ajudanteId, departureOdometer: "1000", returnOdometer: "", plannedDepartureAt: "2012-05-10T08:00", plannedReturnAt: "2012-05-11T18:30", notes: " levar paleteira " }),
          ctx(viagem.id),
        ),
      );
      expect(status).toBe(200);
      expect(corpo.manifest).toMatchObject({ helperId: ajudanteId, departureOdometer: 1000, returnOdometer: null, notes: "levar paleteira", helper: { id: ajudanteId, name: nome("ajudante") } });

      const gravada = await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } });
      expect(gravada.plannedDepartureAt).toEqual(new Date("2012-05-10T11:00:00.000Z"));
      expect(gravada.plannedReturnAt).toEqual(new Date("2012-05-11T21:30:00.000Z"));

      // Segunda chamada: só o hodômetro de retorno muda; o resto fica como estava.
      entrarComo("ADMIN");
      expect((await chamar(dadosRota.PATCH(req("PATCH", { returnOdometer: "1350" }), ctx(viagem.id)))).status).toBe(200);
      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).toMatchObject({ helperId: ajudanteId, departureOdometer: 1000, returnOdometer: 1350, notes: "levar paleteira" });

      // Terceira, igual à segunda: nada mudou, nada na trilha.
      entrarComo("ADMIN");
      expect((await chamar(dadosRota.PATCH(req("PATCH", { returnOdometer: 1350 }), ctx(viagem.id)))).status).toBe(200);

      const linhas = (await trilha(viagem.id)).filter((l) => l.action === "viagem.dados");
      expect(linhas).toHaveLength(2);
      expect(linhas[0]).toMatchObject({ userId: ids.OPERATION, userRole: "OPERATION", ip: "203.0.113.9" });
      expect(linhas[0].after).toMatchObject({ helperId: ajudanteId, departureOdometer: 1000, notes: "levar paleteira" });
      expect(linhas[1]).toMatchObject({ userId: ids.ADMIN, before: { returnOdometer: null }, after: { returnOdometer: 1350 } });
    });

    it("campo em branco apaga o que estava gravado", async () => {
      const viagem = await viajar("ROUTE", [{}], { helperId: ajudanteId, departureOdometer: 500, notes: "obs" });
      entrarComo("OPERATION");
      expect((await chamar(dadosRota.PATCH(req("PATCH", { helperId: "", departureOdometer: "", notes: "" }), ctx(viagem.id)))).status).toBe(200);
      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).toMatchObject({ helperId: null, departureOdometer: null, notes: null });
    });

    it("recusa dado inválido, retorno antes da saída e ajudante que não serve", async () => {
      const viagem = await viajar("ROUTE", [{}], { departureOdometer: 1000 });
      const tentar = async (corpo: unknown) => {
        entrarComo("OPERATION");
        return chamar(dadosRota.PATCH(req("PATCH", corpo), ctx(viagem.id)));
      };

      expect(await tentar({})).toMatchObject({ status: 400, corpo: { error: "Informe ao menos um campo para alterar." } });
      expect((await tentar({ departureOdometer: "12,5" })).status).toBe(400);
      // O retorno é conferido contra a saída que já estava gravada.
      expect(await tentar({ returnOdometer: "999" })).toMatchObject({ status: 400, corpo: { error: RETURN_BEFORE_DEPARTURE_KM } });
      expect(await tentar({ plannedDepartureAt: "2012-05-11T08:00", plannedReturnAt: "2012-05-10T08:00" })).toMatchObject({ status: 400, corpo: { error: RETURN_BEFORE_DEPARTURE } });
      for (const helperId of [SEM_ID, ajudanteInativoId, daOutra.ajudanteId]) {
        expect(await tentar({ helperId }), helperId).toMatchObject({ status: 400, corpo: { error: "Ajudante não encontrado ou desativado." } });
      }

      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).toMatchObject({ helperId: null, returnOdometer: null, plannedDepartureAt: null });
      expect((await trilha(viagem.id)).filter((l) => l.action === "viagem.dados")).toHaveLength(0);
    });

    it("viagem cancelada não recebe alteração; a que não existe é 404", async () => {
      const cancelada = await viajar("CANCELLED", []);
      entrarComo("OPERATION");
      expect(await chamar(dadosRota.PATCH(req("PATCH", { notes: "x" }), ctx(cancelada.id)))).toMatchObject({ status: 409, corpo: { error: "Viagem cancelada não recebe alteração." } });
      entrarComo("OPERATION");
      expect((await chamar(dadosRota.PATCH(req("PATCH", { notes: "x" }), ctx(SEM_ID)))).status).toBe(404);
    });

    it("viagem finalizada antes de existir a data da finalização guarda a data antiga ao ser alterada", async () => {
      const antiga = await viajar("FINISHED", [{ status: "DELIVERED" }], { updatedAt: em("2012-05-20") });
      entrarComo("ADMIN");
      expect((await chamar(dadosRota.PATCH(req("PATCH", { returnOdometer: "2000" }), ctx(antiga.id)))).status).toBe(200);

      const gravada = await banco.sistema.manifest.findUniqueOrThrow({ where: { id: antiga.id } });
      expect(gravada.finishedAt).toEqual(em("2012-05-20"));
      expect(gravada.updatedAt.getTime()).toBeGreaterThan(em("2012-05-20").getTime());
    });

    it("a montagem já aceita os dados da viagem, e recusa ajudante que não serve", async () => {
      const livre = await banco.default.collection.create({ data: carga({ status: "COLLECTED" }) });
      const corpo = { driverId: motoristaId, vehicleId: veiculoId, collectionIds: [livre.id] };

      entrarComo("OPERATION");
      expect((await chamar(manifestos.POST(req("POST", { ...corpo, helperId: ajudanteInativoId })))).status).toBe(400);
      entrarComo("OPERATION");
      expect(await chamar(manifestos.POST(req("POST", { ...corpo, departureOdometer: "100", returnOdometer: "50" })))).toMatchObject({ status: 400, corpo: { error: RETURN_BEFORE_DEPARTURE_KM } });
      expect((await banco.sistema.collection.findUniqueOrThrow({ where: { id: livre.id } })).manifestId).toBeNull();

      entrarComo("OPERATION");
      const criada = await chamar(manifestos.POST(req("POST", { ...corpo, helperId: ajudanteId, departureOdometer: "100", plannedDepartureAt: "2012-05-10T08:00", notes: "obs" })));
      expect(criada.status).toBe(201);
      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: criada.corpo.id } })).toMatchObject({
        status: "ASSEMBLING",
        helperId: ajudanteId,
        departureOdometer: 100,
        plannedDepartureAt: new Date("2012-05-10T11:00:00.000Z"),
        notes: "obs",
        departedAt: null,
        finishedAt: null,
      });

      // A lista do painel traz o ajudante pelo nome.
      entrarComo("OPERATION");
      const lista = (await (await manifestos.GET()).json()) as { id: string; helper: { name: string } | null }[];
      expect(lista.find((m) => m.id === criada.corpo.id)?.helper).toEqual({ id: ajudanteId, name: nome("ajudante") });
    });

    it("liberar a saída grava a data da saída e finalizar grava a da finalização", async () => {
      const antes = Date.now();
      const viagem = await viajar("ASSEMBLING", [{ status: "COLLECTED" }]);

      entrarComo("OPERATION");
      expect((await liberar.POST(req("POST"), ctx(viagem.id))).status).toBe(200);
      const emRota = await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } });
      expect(emRota.status).toBe("ROUTE");
      expect(emRota.departedAt?.getTime()).toBeGreaterThanOrEqual(antes - 1000);
      expect(emRota.finishedAt).toBeNull();

      await banco.sistema.collection.updateMany({ where: { manifestId: viagem.id }, data: { status: "DELIVERED" } });
      entrarComo("OPERATION");
      expect((await finalizar.POST(req("POST"), ctx(viagem.id))).status).toBe(200);
      const finalizada = await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } });
      expect(finalizada.status).toBe("FINISHED");
      expect(finalizada.finishedAt?.getTime()).toBeGreaterThanOrEqual(emRota.departedAt?.getTime() ?? Infinity);
    });
  });

  describe("ordem das entregas", () => {
    const destinos = [{ destino: "Mirassol - SP" }, { destino: "Tanabi - SP" }, { destino: "Votuporanga - SP" }];

    const ordenar = (viagemId: string, collectionIds: unknown, perfil: Perfil = "OPERATION") => {
      entrarComo(perfil);
      return chamar(ordemRota.PUT(req("PUT", { collectionIds }), ctx(viagemId)));
    };

    it("grava a sequência, e o painel e o aplicativo do motorista passam a devolver as cargas nessa ordem", async () => {
      const viagem = await viajar("ROUTE", destinos);
      const [a, b, c] = viagem.cargaIds;

      // Antes de ordenar vale a ordem de criação.
      entrarComo("DRIVER");
      const antes = (await (await viagensDoMotorista.GET()).json()) as { id: string; collections: { id: string }[] }[];
      expect(antes.find((m) => m.id === viagem.id)?.collections.map((x) => x.id)).toEqual([a, b, c]);

      expect(await ordenar(viagem.id, [c, a, b])).toMatchObject({ status: 200, corpo: { success: true, collectionIds: [c, a, b] } });
      const gravadas = await banco.sistema.collection.findMany({ where: { manifestId: viagem.id }, select: { id: true, manifestSequence: true } });
      expect(Object.fromEntries(gravadas.map((x) => [x.id, x.manifestSequence]))).toEqual({ [c]: 1, [a]: 2, [b]: 3 });

      entrarComo("OPERATION");
      const painel = (await (await manifestos.GET()).json()) as { id: string; collections: { id: string }[] }[];
      expect(painel.find((m) => m.id === viagem.id)?.collections.map((x) => x.id)).toEqual([c, a, b]);

      entrarComo("DRIVER");
      const depois = (await (await viagensDoMotorista.GET()).json()) as { id: string; collections: { id: string; destination: string }[] }[];
      const doMotorista = depois.find((m) => m.id === viagem.id)?.collections ?? [];
      expect(doMotorista.map((x) => x.id)).toEqual([c, a, b]);
      // É a ordem que o link do mapa leva.
      expect(new URL(linkDaRota(doMotorista.map((x) => x.destination)).url ?? "").searchParams.get("waypoints")).toBe("Votuporanga - SP|Mirassol - SP");

      const linhas = (await trilha(viagem.id)).filter((l) => l.action === "viagem.ordem");
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ userId: ids.OPERATION, before: { ordem: [a, b, c] }, after: { ordem: [c, a, b] } });

      // A mesma ordem de novo não vira linha na trilha.
      expect((await ordenar(viagem.id, [c, a, b])).status).toBe(200);
      expect((await trilha(viagem.id)).filter((l) => l.action === "viagem.ordem")).toHaveLength(1);
    });

    it("lista que não bate com as cargas da viagem é 409, e nada muda", async () => {
      const viagem = await viajar("ASSEMBLING", destinos.map((d) => ({ ...d, status: "COLLECTED" })));
      const [a, b, c] = viagem.cargaIds;
      const deFora = await banco.default.collection.create({ data: carga({ status: "COLLECTED" }) });

      expect((await ordenar(viagem.id, [a, b])).status).toBe(409);
      expect((await ordenar(viagem.id, [a, b, deFora.id])).status).toBe(409);
      expect((await ordenar(viagem.id, [a, b, c, deFora.id])).status).toBe(409);
      expect((await ordenar(viagem.id, [a, a, b])).status).toBe(400);
      expect((await ordenar(viagem.id, [])).status).toBe(400);
      expect((await ordenar(viagem.id, "abc")).status).toBe(400);

      expect(await banco.sistema.collection.count({ where: { manifestId: viagem.id, manifestSequence: { not: null } } })).toBe(0);
      expect((await banco.sistema.collection.findUniqueOrThrow({ where: { id: deFora.id } })).manifestSequence).toBeNull();
    });

    it("viagem finalizada ou cancelada não é reordenada; a que não existe é 404", async () => {
      const finalizada = await viajar("FINISHED", [{ status: "DELIVERED" }, { status: "DELIVERED" }]);
      expect(await ordenar(finalizada.id, [...finalizada.cargaIds].reverse())).toMatchObject({ status: 409, corpo: { error: "Só dá para ordenar as entregas de viagem em montagem ou em rota." } });
      expect((await ordenar(SEM_ID, [finalizada.cargaIds[0]])).status).toBe(404);
    });

    it("a carga retirada da viagem perde a sequência", async () => {
      const viagem = await viajar("ROUTE", destinos);
      const [a, b, c] = viagem.cargaIds;
      expect((await ordenar(viagem.id, [c, b, a])).status).toBe(200);

      entrarComo("OPERATION");
      expect((await retirar.DELETE(req("DELETE"), { params: Promise.resolve({ id: viagem.id, coletaId: b }) })).status).toBe(200);
      expect(await banco.sistema.collection.findUniqueOrThrow({ where: { id: b } })).toMatchObject({ manifestId: null, manifestSequence: null, status: "COLLECTED" });

      entrarComo("OPERATION");
      const painel = (await (await manifestos.GET()).json()) as { id: string; collections: { id: string }[] }[];
      expect(painel.find((m) => m.id === viagem.id)?.collections.map((x) => x.id)).toEqual([c, a]);
    });
  });

  describe("despesas pelo painel", () => {
    it("a operação lança, a despesa nasce pendente e aparece na lista com quem lançou e o total", async () => {
      const viagem = await viajar("ROUTE");
      const pedagio = await lancar(viagem.id, { amount: "35,90", notes: " praça de Catanduva " });
      expect(pedagio.status).toBe(201);
      expect(pedagio.corpo).toMatchObject({ manifestId: viagem.id, type: "TOLL", amount: 35.9, notes: "praça de Catanduva", status: "PENDING", fuelingId: null, transactionId: null, createdBy: { id: ids.OPERATION, name: nome("OPERATION") } });
      await lancar(viagem.id, { type: "FOOD", amount: "40", date: "2012-05-11" }, "ADMIN");

      entrarComo("OPERATION");
      const lista = (await (await despesasRota.GET(req(), ctx(viagem.id))).json()) as { total: number; despesas: { type: string; createdBy: { name: string } }[] };
      expect(lista.total).toBe(75.9);
      // Da mais recente para a mais antiga.
      expect(lista.despesas.map((d) => [d.type, d.createdBy.name])).toEqual([
        ["FOOD", nome("ADMIN")],
        ["TOLL", nome("OPERATION")],
      ]);

      // Lançar não mexe no Financeiro: isso é da aprovação.
      expect(await banco.sistema.financialTransaction.count({ where: { counterparty: { startsWith: PREFIXO } } })).toBe(0);

      const linhas = await trilha(pedagio.corpo.id);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ action: "despesa-viagem.lancar", userId: ids.OPERATION, after: { type: "TOLL", amount: 35.9, status: "PENDING" } });
    });

    it("combustível com litros e hodômetro gera o abastecimento da frota; sem um dos dois fica só a despesa", async () => {
      const viagem = await viajar("ROUTE");
      const completo = await lancar(viagem.id, { type: "FUEL", amount: "350", date: "2012-05-10", notes: "Posto Rio", liters: "70", odometer: "120000" });
      expect(completo.status).toBe(201);
      expect(completo.corpo).toMatchObject({ type: "FUEL", liters: 70, odometer: 120000 });

      const abastecimentos = await banco.sistema.fueling.findMany({ where: { vehicleId: veiculoId } });
      expect(abastecimentos).toHaveLength(1);
      expect(abastecimentos[0]).toMatchObject({ id: completo.corpo.fuelingId, driverId: motoristaId, liters: 70, totalCost: 350, odometer: 120000, station: "Posto Rio" });
      expect(abastecimentos[0].date).toEqual(dia("2012-05-10"));

      const semLitros = await lancar(viagem.id, { type: "FUEL", amount: "100", odometer: "120500" });
      const semHodometro = await lancar(viagem.id, { type: "FUEL", amount: "100", liters: "20" });
      expect(semLitros.corpo.fuelingId).toBeNull();
      expect(semHodometro.corpo.fuelingId).toBeNull();
      expect(await banco.sistema.fueling.count({ where: { vehicleId: veiculoId } })).toBe(1);
    });

    it("recusa despesa inválida, viagem cancelada e viagem que não existe", async () => {
      const viagem = await viajar("ROUTE");
      expect((await lancar(viagem.id, { type: "MULTA" })).status).toBe(400);
      expect((await lancar(viagem.id, { amount: "0" })).status).toBe(400);
      expect((await lancar(viagem.id, { date: "ontem" })).status).toBe(400);
      expect((await lancar(viagem.id, { type: "FUEL", liters: "-1" })).status).toBe(400);
      expect(await banco.sistema.tripExpense.count({ where: { manifestId: viagem.id } })).toBe(0);

      const cancelada = await viajar("CANCELLED", []);
      expect((await lancar(cancelada.id)).status).toBe(409);
      expect((await lancar(SEM_ID)).status).toBe(404);
      entrarComo("OPERATION");
      expect((await despesasRota.GET(req(), ctx(SEM_ID))).status).toBe(404);
    });

    it("aprovada vira lançamento a pagar no Financeiro, com categoria e a viagem como centro de custo", async () => {
      const viagem = await viajar("ROUTE");
      const despesa = (await lancar(viagem.id, { type: "LODGING", amount: "180,50", date: "2012-05-10", notes: "Hotel Central" })).corpo;

      const aprovada = await conferir(viagem.id, despesa.id, { action: "aprovar" });
      expect(aprovada.status).toBe(200);
      expect(aprovada.corpo).toMatchObject({ status: "APPROVED" });
      expect(aprovada.corpo.transactionId).toBeTruthy();

      const lancamento = await banco.sistema.financialTransaction.findUniqueOrThrow({ where: { id: aprovada.corpo.transactionId as string } });
      expect(lancamento).toMatchObject({
        type: "EXPENSE",
        amount: 180.5,
        status: "PENDING",
        paidAt: null,
        paymentMethod: null,
        category: "Hospedagem",
        costCenter: `Viagem #${codigoDaViagem(viagem.id)}`,
        description: `Hospedagem: viagem #${codigoDaViagem(viagem.id)}`,
        counterparty: nome("OPERATION"),
        notes: "Hotel Central",
      });
      expect(lancamento.dueDate).toEqual(dia("2012-05-10"));

      const gravada = await banco.sistema.tripExpense.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(gravada).toMatchObject({ status: "APPROVED", reviewedById: ids.ADMIN });
      expect(gravada.reviewedAt).toBeInstanceOf(Date);

      // Aprovar ou recusar de novo não cria segundo lançamento.
      expect(await conferir(viagem.id, despesa.id, { action: "aprovar" })).toMatchObject({ status: 409, corpo: { error: "Esta despesa já foi aprovada ou recusada." } });
      expect((await conferir(viagem.id, despesa.id, { action: "recusar" })).status).toBe(409);
      expect(await banco.sistema.financialTransaction.count({ where: { counterparty: { startsWith: PREFIXO } } })).toBe(1);

      const acoes = (await trilha(despesa.id)).map((l) => [l.action, l.userId]);
      expect(acoes).toEqual([
        ["despesa-viagem.lancar", ids.OPERATION],
        ["despesa-viagem.aprovar", ids.ADMIN],
      ]);
    });

    it("aprovada como paga nasce paga no Financeiro, com a forma de pagamento", async () => {
      const viagem = await viajar("ROUTE");
      const despesa = (await lancar(viagem.id)).corpo;
      const antes = Date.now();

      const aprovada = await conferir(viagem.id, despesa.id, { action: "aprovar", paid: true, paymentMethod: "PIX" });
      expect(aprovada.status).toBe(200);
      const lancamento = await banco.sistema.financialTransaction.findUniqueOrThrow({ where: { id: aprovada.corpo.transactionId as string } });
      expect(lancamento).toMatchObject({ status: "PAID", paymentMethod: "PIX", category: "Pedágio", amount: 50 });
      expect(lancamento.paidAt?.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    });

    it("recusada não vai para o Financeiro e desfaz o abastecimento que tinha gerado", async () => {
      const viagem = await viajar("ROUTE");
      const despesa = (await lancar(viagem.id, { type: "FUEL", amount: "350", liters: "70", odometer: "120000" })).corpo;
      expect(await banco.sistema.fueling.count({ where: { vehicleId: veiculoId } })).toBe(1);

      const recusada = await conferir(viagem.id, despesa.id, { action: "recusar" });
      expect(recusada).toMatchObject({ status: 200, corpo: { status: "REJECTED", fuelingId: null, transactionId: null } });
      expect(await banco.sistema.fueling.count({ where: { vehicleId: veiculoId } })).toBe(0);
      expect(await banco.sistema.financialTransaction.count({ where: { counterparty: { startsWith: PREFIXO } } })).toBe(0);
      expect((await trilha(despesa.id)).map((l) => l.action)).toEqual(["despesa-viagem.lancar", "despesa-viagem.recusar"]);

      expect((await conferir(viagem.id, despesa.id, { action: "pagar" })).status).toBe(400);
    });

    it("só a pendente é excluída, e leva junto o abastecimento que tinha gerado", async () => {
      const viagem = await viajar("ROUTE");
      const pendente = (await lancar(viagem.id, { type: "FUEL", amount: "350", liters: "70", odometer: "120000" })).corpo;
      const aprovada = (await lancar(viagem.id)).corpo;
      await conferir(viagem.id, aprovada.id, { action: "aprovar" });

      entrarComo("OPERATION");
      expect((await despesaRota.DELETE(req("DELETE"), ctxDespesa(viagem.id, pendente.id))).status).toBe(200);
      expect(await banco.sistema.tripExpense.findUnique({ where: { id: pendente.id } })).toBeNull();
      expect(await banco.sistema.fueling.count({ where: { vehicleId: veiculoId } })).toBe(0);
      const linhas = await trilha(pendente.id);
      expect(linhas.map((l) => l.action)).toEqual(["despesa-viagem.lancar", "despesa-viagem.excluir"]);
      expect(linhas[1].before).toMatchObject({ type: "FUEL", amount: 350 });

      entrarComo("OPERATION");
      expect(await chamar(despesaRota.DELETE(req("DELETE"), ctxDespesa(viagem.id, aprovada.id)))).toMatchObject({
        status: 409,
        corpo: { error: "Só despesa pendente pode ser excluída. A aprovada já está no Financeiro." },
      });
      expect(await banco.sistema.tripExpense.findUnique({ where: { id: aprovada.id } })).not.toBeNull();
    });

    it("despesa de outra viagem não é alcançada pelo endereço desta", async () => {
      const viagem = await viajar("ROUTE");
      const vizinha = await viajar("FINISHED", [{ status: "DELIVERED" }]);
      const despesa = (await lancar(vizinha.id)).corpo;

      expect((await conferir(viagem.id, despesa.id, { action: "aprovar" })).status).toBe(404);
      entrarComo("ADMIN");
      expect((await despesaRota.DELETE(req("DELETE"), ctxDespesa(viagem.id, despesa.id))).status).toBe(404);
      expect((await conferir(viagem.id, SEM_ID, { action: "aprovar" })).status).toBe(404);
      expect((await banco.sistema.tripExpense.findUniqueOrThrow({ where: { id: despesa.id } })).status).toBe("PENDING");
    });
  });

  describe("despesas pelo aplicativo do motorista", () => {
    const lancarComoMotorista = (viagemId: string, corpo: Record<string, unknown> = {}, perfil: Perfil = "DRIVER") => {
      entrarComo(perfil);
      return chamar(despesasDoMotorista.POST(req("POST", { type: "FOOD", amount: "32,50", date: "2012-05-10", ...corpo }), ctx(viagemId)));
    };
    const lerComoMotorista = async (viagemId: string, perfil: Perfil = "DRIVER") => {
      entrarComo(perfil);
      const res = await despesasDoMotorista.GET(req(), ctx(viagemId));
      return { status: res.status, corpo: (await res.json()) as { total: number; despesas: Record<string, unknown>[] } };
    };

    it("o motorista lança na viagem dele, vê só as que ele lançou e o total delas", async () => {
      const viagem = await viajar("ROUTE");
      // O painel lança uma despesa na mesma viagem: ela não vai para o aparelho.
      await lancar(viagem.id, { amount: "500", notes: "do painel" });

      const almoco = await lancarComoMotorista(viagem.id, { notes: "almoço" });
      expect(almoco.status).toBe(201);
      expect(almoco.corpo).toEqual({
        id: almoco.corpo.id,
        type: "FOOD",
        amount: 32.5,
        date: "2012-05-10T00:00:00.000Z",
        notes: "almoço",
        status: "PENDING",
        liters: null,
        odometer: null,
        createdAt: almoco.corpo.createdAt,
      });
      const diesel = await lancarComoMotorista(viagem.id, { type: "FUEL", amount: "300", liters: "60", odometer: "90000" });
      expect(diesel.status).toBe(201);
      // O abastecimento entra na frota, no veículo e no motorista da viagem.
      expect(await banco.sistema.fueling.findMany({ where: { vehicleId: veiculoId } })).toMatchObject([{ driverId: motoristaId, liters: 60, totalCost: 300, odometer: 90000 }]);

      const lista = await lerComoMotorista(viagem.id);
      expect(lista.status).toBe(200);
      expect(lista.corpo.total).toBe(332.5);
      expect(lista.corpo.despesas.map((d) => d.type).sort()).toEqual(["FOOD", "FUEL"]);
      expect(lista.corpo.despesas).toHaveLength(2);
      expect(JSON.stringify(lista.corpo)).not.toMatch(/do painel|transactionId|createdBy|fuelingId/);

      // No painel ela aparece com o nome do motorista, pendente, para o administrador aprovar.
      const gravada = await banco.sistema.tripExpense.findUniqueOrThrow({ where: { id: almoco.corpo.id } });
      expect(gravada).toMatchObject({ manifestId: viagem.id, createdById: ids.DRIVER, status: "PENDING" });
      expect(await trilha(almoco.corpo.id)).toMatchObject([{ action: "despesa-viagem.lancar", userId: ids.DRIVER, userRole: "DRIVER", ip: "203.0.113.9" }]);

      // Recusada pelo administrador: segue na lista do motorista, fora do total.
      await conferir(viagem.id, almoco.corpo.id, { action: "recusar" });
      const depois = await lerComoMotorista(viagem.id);
      expect(depois.corpo.total).toBe(300);
      expect(depois.corpo.despesas.find((d) => d.id === almoco.corpo.id)).toMatchObject({ status: "REJECTED" });
    });

    it("viagem de outro motorista, em montagem ou finalizada é 404, e nada é gravado", async () => {
      const dele = await viajar("ROUTE");
      const emMontagem = await viajar("ASSEMBLING", [{ status: "COLLECTED" }]);
      const finalizada = await viajar("FINISHED", [{ status: "DELIVERED" }]);
      await lancarComoMotorista(dele.id);

      // O segundo motorista não lança nem lê na viagem do primeiro.
      expect(await lancarComoMotorista(dele.id, {}, "DRIVER2")).toMatchObject({ status: 404, corpo: { error: "Viagem não encontrada." } });
      expect((await lerComoMotorista(dele.id, "DRIVER2")).status).toBe(404);
      for (const viagem of [emMontagem, finalizada, { id: SEM_ID }, { id: daOutra.viagemId }]) {
        expect((await lancarComoMotorista(viagem.id)).status, viagem.id).toBe(404);
        expect((await lerComoMotorista(viagem.id)).status, viagem.id).toBe(404);
      }
      expect(await banco.sistema.tripExpense.count({ where: { manifest: { vehicleId: veiculoId } } })).toBe(1);
    });

    it("recusa despesa inválida", async () => {
      const viagem = await viajar("ROUTE");
      expect((await lancarComoMotorista(viagem.id, { amount: "" })).status).toBe(400);
      expect((await lancarComoMotorista(viagem.id, { type: "GORJETA" })).status).toBe(400);
      expect(await banco.sistema.tripExpense.count({ where: { manifestId: viagem.id } })).toBe(0);
    });
  });

  describe("acerto da viagem", () => {
    type RespostaDoAcerto = {
      viagem: Record<string, unknown>;
      acerto: AcertoDaViagem;
      saldoDoAdiantamento: { diferenca: number; sentido: string } | null;
      adiantamentos: { amount: number }[];
      despesas: { type: string }[];
    };

    const lerAcerto = async (viagemId: string) => {
      entrarComo("ADMIN");
      const res = await acertoRota.GET(req(), ctx(viagemId));
      return { status: res.status, corpo: (await res.json()) as RespostaDoAcerto & { error?: string } };
    };

    it("monta frete, despesas aprovadas, combustível sem contar duas vezes, km, resultado, margem e o saldo do adiantamento", async () => {
      const viagem = await viajar(
        "FINISHED",
        [
          { status: "DELIVERED", frete: 1000 },
          { status: "DELIVERED", frete: 500 },
          { status: "DELIVERED", frete: null },
        ],
        { helperId: ajudanteId, departedAt: em("2012-05-08"), finishedAt: em("2012-05-12"), departureOdometer: 10_000, returnOdometer: 10_500 },
      );

      // Aprovadas: pedágio 100 e combustível 200 (que gerou abastecimento na frota).
      const pedagio = (await lancar(viagem.id, { amount: "100", date: "2012-05-09" })).corpo;
      const diesel = (await lancar(viagem.id, { type: "FUEL", amount: "200", date: "2012-05-10", liters: "40", odometer: "10200" })).corpo;
      await conferir(viagem.id, pedagio.id, { action: "aprovar" });
      await conferir(viagem.id, diesel.id, { action: "aprovar", paid: true });
      // Fora do custo: uma pendente e uma recusada.
      await lancar(viagem.id, { type: "FOOD", amount: "45", date: "2012-05-10" });
      const recusada = (await lancar(viagem.id, { type: "OTHER", amount: "999", date: "2012-05-10" })).corpo;
      await conferir(viagem.id, recusada.id, { action: "recusar" });

      // Abastecimentos da frota no veículo: dois na janela (saída e finalização contam), dois fora dela.
      const abastecer = (data: string, totalCost: number) => banco.default.fueling.create({ data: { vehicleId: veiculoId, date: dia(data), liters: 10, totalCost, odometer: 1 } });
      await abastecer("2012-05-08", 150);
      await abastecer("2012-05-12", 50.5);
      await abastecer("2012-05-07", 8000);
      await abastecer("2012-05-13", 9000);

      await banco.default.crewAdvance.create({ data: { driverId: motoristaId, date: dia("2012-05-08"), amount: 400, reason: "TRIP", manifestId: viagem.id } });
      // Adiantamento sem viagem não entra.
      await banco.default.crewAdvance.create({ data: { driverId: motoristaId, date: dia("2012-05-08"), amount: 7000, reason: "VOUCHER" } });

      const { status, corpo } = await lerAcerto(viagem.id);
      expect(status).toBe(200);
      expect(corpo.acerto).toEqual<AcertoDaViagem>({
        cargas: 3,
        cargasACotar: 1,
        frete: 1500,
        despesas: 300,
        despesasPorTipo: [
          { type: "FUEL", total: 200 },
          { type: "TOLL", total: 100 },
        ],
        pendentes: { quantidade: 1, total: 45 },
        // 150 + 50,50 da frota; os 200 do abastecimento gerado pela despesa já estão em "despesas".
        combustivel: 200.5,
        custoTotal: 500.5,
        resultado: 999.5,
        margem: 66.6,
        km: 500,
        custoPorKm: 1,
        adiantado: 400,
      });
      expect(corpo.viagem).toMatchObject({ id: viagem.id, motorista: nome("DRIVER"), ajudante: nome("ajudante"), placa: PLACA, departureOdometer: 10_000, returnOdometer: 10_500 });
      expect(new Date(corpo.viagem.finalizadaEm as string)).toEqual(em("2012-05-12"));
      // Adiantou 400, gastou 300 aprovados: devolve 100.
      expect(corpo.saldoDoAdiantamento).toEqual({ diferenca: 100, sentido: "devolver" });
      expect(corpo.adiantamentos).toHaveLength(1);
      expect(corpo.despesas.map((d) => d.type).sort()).toEqual(["FUEL", "TOLL"]);
    });

    it("sem adiantamento não há saldo; viagem anterior à data da finalização usa a da última alteração", async () => {
      const antiga = await viajar("FINISHED", [{ status: "DELIVERED", frete: 300 }], { createdAt: em("2012-05-02"), updatedAt: em("2012-05-04") });
      await banco.default.fueling.create({ data: { vehicleId: veiculoId, date: dia("2012-05-03"), liters: 10, totalCost: 120, odometer: 1 } });
      await banco.default.fueling.create({ data: { vehicleId: veiculoId, date: dia("2012-05-05"), liters: 10, totalCost: 9000, odometer: 2 } });

      const { corpo } = await lerAcerto(antiga.id);
      expect(corpo.acerto).toMatchObject({ frete: 300, despesas: 0, combustivel: 120, custoTotal: 120, resultado: 180, margem: 60, km: null, custoPorKm: null, adiantado: 0 });
      expect(corpo.saldoDoAdiantamento).toBeNull();
      expect(new Date(corpo.viagem.finalizadaEm as string)).toEqual(em("2012-05-04"));
    });

    it("só viagem finalizada tem acerto; a que não existe é 404", async () => {
      const emRota = await viajar("ROUTE");
      expect(await lerAcerto(emRota.id)).toMatchObject({ status: 409, corpo: { error: "O acerto só existe para viagem finalizada." } });
      expect((await lerAcerto(SEM_ID)).status).toBe(404);
    });
  });

  describe("relatórios: resultado do período", () => {
    const lerResultado = async (query = "?de=2012-05&ate=2012-05") => {
      entrarComo("ADMIN");
      const res = await relatorios.GET(req("GET", undefined, query));
      expect(res.status).toBe(200);
      return ((await res.json()) as { resultado: Resultado }).resultado;
    };

    /** O movimento de maio de 2012: duas viagens finalizadas, uma delas com custo, e lançamentos pagos. */
    async function movimentoDeMaio() {
      // Viagem 1: 1000 kg, custo 400 (pedágio 300 aprovado + 100 de combustível da frota).
      const v1 = await viajar(
        "FINISHED",
        [
          { status: "DELIVERED", peso: 750, frete: 900, entregueEm: em("2012-05-10") },
          { status: "DELIVERED", peso: 250, frete: 100, cliente: segundoClienteId, entregueEm: em("2012-05-10") },
        ],
        { departedAt: em("2012-05-09"), finishedAt: em("2012-05-11"), departureOdometer: 0, returnOdometer: 800 },
      );
      const pedagio = (await lancar(v1.id, { amount: "300", date: "2012-05-10" })).corpo;
      await conferir(v1.id, pedagio.id, { action: "aprovar" });
      // Pendente: fora do custo.
      await lancar(v1.id, { type: "FOOD", amount: "5000", date: "2012-05-10" });
      await banco.default.fueling.create({ data: { vehicleId: veiculoId, date: dia("2012-05-10"), liters: 20, totalCost: 100, odometer: 1 } });

      // Viagem 2: anterior à data da finalização (vale a da última alteração), sem custo.
      const v2 = await viajar("FINISHED", [{ status: "DELIVERED", peso: 100, frete: 200, entregueEm: em("2012-05-20") }], { createdAt: em("2012-05-19"), updatedAt: em("2012-05-21") });

      // Fora do período: finalizada em junho (a carga foi entregue em junho também).
      await viajar("FINISHED", [{ status: "DELIVERED", frete: 8000, entregueEm: em("2012-06-02") }], { departedAt: em("2012-06-01"), finishedAt: em("2012-06-02") });
      // Carga entregue em maio fora de viagem: entra na margem do cliente sem custo.
      await banco.default.collection.create({ data: carga({ status: "DELIVERED", peso: 50, frete: 60, entregueEm: em("2012-05-25") }) });

      const pago = (dados: Record<string, unknown>) =>
        banco.default.financialTransaction.create({
          data: { type: "EXPENSE", amount: 0, description: nome("lançamento"), status: "PAID", paidAt: em("2012-05-15"), counterparty: nome("fornecedor"), ...dados },
        });
      await pago({ type: "INCOME", amount: 1000, category: "Frete" });
      // Recebido com juros: vale o que entrou.
      await pago({ type: "INCOME", amount: 500, paidAmount: 520, category: "Frete" });
      await pago({ type: "INCOME", amount: 80 });
      await pago({ amount: 250, category: "Combustível" });
      await pago({ amount: 70, category: "Pedágio" });
      // Fora: pago em junho, e em aberto.
      await pago({ amount: 9000, category: "Pedágio", paidAt: em("2012-06-01") });
      await pago({ amount: 9000, category: "Pedágio", status: "PENDING", paidAt: null });

      return { v1, v2 };
    }

    it("traz o DRE, a margem por cliente com o custo rateado pelo peso e o resultado por viagem", async () => {
      const { v1, v2 } = await movimentoDeMaio();
      const resultado = await lerResultado();

      expect(resultado.dre).toEqual({
        receitas: [
          { categoria: "Frete", total: 1520 },
          { categoria: "Sem categoria", total: 80 },
        ],
        receita: 1600,
        despesas: [
          { categoria: "Combustível", total: 250 },
          { categoria: "Pedágio", total: 70 },
        ],
        despesa: 320,
        resultado: 1280,
        margem: 80,
      });

      // Cliente 1: 900 (v1) + 200 (v2) + 60 (fora de viagem); custo = 400 × 750/1000.
      // Cliente 2: 100 (v1); custo = 400 × 250/1000.
      expect(resultado.clientes).toEqual([
        { clientId: clienteId, nome: nome("cliente"), entregas: 3, peso: 900, frete: 1160, custo: 300, resultado: 860, margem: 74.1 },
        { clientId: segundoClienteId, nome: nome("segundo cliente"), entregas: 1, peso: 250, frete: 100, custo: 100, resultado: 0, margem: 0 },
      ]);

      expect(resultado.viagens).toEqual([
        { id: v2.id, finalizadaEm: em("2012-05-21").toISOString(), motorista: nome("DRIVER"), placa: PLACA, cargas: 1, frete: 200, custo: 0, km: null, resultado: 200, margem: 100 },
        { id: v1.id, finalizadaEm: em("2012-05-11").toISOString(), motorista: nome("DRIVER"), placa: PLACA, cargas: 2, frete: 1000, custo: 400, km: 800, resultado: 600, margem: 60 },
      ]);
      expect(resultado.totalDasViagens).toEqual({ frete: 1200, custo: 400, resultado: 800, margem: 66.7 });
    });

    it("a carga entregue no período leva o custo da viagem mesmo que ela tenha sido finalizada depois", async () => {
      // Entregue em maio, viagem finalizada em junho: não é linha de maio, mas o custo dela é da carga.
      const viagem = await viajar("FINISHED", [{ status: "DELIVERED", peso: 10, frete: 500, entregueEm: em("2012-05-30") }], { departedAt: em("2012-05-30"), finishedAt: em("2012-06-01") });
      const despesa = (await lancar(viagem.id, { amount: "120", date: "2012-05-30" })).corpo;
      await conferir(viagem.id, despesa.id, { action: "aprovar" });

      const maio = await lerResultado();
      expect(maio.viagens).toEqual([]);
      expect(maio.clientes).toEqual([{ clientId: clienteId, nome: nome("cliente"), entregas: 1, peso: 10, frete: 500, custo: 120, resultado: 380, margem: 76 }]);

      const junho = await lerResultado("?de=2012-06&ate=2012-06");
      expect(junho.viagens.map((v) => [v.id, v.frete, v.custo])).toEqual([[viagem.id, 500, 120]]);
      expect(junho.clientes).toEqual([]);
    });

    it("sem movimento vem tudo vazio; o relatório básico segue como era; e o resultado é só do administrador", async () => {
      const vazio = await lerResultado("?de=2012-01&ate=2012-01");
      expect(vazio).toEqual<Resultado>({
        dre: { receitas: [], receita: 0, despesas: [], despesa: 0, resultado: 0, margem: null },
        clientes: [],
        viagens: [],
        totalDasViagens: { frete: 0, custo: 0, resultado: 0, margem: null },
      });

      entrarComo("ADMIN");
      const completo = (await (await relatorios.GET(req("GET", undefined, "?de=2012-01&ate=2012-01"))).json()) as Record<string, unknown>;
      expect(Object.keys(completo).sort()).toEqual(["comercial", "financeiro", "operacional", "periodo", "resultado"]);

      entrarComo("OPERATION");
      expect((await relatorios.GET(req("GET", undefined, "?de=2012-05&ate=2012-05"))).status).toBe(403);
    });

    it("a produtividade da equipe conta a viagem pela data da finalização, não pela da última alteração", async () => {
      // Finalizada em maio e alterada em junho (alguém completou o hodômetro depois).
      await viajar("FINISHED", [{ status: "DELIVERED" }], { finishedAt: em("2012-05-30"), updatedAt: em("2012-06-03") });
      // Anterior à data da finalização: segue contando pela última alteração.
      await viajar("FINISHED", [{ status: "DELIVERED" }], { updatedAt: em("2012-05-15") });
      await viajar("ROUTE", [{}], { updatedAt: em("2012-05-15") });

      const viagens = async (mes: string) => {
        entrarComo("ADMIN");
        const corpo = (await (await produtividade.GET(req("GET", undefined, `?de=${mes}&ate=${mes}`))).json()) as { motoristas: { driverId: string; viagens: number }[] };
        return corpo.motoristas.find((l) => l.driverId === motoristaId)?.viagens;
      };
      expect(await viagens("2012-05")).toBe(2);
      expect(await viagens("2012-06")).toBe(0);
    });
  });

  describe("isolamento entre empresas", () => {
    it("viagem de outra empresa não existe para as rotas desta", async () => {
      const id = daOutra.viagemId;
      const despesaDaOutra = await banco.sistema.tripExpense.findFirstOrThrow({ where: { manifestId: id } });

      entrarComo("ADMIN");
      expect((await dadosRota.PATCH(req("PATCH", { notes: "invasor" }), ctx(id))).status).toBe(404);
      entrarComo("ADMIN");
      expect((await ordemRota.PUT(req("PUT", { collectionIds: [SEM_ID] }), ctx(id))).status).toBe(404);
      entrarComo("ADMIN");
      expect((await despesasRota.GET(req(), ctx(id))).status).toBe(404);
      expect((await lancar(id, {}, "ADMIN")).status).toBe(404);
      expect((await conferir(id, despesaDaOutra.id, { action: "recusar" })).status).toBe(404);
      entrarComo("ADMIN");
      expect((await despesaRota.DELETE(req("DELETE"), ctxDespesa(id, despesaDaOutra.id))).status).toBe(404);
      entrarComo("ADMIN");
      expect((await acertoRota.GET(req(), ctx(id))).status).toBe(404);

      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id } })).toMatchObject({ notes: null });
      expect(await banco.sistema.tripExpense.findMany({ where: { manifestId: id } })).toMatchObject([{ id: despesaDaOutra.id, status: "APPROVED" }]);
    });

    it("frete, despesa, abastecimento e viagem da outra empresa não entram no resultado nem no acerto desta", async () => {
      const viagem = await viajar("FINISHED", [{ status: "DELIVERED", frete: 300, entregueEm: em("2012-05-03") }], { departedAt: em("2012-05-02"), finishedAt: em("2012-05-04") });

      entrarComo("ADMIN");
      const resposta = (await (await relatorios.GET(req("GET", undefined, "?de=2012-05&ate=2012-05"))).json()) as { resultado: Resultado };
      expect(JSON.stringify(resposta.resultado)).not.toMatch(/da outra|7777|6666|5555/);
      expect(resposta.resultado.viagens.map((v) => v.id)).toEqual([viagem.id]);
      expect(resposta.resultado.clientes.map((c) => c.clientId)).toEqual([clienteId]);

      entrarComo("ADMIN");
      const acerto = (await (await acertoRota.GET(req(), ctx(viagem.id))).json()) as { acerto: AcertoDaViagem };
      expect(acerto.acerto).toMatchObject({ frete: 300, despesas: 0, combustivel: 0, resultado: 300 });
    });

    it("o banco recusa despesa apontando para viagem de outra empresa", async () => {
      await expect(
        banco.default.tripExpense.create({ data: { manifestId: daOutra.viagemId, type: "TOLL", amount: 1, date: dia("2012-05-03") } }),
      ).rejects.toThrow();
      expect(await banco.sistema.tripExpense.count({ where: { manifestId: daOutra.viagemId } })).toBe(1);
    });
  });
});

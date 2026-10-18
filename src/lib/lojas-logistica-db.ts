import { hashCanonico } from "./lojas-logistica";
import { paraEmpresa } from "./prisma";
import { calcularFrete, tabelaVigente } from "./frete";
import { generateTrackingCode } from "./tracking";
import type { CotacaoLojas } from "./lojas-logistica";
import { resumirCarga } from "./lojas-logistica";

export type RespostaIdempotente = { status: number; body: unknown };
export type RegistroIdempotente = {
  hash: string;
  status: "PROCESSING" | "COMPLETED";
  response?: RespostaIdempotente;
};

export interface ArmazenamentoIdempotente {
  obter(chave: string): Promise<RegistroIdempotente | null>;
  iniciar(chave: string, hash: string): Promise<boolean>;
  concluir(chave: string, resposta: RespostaIdempotente): Promise<void>;
  falhar(chave: string): Promise<void>;
}

export class ConflitoDeIdempotencia extends Error {
  constructor() {
    super("A chave de idempotência já foi usada com outro conteúdo.");
    this.name = "ConflitoDeIdempotencia";
  }
}

export class RequisicaoEmAndamento extends Error {
  constructor() {
    super("A requisição com esta chave ainda está em processamento.");
    this.name = "RequisicaoEmAndamento";
  }
}

export async function executarIdempotente(
  armazenamento: ArmazenamentoIdempotente,
  chave: string,
  corpo: unknown,
  executar: () => Promise<RespostaIdempotente>,
) {
  if (chave.length < 8 || chave.length > 120) throw new Error("Chave de idempotência inválida.");
  const hash = hashCanonico(corpo);
  let atual = await armazenamento.obter(chave);

  if (!atual) {
    const iniciou = await armazenamento.iniciar(chave, hash);
    atual = iniciou ? null : await armazenamento.obter(chave);
  }
  if (atual) {
    if (atual.hash !== hash) throw new ConflitoDeIdempotencia();
    if (atual.status === "COMPLETED" && atual.response) return { ...atual.response, replay: true as const };
    throw new RequisicaoEmAndamento();
  }

  try {
    const resposta = await executar();
    await armazenamento.concluir(chave, resposta);
    return { ...resposta, replay: false as const };
  } catch (erro) {
    await armazenamento.falhar(chave);
    throw erro;
  }
}

export function armazenamentoPrisma(tenantId: string, credentialId: string): ArmazenamentoIdempotente {
  const { db } = paraEmpresa(tenantId);
  return {
    async obter(chave) {
      const registro = await db.integrationRequest.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: chave } },
        select: { requestHash: true, status: true, responseStatus: true, responseBody: true },
      });
      if (!registro || (registro.status !== "PROCESSING" && registro.status !== "COMPLETED")) return null;
      return {
        hash: registro.requestHash,
        status: registro.status,
        response: registro.responseStatus === null ? undefined : { status: registro.responseStatus, body: registro.responseBody },
      };
    },
    async iniciar(chave, hash) {
      try {
        await db.integrationRequest.create({ data: { credentialId, idempotencyKey: chave, method: "POST", path: "v1", requestHash: hash } });
        return true;
      } catch (erro) {
        if (typeof erro === "object" && erro && "code" in erro && erro.code === "P2002") return false;
        throw erro;
      }
    },
    async concluir(chave, resposta) {
      await db.integrationRequest.update({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: chave } },
        data: { status: "COMPLETED", responseStatus: resposta.status, responseBody: resposta.body as never, lastError: null },
      });
    },
    async falhar(chave) {
      await db.integrationRequest.deleteMany({ where: { tenantId, idempotencyKey: chave, status: "PROCESSING" } });
    },
  };
}

export class ContratoLojasInvalido extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message);
    this.name = "ContratoLojasInvalido";
  }
}

export async function cotarPedido(tenantId: string, pedido: CotacaoLojas) {
  const { db } = paraEmpresa(tenantId);
  const cliente = await db.client.findUnique({ where: { tenantId_cnpj: { tenantId, cnpj: pedido.cliente.documento } }, select: { id: true } });
  const carga = resumirCarga(pedido);
  let valor = 0;
  let prazoHoras = 0;
  let detalhes: unknown = { modalidade: pedido.modalidade, cobrancaTms: false };

  if (pedido.modalidade === "CIF") {
    const tabela = await tabelaVigente(db, cliente?.id);
    if (!tabela) throw new ContratoLojasInvalido("Nenhuma tabela de frete vigente.");
    const frete = calcularFrete(tabela, `${pedido.destino.cidade} - ${pedido.destino.uf}`, {
      peso: carga.pesoKg, volumes: carga.volumes, metrosCubicos: carga.cubagemM3, valorNota: pedido.valorNota,
    });
    if (!frete.atendida) throw new ContratoLojasInvalido("Destino não atendido pela tabela de frete.");
    valor = frete.valor;
    prazoHoras = frete.prazoHoras;
    detalhes = { ...frete, modalidade: pedido.modalidade, cobrancaTms: true };
  }

  const ordem = await db.logisticsOrder.create({
    data: { externalId: pedido.externalId, clientId: cliente?.id, mode: pedido.modalidade, payload: pedido as never, quote: detalhes as never, quotedAmount: valor, quotedDeadline: prazoHoras },
    select: { id: true, externalId: true, mode: true, state: true, quotedAmount: true, quotedDeadline: true, quote: true },
  });
  return { ...ordem, carga };
}

export async function confirmarPedido(tenantId: string, pedido: CotacaoLojas) {
  const { transacao } = paraEmpresa(tenantId);
  return transacao(async (tx) => {
    const cliente = await tx.client.findUnique({ where: { tenantId_cnpj: { tenantId, cnpj: pedido.cliente.documento } }, select: { id: true } });
    if (!cliente) throw new ContratoLojasInvalido("Cliente não cadastrado.");
    const ordem = await tx.logisticsOrder.findUnique({ where: { tenantId_externalId: { tenantId, externalId: pedido.externalId } } });
    if (!ordem) throw new ContratoLojasInvalido("A cotação deve ser criada antes da confirmação.", 404);
    if (ordem.state !== "QUOTED") throw new ContratoLojasInvalido("Pedido já confirmado ou encerrado.", 409);

    const criaCarga = pedido.modalidade === "CIF" || pedido.modalidade === "FOB";
    for (const origem of criaCarga ? pedido.origens : []) {
      const carga = origem.volumes.reduce((total, volume) => ({
        volumes: total.volumes + volume.quantidade,
        peso: total.peso + volume.pesoKg * volume.quantidade,
        cubagem: total.cubagem + volume.comprimentoCm * volume.larguraCm * volume.alturaCm * volume.quantidade / 1_000_000,
      }), { volumes: 0, peso: 0, cubagem: 0 });
      const collection = await tx.collection.create({ data: {
        clientId: cliente.id, sender: origem.nome, receiver: pedido.cliente.nome,
        origin: `${origem.cidade} - ${origem.uf}`, destination: `${pedido.destino.cidade} - ${pedido.destino.uf}`,
        volumes: carga.volumes, weight: carga.peso, cubicMeters: carga.cubagem, invoiceValue: pedido.valorNota,
        status: "PENDING", trackingCode: generateTrackingCode(),
      } });
      await tx.logisticsShipment.create({ data: {
        orderId: ordem.id, collectionId: collection.id, externalId: `${pedido.externalId}:${origem.id}`,
        originKey: origem.id, promisedAt: ordem.quotedDeadline ? new Date(Date.now() + ordem.quotedDeadline * 3_600_000) : null,
      } });
    }
    return tx.logisticsOrder.update({
      where: { id: ordem.id }, data: { state: criaCarga ? "CONFIRMED" : "DELIVERED" },
      include: { shipments: { include: { collection: { select: { id: true, trackingCode: true } } } } },
    });
  });
}

const estadosEmCurso = new Set(["CONFIRMED", "COLLECTED", "ROUTE"]);

export async function consultarPedido(tenantId: string, externalId: string) {
  const { db } = paraEmpresa(tenantId);
  const ordem = await db.logisticsOrder.findUnique({
    where: { tenantId_externalId: { tenantId, externalId } },
    include: { shipments: { include: { collection: { include: {
      statusHistory: { orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, createdAt: true } },
      occurrences: { select: { id: true, number: true, status: true, title: true, createdAt: true } },
      proof: { select: { id: true, status: true, receiverName: true, receiverDoc: true, createdAt: true, reviewedAt: true, photos: { where: { replacedAt: null }, select: { kind: true, sha256: true, createdAt: true } } } },
    } } } } },
  });
  if (!ordem) throw new ContratoLojasInvalido("Pedido não encontrado.", 404);
  const agora = Date.now();
  return {
    id: ordem.externalId, modalidade: ordem.mode, direcao: ordem.direction, estado: ordem.state,
    rma: ordem.rma, cotacao: { valor: ordem.quotedAmount, prazoHoras: ordem.quotedDeadline },
    remessas: ordem.shipments.map((remessa) => ({
      id: remessa.externalId, estado: remessa.collection?.status ?? remessa.state,
      rastreio: remessa.collection?.trackingCode ?? null,
      sla: remessa.promisedAt ? { prometidoEm: remessa.promisedAt, atrasado: agora > remessa.promisedAt.getTime() && remessa.collection?.status !== "DELIVERED" } : null,
      ocorrencias: remessa.collection?.occurrences ?? [], historico: remessa.collection?.statusHistory ?? [], comprovante: remessa.collection?.proof ?? null,
    })),
    inspecao: ordem.inspection,
  };
}

export async function cancelarPedido(tenantId: string, externalId: string) {
  const { transacao } = paraEmpresa(tenantId);
  return transacao(async (tx) => {
    const ordem = await tx.logisticsOrder.findUnique({ where: { tenantId_externalId: { tenantId, externalId } }, include: { shipments: { include: { collection: { select: { id: true, status: true, manifestId: true } } } } } });
    if (!ordem) throw new ContratoLojasInvalido("Pedido não encontrado.", 404);
    if (ordem.state === "CANCELLED") return { externalId, state: "CANCELLED" };
    if (ordem.shipments.some((item) => item.collection?.manifestId || (item.collection && estadosEmCurso.has(item.collection.status)))) {
      throw new ContratoLojasInvalido("Pedido já iniciou a operação e não pode ser cancelado.", 409);
    }
    const ids = ordem.shipments.flatMap((item) => item.collection ? [item.collection.id] : []);
    if (ids.length) await tx.collection.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED" } });
    await tx.logisticsOrder.update({ where: { id: ordem.id }, data: { state: "CANCELLED", cancelledAt: new Date() } });
    await tx.outboxEvent.create({ data: { type: "lojas.ordem.cancelada", payload: { externalId }, dedupeKey: `lojas:${ordem.id}:cancelada` } });
    return { externalId, state: "CANCELLED" };
  });
}

export async function criarReversa(tenantId: string, dados: { externalId: string; pedidoOriginal: string; rma: string }) {
  const { transacao } = paraEmpresa(tenantId);
  return transacao(async (tx) => {
    const original = await tx.logisticsOrder.findUnique({ where: { tenantId_externalId: { tenantId, externalId: dados.pedidoOriginal } }, include: { client: { select: { id: true } } } });
    if (!original) throw new ContratoLojasInvalido("Pedido original não encontrado.", 404);
    const payload = original.payload as unknown as CotacaoLojas;
    const ordem = await tx.logisticsOrder.create({ data: { externalId: dados.externalId, clientId: original.clientId, mode: original.mode, state: "CONFIRMED", direction: "REVERSE", rma: dados.rma, reverseOfId: original.id, payload: dados as never } });
    const carga = resumirCarga(payload);
    if (!original.clientId) throw new ContratoLojasInvalido("Pedido original sem cliente cadastrado.", 409);
    const collection = await tx.collection.create({ data: {
      clientId: original.clientId!, sender: payload.cliente.nome, receiver: payload.origens[0].nome,
      origin: `${payload.destino.cidade} - ${payload.destino.uf}`, destination: `${payload.origens[0].cidade} - ${payload.origens[0].uf}`,
      volumes: carga.volumes, weight: carga.pesoKg, cubicMeters: carga.cubagemM3,
      trackingCode: generateTrackingCode(), status: "PENDING",
    } });
    await tx.logisticsShipment.create({ data: { orderId: ordem.id, collectionId: collection.id, externalId: `${dados.externalId}:reversa`, originKey: "reversa" } });
    return { externalId: ordem.externalId, rma: ordem.rma, trackingCode: collection.trackingCode };
  });
}

export async function inspecionarReversa(tenantId: string, externalId: string, dados: { decisao: string; observacao?: string }) {
  const { db } = paraEmpresa(tenantId);
  const ordem = await db.logisticsOrder.findUnique({ where: { tenantId_externalId: { tenantId, externalId } }, select: { id: true, direction: true, inspectedAt: true } });
  if (!ordem || ordem.direction !== "REVERSE") throw new ContratoLojasInvalido("Ordem reversa não encontrada.", 404);
  if (ordem.inspectedAt) throw new ContratoLojasInvalido("A inspeção final já foi registrada.", 409);
  return db.logisticsOrder.update({ where: { id: ordem.id }, data: { inspection: dados as never, inspectedAt: new Date(), state: "DELIVERED" }, select: { externalId: true, rma: true, inspection: true, inspectedAt: true } });
}

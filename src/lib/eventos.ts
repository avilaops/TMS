import { createHmac, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { sistema } from "@/lib/prisma";
import { conferirEnderecoPublico } from "@/lib/url-publica";
import { TENTATIVAS } from "@/lib/mensageria";
import { RECEBEDOR_SELECT, pixCopiaECola, pixDoTitulo, recebedorDaEmpresa, txidDaFatura } from "@/lib/pix";
import { enviarPushPendentes } from "@/lib/notificacoes-push";
import { cobrancasEmAberto } from "@/lib/cobranca-gateway";
import { conferirCobrancasEmAberto } from "@/lib/cobranca-gateway-db";
import { localizarEnderecosPendentes } from "@/lib/geo-db";

/**
 * Entrega dos eventos (OutboxEvent) no endereço que cada empresa cadastrou.
 *
 * Quem cria o evento de status é o gatilho do banco (prisma/sql/010-rls.sql),
 * na transação da troca; os de chamado nascem na rota, também na transação da
 * mudança (src/lib/ocorrencias-db.ts). Aqui só se entrega: o despachante pega um lote, marca
 * a tentativa antes de enviar (queda no meio não repete na hora nem perde o
 * evento) e, se der errado, tenta de novo em 1, 2, 4... minutos, até
 * `TENTATIVAS` vezes.
 *
 * Roda com o cliente de sistema: o despachante atende todas as empresas.
 */

// O limite de tentativas mora em src/lib/mensageria.ts, que a tela também lê.
export { TENTATIVAS };
const LOTE = 20;
const TEMPO_LIMITE_MS = 8_000;

export const novoSegredo = () => randomBytes(24).toString("base64url");

/** Assinatura que vai no cabeçalho `X-TMS-Assinatura`: HMAC-SHA256 do corpo, em hexadecimal. */
export const assinar = (segredo: string, corpo: string) => `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;

type Pendente = { id: string; tenantId: string; type: string; payload: Prisma.JsonValue; attempts: number; createdAt: Date };

const texto = (valor: unknown) => (typeof valor === "string" ? valor : null);

/**
 * O que vai em `dados`. O evento de status guarda só os ids; os detalhes são
 * lidos na hora da entrega, para o destino não precisar consultar o TMS.
 */
const CLIENTE = { id: true, companyName: true, tradeName: true, cnpj: true, contactName: true, email: true, phone: true } as const;

type ClienteDoEvento = { id: string; companyName: string; tradeName: string | null; cnpj: string; contactName: string | null; email: string | null; phone: string | null };

const cliente = (c: ClienteDoEvento | null) =>
  c && { id: c.id, nome: c.tradeName || c.companyName, cnpj: c.cnpj, contato: c.contactName, email: c.email, telefone: c.phone };

// Vencimento é um dia do calendário, gravado à meia-noite UTC.
const dia = (data: Date | null) => (data ? data.toISOString().slice(0, 10) : null);

const enderecoPublico = () => (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");

/** O recebedor do Pix da empresa do evento, ou `null` sem chave cadastrada. */
async function recebedorDoEvento(evento: Pendente) {
  const empresa = await sistema.tenant.findUnique({ where: { id: evento.tenantId }, select: RECEBEDOR_SELECT });
  return recebedorDaEmpresa(empresa);
}

async function dadosDaFatura(evento: Pendente, payload: Record<string, unknown>) {
  const invoiceId = texto(payload.invoiceId);
  const fatura = invoiceId
    ? await sistema.invoice.findFirst({
        where: { id: invoiceId, tenantId: evento.tenantId },
        select: { id: true, number: true, status: true, total: true, dueDate: true, issuedAt: true, paidAt: true, client: { select: CLIENTE }, _count: { select: { collections: true } } },
      })
    : null;
  // Só no aviso de emissão, com a fatura ainda em aberto, e se a empresa tem chave.
  const emitidaEmAberto = fatura && evento.type === "fatura.emitida" && fatura.status === "OPEN" && fatura.total > 0;
  const recebedor = emitidaEmAberto ? await recebedorDoEvento(evento) : null;
  // Cobrança do Mercado Pago em aberto (Pix dinâmico e boleto), quando já foi gerada.
  const emAberto = emitidaEmAberto
    ? cobrancasEmAberto(
        await sistema.paymentCharge.findMany({
          where: { invoiceId: fatura.id, tenantId: evento.tenantId, status: "PENDING" },
          select: { kind: true, status: true, createdAt: true, pixCode: true, ticketUrl: true, digitableLine: true, expiresAt: true },
        }),
      )
    : null;
  const estatico = recebedor && fatura ? pixCopiaECola({ ...recebedor, valor: fatura.total, txid: txidDaFatura(fatura.number) }) : null;
  // O Pix dinâmico, quando existe, entra no lugar do estático: é o que dá baixa sozinho.
  const copiaECola = emAberto?.pix?.pixCode ?? estatico;
  return {
    fatura: fatura && {
      id: fatura.id,
      numero: fatura.number,
      status: fatura.status,
      total: fatura.total,
      vencimento: dia(fatura.dueDate),
      emitidaEm: fatura.issuedAt.toISOString(),
      pagaEm: fatura.paidAt?.toISOString() ?? null,
      cargas: fatura._count.collections,
      cliente: cliente(fatura.client),
      // Onde o cliente consulta as faturas dele, depois de entrar.
      portal: `${enderecoPublico()}/portal/faturas`,
      // Pix Copia e Cola: o dinâmico do Mercado Pago (pagar dá baixa sozinho) quando há
      // cobrança em aberto; senão o estático da chave da empresa (a baixa é manual).
      ...(copiaECola && { pixCopiaECola: copiaECola }),
      // A cobrança em aberto no Mercado Pago, com o link de cada meio.
      ...((emAberto?.pix || emAberto?.boleto) && {
        cobranca: {
          pix: emAberto.pix && { copiaECola: emAberto.pix.pixCode, link: emAberto.pix.ticketUrl, venceEm: emAberto.pix.expiresAt.toISOString() },
          boleto: emAberto.boleto && { link: emAberto.boleto.ticketUrl, linhaDigitavel: emAberto.boleto.digitableLine, venceEm: emAberto.boleto.expiresAt.toISOString() },
        },
      }),
    },
  };
}

async function dadosDoTituloVencido(evento: Pendente, payload: Record<string, unknown>) {
  const transactionId = texto(payload.transactionId);
  const titulo = transactionId
    ? await sistema.financialTransaction.findFirst({
        where: { id: transactionId, tenantId: evento.tenantId },
        select: { id: true, description: true, amount: true, dueDate: true, status: true, counterparty: true, client: { select: CLIENTE }, invoice: { select: { id: true, number: true } } },
      })
    : null;
  const pix = titulo && titulo.status === "PENDING" ? pixDoTitulo(await recebedorDoEvento(evento), { id: titulo.id, amount: titulo.amount, invoice: titulo.invoice }) : null;
  return {
    titulo: titulo && {
      id: titulo.id,
      descricao: titulo.description,
      valor: titulo.amount,
      vencimento: dia(titulo.dueDate),
      // Dias de atraso na hora da entrega; o título pode ter sido pago entre o aviso nascer e sair.
      diasDeAtraso: titulo.dueDate ? Math.max(0, Math.floor((Date.now() - titulo.dueDate.getTime()) / 86_400_000)) : 0,
      emAberto: titulo.status === "PENDING",
      fatura: titulo.invoice && { id: titulo.invoice.id, numero: titulo.invoice.number },
      cliente: cliente(titulo.client),
      pagador: titulo.client ? null : titulo.counterparty,
      // Pix Copia e Cola estático do título em aberto, se a empresa tem chave: a baixa segue manual.
      ...(pix && { pixCopiaECola: pix }),
    },
  };
}

async function dadosDaOcorrencia(evento: Pendente, payload: Record<string, unknown>) {
  const occurrenceId = texto(payload.occurrenceId);
  const ocorrencia = occurrenceId
    ? await sistema.occurrence.findFirst({
        where: { id: occurrenceId, tenantId: evento.tenantId },
        select: {
          id: true,
          number: true,
          type: true,
          title: true,
          status: true,
          priority: true,
          origin: true,
          openedAt: true,
          client: { select: CLIENTE },
          collection: { select: { id: true, trackingCode: true, receiver: true, destination: true, client: { select: CLIENTE } } },
        },
      })
    : null;
  if (!ocorrencia) return { ocorrencia: null };

  const base = enderecoPublico();
  const carga = ocorrencia.collection;
  return {
    ocorrencia: {
      id: ocorrencia.id,
      numero: ocorrencia.number,
      tipo: ocorrencia.type,
      titulo: ocorrencia.title,
      // O status de agora: o chamado pode ter andado entre o aviso nascer e sair.
      status: ocorrencia.status,
      prioridade: ocorrencia.priority,
      // CLIENT = aberto no portal; STAFF = aberto pela equipe ou pelo motorista.
      abertaPor: ocorrencia.origin,
      abertaEm: ocorrencia.openedAt.toISOString(),
      // O chamado do motorista não tem cliente próprio: vale o dono da carga.
      cliente: cliente(ocorrencia.client ?? carga?.client ?? null),
      carga: carga && {
        id: carga.id,
        destinatario: carga.receiver,
        destino: carga.destination,
        rastreio: carga.trackingCode && {
          codigo: carga.trackingCode,
          link: `${base}/rastreio?cnpj=${carga.client.cnpj}&codigo=${carga.trackingCode}`,
        },
      },
      // Onde a equipe abre o chamado, depois de entrar.
      painel: `${base}/dashboard/ocorrencias/${ocorrencia.id}`,
    },
  };
}

async function dadosDoEvento(evento: Pendente): Promise<Record<string, unknown>> {
  const payload = (evento.payload ?? {}) as Record<string, unknown>;
  if (evento.type.startsWith("fatura.")) return dadosDaFatura(evento, payload);
  if (evento.type.startsWith("ocorrencia.")) return dadosDaOcorrencia(evento, payload);
  if (evento.type === "cobranca.vencida") return dadosDoTituloVencido(evento, payload);
  if (evento.type !== "coleta.status") return payload;

  const collectionId = texto(payload.collectionId);
  const coleta = collectionId
    ? await sistema.collection.findFirst({
        where: { id: collectionId, tenantId: evento.tenantId },
        select: {
          id: true,
          status: true,
          trackingCode: true,
          sender: true,
          receiver: true,
          origin: true,
          destination: true,
          volumes: true,
          weight: true,
          freightValue: true,
          client: { select: CLIENTE },
          driver: { select: { id: true, phone: true, user: { select: { name: true } } } },
        },
      })
    : null;

  const base = enderecoPublico();
  return {
    de: texto(payload.de),
    para: texto(payload.para),
    coleta: coleta && {
      id: coleta.id,
      status: coleta.status,
      remetente: coleta.sender,
      destinatario: coleta.receiver,
      origem: coleta.origin,
      destino: coleta.destination,
      volumes: coleta.volumes,
      peso: coleta.weight,
      frete: coleta.freightValue,
      rastreio: coleta.trackingCode && {
        codigo: coleta.trackingCode,
        link: `${base}/rastreio?cnpj=${coleta.client.cnpj}&codigo=${coleta.trackingCode}`,
      },
      cliente: cliente(coleta.client),
      motorista: coleta.driver && { id: coleta.driver.id, nome: coleta.driver.user.name, telefone: coleta.driver.phone },
    },
  };
}

async function entregar(evento: Pendente): Promise<string | null> {
  const webhook = await sistema.webhook.findUnique({
    where: { tenantId: evento.tenantId },
    select: { url: true, secret: true, tenant: { select: { id: true, slug: true, name: true } } },
  });
  // A empresa tirou o endereço depois de o evento nascer: não há para onde mandar.
  if (!webhook) return "Endereço removido.";

  // O DNS pode ter mudado desde que o endereço foi salvo.
  const destino = await conferirEnderecoPublico(webhook.url);
  if (!destino.ok) return destino.erro;

  const corpo = JSON.stringify({
    id: evento.id,
    tipo: evento.type,
    criadoEm: evento.createdAt.toISOString(),
    empresa: { id: webhook.tenant.id, slug: webhook.tenant.slug, nome: webhook.tenant.name },
    dados: await dadosDoEvento(evento),
  });

  try {
    const res = await fetch(destino.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "TMS-Avila-Ops",
        "X-TMS-Evento": evento.type,
        "X-TMS-Entrega": evento.id,
        "X-TMS-Assinatura": assinar(webhook.secret, corpo),
      },
      body: corpo,
      // Redirecionamento poderia levar a um endereço interno depois da conferência.
      redirect: "manual",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    return res.status >= 200 && res.status < 300 ? null : `Resposta ${res.status}`;
  } catch (erro) {
    return erro instanceof Error && erro.name === "TimeoutError" ? "Sem resposta no tempo limite." : "Não foi possível conectar.";
  }
}

/**
 * Entrega um lote de eventos pendentes. Devolve quantos saíram e quantos falharam.
 * `FOR UPDATE SKIP LOCKED` deixa dois despachantes rodarem ao mesmo tempo sem
 * mandar o mesmo evento duas vezes.
 */
export async function despacharPendentes(): Promise<{ entregues: number; falhas: number }> {
  const lote = await sistema.$queryRaw<Pendente[]>(Prisma.sql`
    UPDATE "OutboxEvent" e
       SET attempts = e.attempts + 1,
           "nextAttemptAt" = now() + make_interval(mins => (2 ^ e.attempts)::int)
     WHERE e.id IN (
       SELECT id FROM "OutboxEvent"
        WHERE "deliveredAt" IS NULL AND "nextAttemptAt" <= now() AND attempts < ${TENTATIVAS}
        ORDER BY "createdAt"
        LIMIT ${LOTE}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING e.id, e."tenantId", e.type, e.payload, e.attempts, e."createdAt"`);

  let entregues = 0;
  let falhas = 0;
  // Em ordem de criação: o destino recebe "coletado" antes de "entregue".
  for (const evento of lote.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const erro = await entregar(evento).catch(() => "Erro inesperado ao entregar.");
    await sistema.outboxEvent.update({
      where: { id: evento.id },
      data: erro === null ? { deliveredAt: new Date(), lastError: null } : { lastError: erro },
    });
    if (erro === null) entregues += 1;
    else falhas += 1;
  }
  return { entregues, falhas };
}

/**
 * Põe na fila um aviso para cada título a receber que venceu e segue em
 * aberto, nas empresas com endereço cadastrado. Um aviso por título e por
 * vencimento: a chave repetida é ignorada, então rodar de novo não repete. Se o
 * vencimento for alterado e vencer outra vez, sai um aviso novo.
 */
export async function avisarTitulosVencidos(): Promise<number> {
  return sistema.$executeRaw(Prisma.sql`
    INSERT INTO "OutboxEvent" (id, "tenantId", type, payload, "createdAt", "nextAttemptAt", attempts, "dedupeKey")
    SELECT gen_random_uuid()::text, t."tenantId", 'cobranca.vencida', jsonb_build_object('transactionId', t.id), now(), now(), 0,
           'cobranca.vencida:' || t.id || ':' || to_char(t."dueDate", 'YYYY-MM-DD')
      FROM "FinancialTransaction" t
      JOIN "Webhook" w ON w."tenantId" = t."tenantId"
     WHERE t.type = 'INCOME' AND t.status = 'PENDING' AND t."dueDate" IS NOT NULL
       -- Vence no fim do dia, pelo relógio do Brasil; o vencimento é um dia do calendário.
       AND t."dueDate"::date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
    ON CONFLICT ("dedupeKey") DO NOTHING`);
}

const INTERVALO_MS = 15_000;
// A procura por título vencido e a conferência das cobranças do Mercado Pago rodam a cada 40 voltas do despachante (10 minutos).
const VOLTAS_ENTRE_VARREDURAS = 40;
// O Next recarrega módulos em desenvolvimento: o relógio fica no global para não duplicar.
const global = globalThis as { tmsDespachante?: ReturnType<typeof setInterval> };

/**
 * Liga o despachante dentro do servidor (src/instrumentation.ts): a cada volta
 * entrega os eventos para sistemas de fora, manda por push os avisos das
 * pessoas (src/lib/notificacoes-push.ts) e, à parte, procura a coordenada de
 * alguns endereços de entrega (src/lib/geo-db.ts).
 */
export function iniciarDespacho(): void {
  if (global.tmsDespachante) return;
  let rodando = false;
  let localizando = false;
  let voltas = 0;
  global.tmsDespachante = setInterval(() => {
    // A localização de endereços corre à parte, com a própria trava e o próprio
    // `catch`: depende de um serviço de fora (Nominatim), que pode demorar ou
    // cair, e não pode segurar nem derrubar eventos, cobranças e push. Sem
    // `GEO_CONTATO` a volta não faz nada.
    if (!localizando) {
      localizando = true;
      localizarEnderecosPendentes()
        .then((volta) => {
          if (volta.erro) console.error("Localização de endereços em pausa por 10 minutos:", volta.erro);
        })
        .catch((erro) => console.error("Erro ao localizar endereços de entrega:", erro instanceof Error ? erro.message : "erro desconhecido"))
        .finally(() => {
          localizando = false;
        });
    }

    if (rodando) return;
    rodando = true;
    const varrer = voltas % VOLTAS_ENTRE_VARREDURAS === 0;
    voltas += 1;
    (varrer ? avisarTitulosVencidos() : Promise.resolve(0))
      .then(() => despacharPendentes())
      .catch((erro) => console.error("Erro ao despachar eventos:", erro))
      // Na mesma cadência da varredura de vencidos (10 minutos): as cobranças em aberto
      // no Mercado Pago são conferidas, para o caso de um aviso de pagamento não ter chegado.
      .then(() => (varrer ? conferirCobrancasEmAberto() : 0))
      .catch((erro) => console.error("Erro ao conferir cobranças no Mercado Pago:", erro instanceof Error ? erro.message : "erro desconhecido"))
      // Os avisos das pessoas (sininho) saem por push na mesma volta; um erro
      // nos eventos de fora não segura o push, nem o contrário.
      .then(() => enviarPushPendentes())
      .catch((erro) => console.error("Erro ao enviar avisos por push:", erro))
      .finally(() => {
        rodando = false;
      });
  }, INTERVALO_MS);
  global.tmsDespachante.unref();
}

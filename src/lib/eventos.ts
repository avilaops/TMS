import { createHmac, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { sistema } from "@/lib/prisma";
import { conferirEnderecoPublico } from "@/lib/url-publica";

/**
 * Entrega dos eventos (OutboxEvent) no endereço que cada empresa cadastrou.
 *
 * Quem cria o evento de status é o gatilho do banco (prisma/sql/010-rls.sql),
 * na transação da troca. Aqui só se entrega: o despachante pega um lote, marca
 * a tentativa antes de enviar (queda no meio não repete na hora nem perde o
 * evento) e, se der errado, tenta de novo em 1, 2, 4... minutos, até
 * `TENTATIVAS` vezes.
 *
 * Roda com o cliente de sistema: o despachante atende todas as empresas.
 */

export const TENTATIVAS = 8;
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
async function dadosDoEvento(evento: Pendente): Promise<Record<string, unknown>> {
  const payload = (evento.payload ?? {}) as Record<string, unknown>;
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
          client: { select: { id: true, companyName: true, tradeName: true, cnpj: true, contactName: true, email: true, phone: true } },
          driver: { select: { id: true, phone: true, user: { select: { name: true } } } },
        },
      })
    : null;

  const base = (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
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
      cliente: {
        id: coleta.client.id,
        nome: coleta.client.tradeName || coleta.client.companyName,
        cnpj: coleta.client.cnpj,
        contato: coleta.client.contactName,
        email: coleta.client.email,
        telefone: coleta.client.phone,
      },
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

const INTERVALO_MS = 15_000;
// O Next recarrega módulos em desenvolvimento: o relógio fica no global para não duplicar.
const global = globalThis as { tmsDespachante?: ReturnType<typeof setInterval> };

/** Liga o despachante dentro do servidor (src/instrumentation.ts). */
export function iniciarDespacho(): void {
  if (global.tmsDespachante) return;
  let rodando = false;
  global.tmsDespachante = setInterval(() => {
    if (rodando) return;
    rodando = true;
    despacharPendentes()
      .catch((erro) => console.error("Erro ao despachar eventos:", erro))
      .finally(() => {
        rodando = false;
      });
  }, INTERVALO_MS);
  global.tmsDespachante.unref();
}

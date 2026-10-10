import webpush from "web-push";
import { Prisma } from "@prisma/client";
import { sistema } from "@/lib/prisma";

/**
 * Envio dos avisos por push (Web Push) para os aparelhos em que a pessoa
 * ativou as notificações. Só o servidor importa este arquivo.
 *
 * O despachante (src/lib/eventos.ts, a cada 15 s) chama `enviarPushPendentes`:
 * pega um lote de avisos ainda não enviados (`pushedAt` nulo), marca antes de
 * enviar e manda para cada aparelho do destinatário. É uma tentativa por aviso
 * e por aparelho: o aviso continua no sininho de qualquer jeito, e repetir
 * push atrasado só incomoda. O serviço de push dizer que a inscrição não
 * existe mais (404 ou 410) apaga a inscrição.
 *
 * Sem as três variáveis `VAPID_*` o push fica desligado: nada é enviado, a
 * rota da chave diz que está desligado e só o sininho funciona.
 *
 * Roda com o cliente de sistema: o despachante atende todas as empresas. Cada
 * aviso só vai para as inscrições do próprio destinatário, na empresa dele.
 */

export type ConfiguracaoDoPush = { publicKey: string; privateKey: string; subject: string };

const BASE64_DE_URL = /^[A-Za-z0-9_-]+$/;
const bytes = (chave: string) => (BASE64_DE_URL.test(chave) ? Buffer.from(chave, "base64url").length : 0);

/**
 * As chaves VAPID do ambiente, ou `null` se falta alguma ou alguma não tem o
 * formato certo (chave pública de 65 bytes, privada de 32, as duas em base64
 * de URL; contato começando com `mailto:` ou `https://`).
 */
export function configuracaoDoPush(env: Record<string, string | undefined> = process.env): ConfiguracaoDoPush | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (bytes(publicKey) !== 65 || bytes(privateKey) !== 32) return null;
  if (!/^(mailto:.+@.+|https:\/\/.+)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** A chave pública que o navegador usa para se inscrever, ou `null` com o push desligado. */
export const chavePublicaDoPush = () => configuracaoDoPush()?.publicKey ?? null;

const LOTE = 50;
const TEMPO_LIMITE_MS = 8_000;
// Quanto tempo o serviço de push guarda o aviso para um aparelho desligado.
const VALIDADE_SEGUNDOS = 24 * 60 * 60;
// Aviso mais velho do que isto não vai por push (o servidor ficou parado): segue só no sininho.
const IDADE_MAXIMA_MS = 60 * 60 * 1000;

type Pendente = { id: string; tenantId: string; userId: string; title: string; body: string; url: string; readAt: Date | null; createdAt: Date };

/** O que o aparelho recebe: public/sw.js lê estes campos. */
export const corpoDoPush = (aviso: Pick<Pendente, "id" | "title" | "body" | "url">) =>
  JSON.stringify({ id: aviso.id, titulo: aviso.title, texto: aviso.body, url: aviso.url });

/** A inscrição não existe mais no serviço de push do navegador? */
const inscricaoMorta = (erro: unknown) => {
  const status = (erro as { statusCode?: unknown } | null)?.statusCode;
  return status === 404 || status === 410;
};

/**
 * Envia por push um lote de avisos pendentes. Devolve quantos envios saíram,
 * quantos falharam e quantas inscrições mortas foram apagadas.
 * `FOR UPDATE SKIP LOCKED` deixa dois despachantes rodarem ao mesmo tempo sem
 * mandar o mesmo aviso duas vezes.
 */
export async function enviarPushPendentes(agora: Date = new Date()): Promise<{ enviados: number; falhas: number; apagadas: number }> {
  const resultado = { enviados: 0, falhas: 0, apagadas: 0 };
  const config = configuracaoDoPush();
  if (!config) return resultado;

  const lote = await sistema.$queryRaw<Pendente[]>(Prisma.sql`
    UPDATE "Notification" n
       SET "pushedAt" = now()
     WHERE n.id IN (
       SELECT id FROM "Notification"
        WHERE "pushedAt" IS NULL
        ORDER BY "createdAt"
        LIMIT ${LOTE}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING n.id, n."tenantId", n."userId", n.title, n.body, n.url, n."readAt", n."createdAt"`);

  for (const aviso of lote.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    // Já lido no sininho, ou velho demais: não há por que tocar o celular.
    if (aviso.readAt || agora.getTime() - aviso.createdAt.getTime() > IDADE_MAXIMA_MS) continue;

    const aparelhos = await sistema.pushSubscription.findMany({
      where: { userId: aviso.userId, tenantId: aviso.tenantId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });

    for (const aparelho of aparelhos) {
      try {
        await webpush.sendNotification({ endpoint: aparelho.endpoint, keys: { p256dh: aparelho.p256dh, auth: aparelho.auth } }, corpoDoPush(aviso), {
          vapidDetails: config,
          TTL: VALIDADE_SEGUNDOS,
          timeout: TEMPO_LIMITE_MS,
        });
        resultado.enviados += 1;
      } catch (erro) {
        if (inscricaoMorta(erro)) {
          await sistema.pushSubscription.deleteMany({ where: { id: aparelho.id } });
          resultado.apagadas += 1;
        } else {
          // Não repete: o aviso já está no sininho.
          resultado.falhas += 1;
        }
      }
    }
  }
  return resultado;
}

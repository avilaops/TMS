// Tipos do que o TMS usa do pacote `web-push` (src/lib/notificacoes-push.ts).
// O pacote não traz tipos, e a única dependência nova do módulo é ele mesmo.
declare module "web-push" {
  export type Inscricao = { endpoint: string; keys: { p256dh: string; auth: string } };

  export type Opcoes = {
    vapidDetails?: { subject: string; publicKey: string; privateKey: string };
    /** Segundos que o serviço de push guarda a mensagem para o aparelho desligado. */
    TTL?: number;
    /** Tempo limite da chamada, em milissegundos. */
    timeout?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
  };

  export type Resultado = { statusCode: number; body: string; headers: Record<string, string> };

  /** Rejeita com um erro que traz `statusCode` quando o serviço de push recusa. */
  export function sendNotification(inscricao: Inscricao, corpo?: string | Buffer | null, opcoes?: Opcoes): Promise<Resultado>;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };

  const webpush: { sendNotification: typeof sendNotification; generateVAPIDKeys: typeof generateVAPIDKeys };
  export default webpush;
}

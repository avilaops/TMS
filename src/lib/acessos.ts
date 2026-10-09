import { randomBytes } from "node:crypto";

/**
 * Acesso da pessoa ao TMS no login único (auth.avilaops.com).
 *
 * O TMS não tem senha: ter cadastro aqui só vale para quem tem conta no auth e
 * foi liberado para o app. Em vez de alguém abrir o painel de lá a cada pessoa
 * nova, o TMS pede ao auth (`/api/provisionamento/acessos`), autenticado com o
 * mesmo cliente OIDC do login.
 *
 * Falha aqui não desfaz o cadastro: a pessoa fica cadastrada, o operador é
 * avisado e pode tentar de novo em "Liberar acesso".
 */

/**
 * O que aconteceu com o e-mail do convite, como o login único contou. Só
 * `enviado` é sucesso; os outros dizem por que a mensagem não saiu, e a tela
 * precisa mostrar cada um: reduzir a "não enviado" esconderia a falha de quem
 * clicou em "Liberar acesso" justamente para reenviar.
 */
export const ENVIOS = ["enviado", "nao_pedido", "sem_email", "limite", "falhou"] as const;
export type Envio = (typeof ENVIOS)[number];

export type Acesso =
  /**
   * `envio`: o resultado do e-mail (ver `Envio`). `convite`: o endereço de uso
   * único para criar a senha, que só volta quando o e-mail não saiu e a conta é
   * nova. `entrada`: o endereço público do TMS, para alguém mandar à mão quando
   * o e-mail não saiu e não há endereço de senha (conta que já existia).
   */
  | { ok: true; contaNova: boolean; envio: Envio; convite: string | null; entrada: string | null }
  | { ok: false; erro: string };

/** Resposta sem `envio`, ou com valor que este código não conhece, conta como falha: nunca como enviado. */
function envioDe(valor: unknown): Envio {
  return (ENVIOS as readonly unknown[]).includes(valor) ? (valor as Envio) : "falhou";
}

export type SituacaoDoConvite = "ENVIADO" | "FALHOU" | "PENDENTE";

/**
 * O que fica no cadastro da pessoa depois de pedir o acesso: a situação do
 * convite, o motivo em uma frase e quando. Nunca o endereço de criar a senha.
 */
export function dadosDoConvite(acesso: Acesso, agora: Date = new Date()): { inviteStatus: SituacaoDoConvite; inviteDetail: string; inviteAt: Date } {
  const base = { inviteAt: agora };
  if (!acesso.ok) return { ...base, inviteStatus: "FALHOU", inviteDetail: acesso.erro.slice(0, 300) };
  if (acesso.envio === "enviado") {
    return {
      ...base,
      inviteStatus: "ENVIADO",
      inviteDetail: acesso.contaNova ? "com o endereço para criar a senha" : "a pessoa já tinha conta Ávila Ops e entra com a senha que já usa",
    };
  }
  // O acesso foi liberado; o que falta é a pessoa ficar sabendo.
  return { ...base, inviteStatus: "PENDENTE", inviteDetail: `acesso liberado, mas o e-mail não saiu: ${POR_QUE_NAO_SAIU[acesso.envio]}` };
}

const POR_QUE_NAO_SAIU: Record<Exclude<Envio, "enviado">, string> = {
  nao_pedido: "o envio não foi pedido",
  sem_email: "o login único está sem envio de e-mail configurado",
  limite: "muitos convites para este e-mail na última hora",
  falhou: "o envio do e-mail falhou",
};

/** Quem convida e de qual empresa, para a pessoa reconhecer a mensagem. */
export type Convidante = { empresa?: string | null; convidadoPor?: string | null };

function configuracao() {
  const base = (process.env.AVILAOPS_ISSUER || "https://auth.avilaops.com").replace(/\/+$/, "");
  const id = process.env.AVILAOPS_CLIENT_ID || "tms";
  const segredo = process.env.AVILAOPS_CLIENT_SECRET;
  if (!segredo) return null;
  const publico = (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
  return {
    entrada: publico ? `${publico}/login` : null,
    url: `${base}/api/provisionamento/acessos`,
    authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(segredo)}`).toString("base64")}`,
  };
}

const SEM_RESPOSTA = "Não foi possível falar com o login único agora.";

export async function liberarAcesso(pessoa: {
  email: string;
  nome: string;
  cpf?: string | null;
  telefone?: string | null;
}, convidante: Convidante = {}): Promise<Acesso> {
  const cfg = configuracao();
  if (!cfg) return { ok: false, erro: "Login único não configurado neste ambiente." };

  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { authorization: cfg.authorization, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        email: pessoa.email,
        nome: pessoa.nome,
        ...(pessoa.cpf && { cpf: pessoa.cpf }),
        ...(pessoa.telefone && { telefone: pessoa.telefone }),
        // O TMS não tem caixa de e-mail: quem escreve para a pessoa é o login
        // único, e o endereço de criar a senha vai direto à caixa dela.
        enviarConvite: true,
        ...(convidante.empresa && { empresa: convidante.empresa }),
        ...(convidante.convidadoPor && { convidadoPor: convidante.convidadoPor }),
        // Criada a senha, a pessoa cai na entrada do TMS, que já abre a sessão.
        ...(cfg.entrada && { destino: cfg.entrada }),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const corpo = (await res.json().catch(() => ({}))) as { criada?: boolean; convite?: string | null; envio?: string; error?: string };

    if (!res.ok) {
      console.error(`Login único recusou a liberação (${res.status}):`, corpo.error);
      // 409 traz mensagem para o operador (conta desligada, CPF de outra conta).
      return { ok: false, erro: res.status === 409 && corpo.error ? corpo.error : SEM_RESPOSTA };
    }

    return {
      ok: true,
      contaNova: corpo.criada === true,
      envio: envioDe(corpo.envio),
      convite: typeof corpo.convite === "string" ? corpo.convite : null,
      entrada: cfg.entrada,
    };
  } catch (error) {
    console.error("Login único: falha ao liberar acesso:", error);
    return { ok: false, erro: SEM_RESPOSTA };
  }
}

/** Revoga a liberação do TMS para o e-mail. A conta no auth continua existindo. */
export async function revogarAcesso(email: string): Promise<boolean> {
  const cfg = configuracao();
  if (!cfg) return false;

  try {
    const res = await fetch(`${cfg.url}?email=${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { authorization: cfg.authorization, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`Login único recusou a revogação (${res.status}).`);
    return res.ok;
  } catch (error) {
    console.error("Login único: falha ao revogar acesso:", error);
    return false;
  }
}

/**
 * Valor da coluna `password`, que ainda é obrigatória no banco. Não é um hash
 * de nada: o TMS não tem login por senha e nenhum código compara este campo.
 */
export function senhaSemUso(): string {
  return `sem-senha:${randomBytes(24).toString("base64url")}`;
}

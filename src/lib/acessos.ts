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

export type Acesso =
  /** `convite`: link de uso único para a pessoa definir a senha. Só vem para conta criada agora. */
  | { ok: true; contaNova: boolean; convite: string | null }
  | { ok: false; erro: string };

function configuracao() {
  const base = (process.env.AVILAOPS_ISSUER || "https://auth.avilaops.com").replace(/\/+$/, "");
  const id = process.env.AVILAOPS_CLIENT_ID || "tms";
  const segredo = process.env.AVILAOPS_CLIENT_SECRET;
  if (!segredo) return null;
  return {
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
}): Promise<Acesso> {
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
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const corpo = (await res.json().catch(() => ({}))) as { criada?: boolean; convite?: string | null; error?: string };

    if (!res.ok) {
      console.error(`Login único recusou a liberação (${res.status}):`, corpo.error);
      // 409 traz mensagem para o operador (conta desligada, CPF de outra conta).
      return { ok: false, erro: res.status === 409 && corpo.error ? corpo.error : SEM_RESPOSTA };
    }

    return {
      ok: true,
      contaNova: corpo.criada === true,
      convite: typeof corpo.convite === "string" ? corpo.convite : null,
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

import { signOut } from "next-auth/react";
import { esquecerAparelhoAoSair } from "@/lib/push-cliente";

const SSO_URL = "https://auth.avilaops.com";
const SSO_APP = "tms";

/**
 * Sai do TMS e do login único.
 *
 * Encerrar só a sessão daqui não bastaria: a tela de login manda para o auth,
 * que ainda teria sessão e devolveria a pessoa para dentro. O logout de lá é
 * um POST (apaga o cookie de todos os sistemas) e devolve para
 * `/login?saiu=1`, que não tenta entrar de novo.
 *
 * Antes de tudo, o aparelho deixa de receber por push os avisos de quem está
 * saindo (src/lib/push-cliente.ts): precisa ser com a sessão ainda aberta.
 */
export async function sair() {
  await esquecerAparelhoAoSair();
  await signOut({ redirect: false });

  const volta = `${window.location.origin}/login?saiu=1`;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${SSO_URL}/api/auth/logout?app=${SSO_APP}&returnTo=${encodeURIComponent(volta)}`;
  document.body.appendChild(form);
  form.submit();
}

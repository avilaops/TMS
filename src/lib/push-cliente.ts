/**
 * O lado do navegador das notificações push: registrar o service worker da
 * área, inscrever e desinscrever o aparelho. Só a tela importa este arquivo
 * (src/components/notificacoes/Sininho.tsx).
 *
 * Um aparelho recebe os avisos de uma pessoa só. Quem ativou fica anotado no
 * `localStorage` (`DONO`): ao abrir o sistema, a inscrição só é reafirmada no
 * servidor se quem está logado é quem ativou; e ao sair, a inscrição é apagada
 * do servidor (`esquecerAparelhoAoSair`), para o aparelho não seguir recebendo
 * avisos de quem saiu.
 */

export type Area = "dashboard" | "portal" | "driver";

const SW = "/sw.js";

/**
 * O escopo do service worker de cada área (public/sw.js). O do motorista é o
 * da raiz, que já existia para o modo offline; os do painel e do portal ficam
 * presos à própria área e só recebem push.
 */
export const ESCOPO_DO_SW: Record<Area, string> = { driver: "/", dashboard: "/dashboard", portal: "/portal" };

const DONO = "tms:push:dono";
const ROTA = "/api/notificacoes/aparelho";
const TEMPO_PARA_ATIVAR_MS = 10_000;
const TEMPO_PARA_ESQUECER_MS = 3_000;

/* --------------------------------- Situação --------------------------------- */

export type SituacaoDoPush =
  | "carregando"
  /** iPhone ou iPad com o sistema aberto no Safari: push só existe no app da Tela de Início. */
  | "iphone-sem-instalar"
  | "sem-suporte"
  /** O servidor não tem as chaves VAPID. */
  | "desligado"
  /** A pessoa (ou o navegador) negou a permissão. */
  | "bloqueado"
  | "inativo"
  | "ativo";

export type AmbienteDoPush = {
  suporte: boolean;
  iphone: boolean;
  /** Aberto como app, a partir da Tela de Início. */
  instalado: boolean;
  permissao: "default" | "granted" | "denied";
};

/** Decide o que o sininho mostra. `chave` é a pública do servidor (nula = push desligado). */
export function situacaoDoPush(ambiente: AmbienteDoPush, chave: string | null, inscrito: boolean): SituacaoDoPush {
  if (!chave) return "desligado";
  if (ambiente.iphone && !ambiente.instalado) return "iphone-sem-instalar";
  if (!ambiente.suporte) return "sem-suporte";
  if (ambiente.permissao === "denied") return "bloqueado";
  return inscrito && ambiente.permissao === "granted" ? "ativo" : "inativo";
}

/** O que o sininho diz em cada situação que não tem botão. */
export const MENSAGEM_DO_PUSH: Partial<Record<SituacaoDoPush, string>> = {
  "iphone-sem-instalar":
    "No iPhone, as notificações só funcionam com o sistema na Tela de Início: toque em Compartilhar, depois em “Adicionar à Tela de Início”, e abra por lá.",
  "sem-suporte": "Este navegador não recebe notificações. Os avisos continuam aparecendo aqui no sininho.",
  bloqueado: "As notificações estão bloqueadas para este site. Libere nas configurações do navegador e toque no sininho de novo.",
};

export const ERRO_AO_ATIVAR = "Não foi possível ativar as notificações. Tente de novo.";
export const PERMISSAO_NEGADA = "Sem a permissão do navegador não dá para avisar neste aparelho.";

export function ehIphone(userAgent: string, pontosDeToque = 0): boolean {
  // O iPad se apresenta como Mac; o que o entrega é a tela de toque.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && pontosDeToque > 1);
}

/** O que este navegador oferece, lido na hora. */
export function ambienteDoPush(): AmbienteDoPush {
  const suporte = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return {
    suporte,
    iphone: typeof navigator !== "undefined" && ehIphone(navigator.userAgent, navigator.maxTouchPoints),
    instalado:
      typeof window !== "undefined" &&
      ((navigator as Navigator & { standalone?: boolean }).standalone === true || Boolean(window.matchMedia?.("(display-mode: standalone)").matches)),
    permissao: suporte ? Notification.permission : "default",
  };
}

/** A chave pública (base64 de URL) no formato que `pushManager.subscribe` pede. */
export function chaveEmBytes(chave: string): Uint8Array<ArrayBuffer> {
  const base64 = chave.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(chave.length / 4) * 4, "=");
  const binario = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/* ------------------------------ Service worker ------------------------------ */

const escopoCompleto = (area: Area) => new URL(ESCOPO_DO_SW[area], window.location.origin).href;

/** O registro desta área, se já existe. Não cria. */
async function registroDaArea(area: Area): Promise<ServiceWorkerRegistration | null> {
  const registros = await navigator.serviceWorker.getRegistrations();
  return registros.find((registro) => registro.scope === escopoCompleto(area)) ?? null;
}

/** Registra o service worker da área (se faltar) e espera ele ficar ativo. */
async function registrarSw(area: Area): Promise<ServiceWorkerRegistration> {
  const registro = await navigator.serviceWorker.register(SW, { scope: ESCOPO_DO_SW[area] });
  if (registro.active) return registro;

  const novo = registro.installing ?? registro.waiting;
  if (!novo) return registro;
  await new Promise<void>((pronto, falhou) => {
    const limite = setTimeout(() => falhou(new Error(ERRO_AO_ATIVAR)), TEMPO_PARA_ATIVAR_MS);
    novo.addEventListener("statechange", () => {
      if (novo.state !== "activated") return;
      clearTimeout(limite);
      pronto();
    });
  });
  return registro;
}

async function inscricaoDoAparelho(area: Area): Promise<PushSubscription | null> {
  const registro = await registroDaArea(area);
  return registro ? registro.pushManager.getSubscription() : null;
}

/* --------------------------------- Servidor --------------------------------- */

const lembrarDono = (userId: string | null) => {
  try {
    if (userId) window.localStorage.setItem(DONO, userId);
    else window.localStorage.removeItem(DONO);
  } catch {
    // Navegação privada pode não ter `localStorage`: o push funciona, só não é reafirmado ao abrir.
  }
};

const donoLembrado = () => {
  try {
    return window.localStorage.getItem(DONO);
  } catch {
    return null;
  }
};

async function gravarNoServidor(inscricao: PushSubscription): Promise<void> {
  const res = await fetch(ROTA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inscricao.toJSON()) });
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(corpo?.error ?? ERRO_AO_ATIVAR);
  }
}

const apagarDoServidor = (endpoint: string, aoSair = false) =>
  fetch(ROTA, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
    // Na saída a página está indo embora: o pedido precisa sobreviver a ela.
    keepalive: aoSair,
  });

/* ----------------------------------- Ações ---------------------------------- */

/**
 * Ao abrir o sistema: este aparelho está inscrito para quem está logado? Se
 * foi essa pessoa que ativou, reafirma a inscrição no servidor (ela pode ter
 * sido apagada na saída). Não pede permissão nem cria nada.
 */
export async function conferirPush(area: Area, userId: string): Promise<boolean> {
  if (Notification.permission !== "granted" || donoLembrado() !== userId) return false;
  const inscricao = await inscricaoDoAparelho(area);
  if (!inscricao) return false;
  await gravarNoServidor(inscricao);
  return true;
}

/**
 * Ativa o push neste aparelho. Só pode ser chamada no toque da pessoa: é aqui
 * que o navegador pergunta se ela permite. Lança um erro com a mensagem para a tela.
 */
export async function ativarPush(area: Area, chave: string, userId: string): Promise<void> {
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") throw new Error(PERMISSAO_NEGADA);

  const registro = await registrarSw(area);
  const opcoes = { userVisibleOnly: true, applicationServerKey: chaveEmBytes(chave) };
  let inscricao: PushSubscription;
  try {
    inscricao = await registro.pushManager.subscribe(opcoes);
  } catch {
    // Inscrição antiga feita com outra chave do servidor: sai e entra de novo.
    const antiga = await registro.pushManager.getSubscription();
    if (!antiga) throw new Error(ERRO_AO_ATIVAR);
    await antiga.unsubscribe();
    inscricao = await registro.pushManager.subscribe(opcoes);
  }

  await gravarNoServidor(inscricao);
  lembrarDono(userId);
}

/** Desliga o push neste aparelho: sai do serviço do navegador e do servidor. */
export async function desligarPush(area: Area): Promise<void> {
  lembrarDono(null);
  const inscricao = await inscricaoDoAparelho(area);
  if (!inscricao) return;
  await apagarDoServidor(inscricao.endpoint).catch(() => undefined);
  await inscricao.unsubscribe();
}

/**
 * Antes de sair do sistema (src/lib/sair.ts): tira do servidor as inscrições
 * deste navegador, para o aparelho não receber avisos de quem saiu. A
 * inscrição do navegador fica: quando a mesma pessoa entrar de novo, o
 * sininho a reafirma. Nunca lança: a saída não pode depender disto.
 */
export async function esquecerAparelhoAoSair(): Promise<void> {
  const esquecer = async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const registros = await navigator.serviceWorker.getRegistrations();
    for (const registro of registros) {
      const inscricao = await registro.pushManager.getSubscription();
      if (inscricao) await apagarDoServidor(inscricao.endpoint, true).catch(() => undefined);
    }
  };
  // Sem service worker ou sem rede, a saída segue; e não espera mais do que alguns segundos.
  const limite = new Promise<void>((seguir) => setTimeout(seguir, TEMPO_PARA_ESQUECER_MS));
  await Promise.race([esquecer().catch(() => undefined), limite]);
}

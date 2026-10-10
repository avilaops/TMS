import { INTERVALO_DE_ENVIO_MS } from "@/lib/posicao";

/**
 * Compartilhamento da localização no app do motorista. Só o navegador importa
 * este arquivo.
 *
 * O estado mora no módulo, não num componente: o motorista liga na tela da
 * viagem e continua ligado enquanto ele anda pelas outras telas do app (baixa,
 * despesas), porque trocar de tela não recarrega a página.
 *
 * O que o navegador permite, e o que não permite:
 * - a permissão só é pedida depois do toque no botão (`ligarGps`), nunca ao abrir a tela;
 * - a posição só chega com o app ABERTO na tela. Com a tela bloqueada ou o app
 *   em segundo plano o navegador para de avisar: não há rastreamento em segundo
 *   plano, e a tela diz isso ao motorista;
 * - desligar (`desligarGps`) para de ler e de enviar na hora.
 */

export type SituacaoDoGps = "desligado" | "pedindo" | "ligado" | "negado" | "indisponivel";

export type EstadoDoGps = {
  /** A viagem para a qual a posição está sendo enviada, ou `null`. */
  manifestId: string | null;
  situacao: SituacaoDoGps;
  /** A última posição lida do aparelho. */
  posicao: { lat: number; lon: number; precisao: number | null; em: number } | null;
  /** Quando o servidor aceitou a última posição. */
  enviadaEm: number | null;
  /** O aparelho não está conseguindo ler a posição (sem sinal de GPS). */
  semSinal: boolean;
};

export const GPS_DESLIGADO: EstadoDoGps = { manifestId: null, situacao: "desligado", posicao: null, enviadaEm: null, semSinal: false };

/** Posição lida há mais tempo que isto não é enviada como se fosse a de agora. */
const VELHA_DEMAIS_MS = 2 * 60_000;
const CHAVE_DA_SESSAO = "tms-gps-viagem";

let estado: EstadoDoGps = GPS_DESLIGADO;
let observador: number | null = null;
let relogio: ReturnType<typeof setInterval> | null = null;
const ouvintes = new Set<() => void>();

function mudar(parte: Partial<EstadoDoGps>): void {
  estado = { ...estado, ...parte };
  for (const ouvinte of ouvintes) ouvinte();
}

/** Para `useSyncExternalStore`: avisa a cada mudança do estado. */
export function assinarGps(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** O estado de agora. O objeto só muda quando algo muda. */
export const estadoDoGps = (): EstadoDoGps => estado;

function lembrar(manifestId: string | null): void {
  try {
    if (manifestId) sessionStorage.setItem(CHAVE_DA_SESSAO, manifestId);
    else sessionStorage.removeItem(CHAVE_DA_SESSAO);
  } catch {
    // Navegação privada pode recusar o armazenamento: o compartilhamento segue, só não é retomado depois de recarregar.
  }
}

function parar(): void {
  if (observador !== null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(observador);
  if (relogio !== null) clearInterval(relogio);
  observador = null;
  relogio = null;
}

/** Para de ler e de enviar a posição. */
export function desligarGps(situacao: SituacaoDoGps = "desligado"): void {
  parar();
  lembrar(null);
  mudar({ ...GPS_DESLIGADO, situacao });
}

/**
 * Manda a última posição lida para a viagem, agora. Também é chamada ao
 * registrar uma entrega. Devolve `true` se o servidor aceitou. Falha de rede
 * não desliga nada: a próxima volta tenta de novo.
 */
export async function enviarPosicaoAgora(): Promise<boolean> {
  const { manifestId, posicao } = estado;
  if (!manifestId || !posicao || Date.now() - posicao.em > VELHA_DEMAIS_MS) return false;
  try {
    const res = await fetch(`/api/driver/manifestos/${manifestId}/posicao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: posicao.lat, lon: posicao.lon, precisao: posicao.precisao }),
    });
    if (res.ok) {
      mudar({ enviadaEm: Date.now() });
      return true;
    }
    // A viagem foi finalizada (404), a sessão caiu (401) ou o cadastro parou (403): não há para onde mandar.
    if (res.status === 404 || res.status === 401 || res.status === 403) desligarGps();
    return false;
  } catch {
    return false;
  }
}

/**
 * Liga o compartilhamento para a viagem. É aqui que o navegador pede a
 * permissão, então só deve ser chamada a partir de um toque do motorista.
 */
export function ligarGps(manifestId: string): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    mudar({ ...GPS_DESLIGADO, situacao: "indisponivel" });
    return;
  }
  parar();
  mudar({ ...GPS_DESLIGADO, manifestId, situacao: "pedindo" });

  observador = navigator.geolocation.watchPosition(
    (lida) => {
      const primeira = estado.posicao === null;
      const precisao = Number.isFinite(lida.coords.accuracy) ? lida.coords.accuracy : null;
      mudar({ situacao: "ligado", semSinal: false, posicao: { lat: lida.coords.latitude, lon: lida.coords.longitude, precisao, em: Date.now() } });
      // A primeira posição sai na hora; as seguintes, pelo relógio.
      if (primeira) void enviarPosicaoAgora();
    },
    (falha) => {
      // 1 = PERMISSION_DENIED: o motorista negou (ou o aparelho bloqueia). O resto é falta de sinal: segue tentando.
      if (falha.code === 1) desligarGps("negado");
      else mudar({ semSinal: true });
    },
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
  );
  relogio = setInterval(() => void enviarPosicaoAgora(), INTERVALO_DE_ENVIO_MS);
  lembrar(manifestId);
}

/**
 * Depois de recarregar a página: religa sozinho só se o motorista tinha ligado
 * para esta viagem nesta sessão E a permissão já está concedida (não abre
 * pedido de permissão sem toque).
 */
export async function retomarGps(manifestId: string): Promise<void> {
  if (estado.situacao !== "desligado") return;
  try {
    if (sessionStorage.getItem(CHAVE_DA_SESSAO) !== manifestId) return;
    const permissao = await navigator.permissions?.query({ name: "geolocation" });
    if (permissao?.state === "granted" && estado.situacao === "desligado") ligarGps(manifestId);
  } catch {
    // Sem a API de permissões não dá para saber sem perguntar: fica desligado até o toque.
  }
}

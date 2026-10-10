import { z } from "zod";
import { distanciaKm, type Ponto } from "@/lib/roteiro";

/**
 * Posição do motorista (GPS do app): o que a rota aceita, quando um ponto entra
 * no histórico e como a tela diz "há quanto tempo". Puro: as telas importam.
 *
 * Privacidade, que atravessa o módulo:
 * - só existe posição enquanto o motorista deixa o compartilhamento ligado, com
 *   o app aberto e a viagem em rota (navegador não rastreia em segundo plano);
 * - só o painel lê (quem lê viagens). O rastreio público e o portal do cliente
 *   não recebem posição nenhuma: só o status, como sempre;
 * - não vai para a auditoria nem para os avisos enviados a sistemas de fora.
 */

/** De quanto em quanto tempo o app manda a posição. */
export const INTERVALO_DE_ENVIO_MS = 30_000;
/** Envios aceitos por minuto, por motorista: o app manda 2; a folga cobre a posição enviada junto da baixa. */
export const LIMITE_POR_MINUTO = 12;
/** Pontos guardados por viagem: passando disso, os mais antigos saem. */
export const MAXIMO_DE_PONTOS = 500;
/** O histórico é enxuto: ponto novo só entra se o caminhão andou isto... */
const ANDOU_METROS = 25;
/** ...ou se já passou este tempo desde o último guardado (parado também deixa rastro, de vez em quando). */
const PARADO_MS = 5 * 60_000;

const LAT_MESSAGE = "Latitude inválida.";
const LON_MESSAGE = "Longitude inválida.";
const PRECISAO_MESSAGE = "Precisão inválida.";
export const POSICAO_INVALIDA = "Posição inválida.";
export const POSICOES_DEMAIS = "Muitas posições em pouco tempo. Aguarde um instante.";

/** Corpo de `POST /api/driver/manifestos/[id]/posicao`. `precisao` é o raio de erro que o aparelho informa, em metros. */
export const posicaoSchema = z
  .object(
    {
      lat: z.number(LAT_MESSAGE).min(-90, LAT_MESSAGE).max(90, LAT_MESSAGE),
      lon: z.number(LON_MESSAGE).min(-180, LON_MESSAGE).max(180, LON_MESSAGE),
      precisao: z.number(PRECISAO_MESSAGE).min(0, PRECISAO_MESSAGE).max(100_000, PRECISAO_MESSAGE).nullish(),
    },
    "Dados inválidos.",
  )
  // 0,0 é o que aparelho sem sinal devolve: fica no meio do Atlântico.
  .refine((posicao) => !(posicao.lat === 0 && posicao.lon === 0), { message: POSICAO_INVALIDA });

export type PosicaoEnviada = z.infer<typeof posicaoSchema>;

/** A última posição como o painel recebe. */
export type PosicaoDoMotorista = Ponto & {
  /** Raio de erro informado pelo aparelho, em metros, ou `null`. */
  precisao: number | null;
  /** Quando chegou ao servidor. */
  em: string;
};

/** O ponto novo entra no histórico? Sem anterior, sempre; depois, só se andou ou se faz tempo. */
export function entraNoHistorico(ultimo: (Ponto & { recordedAt: Date }) | null, novo: Ponto, agora: Date): boolean {
  if (!ultimo) return true;
  if (agora.getTime() - ultimo.recordedAt.getTime() >= PARADO_MS) return true;
  return distanciaKm(ultimo, novo) * 1000 >= ANDOU_METROS;
}

/** "agora", "há 5 min", "há 2 h", "há 3 d": há quanto tempo a posição chegou. */
export function haQuantoTempo(em: Date | string, agora: number = Date.now()): string {
  const minutos = Math.floor((agora - new Date(em).getTime()) / 60_000);
  if (!Number.isFinite(minutos)) return "";
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}

/** A última posição de uma viagem, ou `null` se o motorista nunca compartilhou. */
export function ultimaPosicao(viagem: {
  lastLat?: number | null;
  lastLon?: number | null;
  lastAccuracy?: number | null;
  lastPositionAt?: Date | string | null;
}): PosicaoDoMotorista | null {
  if (typeof viagem.lastLat !== "number" || typeof viagem.lastLon !== "number" || !viagem.lastPositionAt) return null;
  return { lat: viagem.lastLat, lon: viagem.lastLon, precisao: viagem.lastAccuracy ?? null, em: new Date(viagem.lastPositionAt).toISOString() };
}

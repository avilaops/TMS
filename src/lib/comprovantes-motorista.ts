import { PERFIL_PADRAO, lerPerfil, type ComprovantesDoMotorista, type PerfilDeComprovante } from "@/lib/comprovantes";

/**
 * O que o aplicativo do motorista guarda no aparelho sobre comprovantes. Só a
 * tela importa este arquivo.
 *
 * O perfil da empresa (o que é obrigatório na baixa) é lido do servidor e
 * lembrado aqui: na porta do cliente o sinal costuma faltar, e a tela precisa
 * marcar o obrigatório mesmo assim. Quem impõe a regra continua sendo o
 * servidor; o que está no aparelho só orienta o motorista.
 */

const CHAVE_DO_PERFIL = "mello:perfil-do-comprovante";

// As telas abertas leem o perfil por `useSyncExternalStore`: quando o servidor
// informa um perfil novo, elas se atualizam sozinhas.
const ouvintes = new Set<() => void>();
// Para o aparelho com o armazenamento bloqueado: o perfil vale enquanto o app estiver aberto.
let naMemoria: PerfilDeComprovante | null = null;

export function assinarPerfil(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function lembrarPerfil(perfil: PerfilDeComprovante): void {
  naMemoria = perfil;
  try {
    localStorage.setItem(CHAVE_DO_PERFIL, perfil);
  } catch {
    // Armazenamento bloqueado: fica só na memória.
  }
  for (const ouvinte of ouvintes) ouvinte();
}

/** O último perfil que o servidor informou a este aparelho; sem nenhum, o padrão. */
export function perfilLembrado(): PerfilDeComprovante {
  if (naMemoria) return naMemoria;
  try {
    return lerPerfil(localStorage.getItem(CHAVE_DO_PERFIL));
  } catch {
    return PERFIL_PADRAO;
  }
}

/**
 * Lê `GET /api/driver/comprovantes` (perfil e comprovantes para refazer) e
 * lembra o perfil. Sem sinal, com erro ou com resposta que não é a esperada,
 * devolve `null`: quem chama segue com o perfil lembrado.
 */
export async function buscarComprovantesDoMotorista(fetcher: typeof fetch = fetch): Promise<ComprovantesDoMotorista | null> {
  try {
    const res = await fetcher("/api/driver/comprovantes", { cache: "no-store" });
    if (!res.ok) return null;
    const corpo = (await res.json()) as Partial<ComprovantesDoMotorista> | null;
    if (!corpo || typeof corpo.perfil !== "string" || !Array.isArray(corpo.refazer)) return null;
    const perfil = lerPerfil(corpo.perfil);
    lembrarPerfil(perfil);
    return { perfil, refazer: corpo.refazer };
  } catch {
    return null;
  }
}

/** A posição do aparelho agora, ou nulos: a falta dela nunca impede o registro. */
export async function posicaoDoAparelho(): Promise<{ latitude: number | null; longitude: number | null }> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { latitude: null, longitude: null };
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch {
    return { latitude: null, longitude: null };
  }
}

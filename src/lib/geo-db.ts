import { Prisma } from "@prisma/client";
import { sistema } from "@/lib/prisma";
import { chaveDoEndereco, type EnderecoParaLocalizar } from "@/lib/endereco";
import { configuracaoDoGeo, localizarNoNominatim, type ConfiguracaoDoGeo } from "@/lib/geo";
import { distanciaKm, localizarCidade, ufDoTexto, type IndiceDeCidades, type Ponto } from "@/lib/roteiro";
import { municipios } from "@/lib/municipios";

/**
 * Localização dos endereços de entrega em segundo plano: o cache (`GeoCache`) e
 * a volta que o despachante roda (src/lib/eventos.ts). Só o servidor importa
 * este arquivo.
 *
 * Nada aqui roda dentro da requisição de um usuário: a carga é gravada com o
 * endereço e sem coordenada (`geoSource` nulo), e a volta seguinte procura.
 * Enquanto não acha, e quando não acha, a ordem das entregas usa o centro da
 * cidade (src/lib/roteiro.ts).
 *
 * Roda com o cliente de sistema por dois motivos: a volta atende todas as
 * empresas, como o resto do despachante, e o `GeoCache` é do sistema, sem
 * `tenantId` (ver o comentário do modelo em prisma/schema.prisma). O que vai
 * para o cache e para o serviço é só o texto do endereço: nem empresa, nem
 * cliente, nem carga.
 */

/** Consultas ao serviço por volta do despachante (15 s): bem abaixo de uma por segundo. */
const CONSULTAS_POR_VOLTA = 2;
/** Cargas olhadas por volta: as que o cache resolve não gastam consulta. */
const CARGAS_POR_VOLTA = 10;
/** Depois de uma falha do serviço, quanto tempo sem consultar. */
const PAUSA_APOS_FALHA_MS = 10 * 60_000;
/**
 * Resultado a mais que isto do centro da cidade do destino é descartado: é rua
 * de mesmo nome em outro lugar, e pôr a entrega lá bagunçaria a ordem. O maior
 * município do Brasil em que se entrega de caminhão cabe com folga.
 */
export const LONGE_DEMAIS_KM = 100;

// O Next recarrega módulos em desenvolvimento: a pausa fica no global.
const global = globalThis as { tmsPausaDoGeo?: { ate: number } };
const pausa = (global.tmsPausaDoGeo ??= { ate: 0 });

/** Só os testes usam: tira a pausa que uma falha do serviço deixou. */
export function zerarPausaDoGeo(): void {
  pausa.ate = 0;
}

export type LocalizacaoComCache =
  | { ok: true; ponto: Ponto | null; doCache: boolean }
  | { ok: false; erro: string };

/**
 * Onde fica o endereço: primeiro o cache, depois o serviço (e o que ele
 * responder vai para o cache, inclusive "não achei"). Falha do serviço não é
 * guardada.
 */
export async function localizarComCache(endereco: EnderecoParaLocalizar, configuracao: ConfiguracaoDoGeo): Promise<LocalizacaoComCache> {
  const chave = chaveDoEndereco(endereco);
  // Sem logradouro, cidade ou UF não há pergunta a fazer.
  if (!chave) return { ok: true, ponto: null, doCache: true };

  const guardado = await sistema.geoCache.findUnique({ where: { key: chave }, select: { lat: true, lon: true } });
  if (guardado) {
    return { ok: true, ponto: guardado.lat !== null && guardado.lon !== null ? { lat: guardado.lat, lon: guardado.lon } : null, doCache: true };
  }

  const resposta = await localizarNoNominatim(endereco, configuracao);
  if (!resposta.ok) return resposta;

  // Duas voltas ao mesmo tempo (duas cópias do servidor) podem chegar aqui juntas: a segunda não muda nada.
  await sistema.geoCache.upsert({
    where: { key: chave },
    create: { key: chave, lat: resposta.ponto?.lat ?? null, lon: resposta.ponto?.lon ?? null },
    update: {},
  });
  return { ok: true, ponto: resposta.ponto, doCache: false };
}

export type VoltaDoGeo = {
  /** Cargas que ganharam coordenada do endereço. */
  localizadas: number;
  /** Cargas cujo endereço não foi achado: seguem pelo centro da cidade. */
  semResultado: number;
  /** Consultas feitas ao serviço nesta volta (o que veio do cache não conta). */
  consultas: number;
  /** A falha do serviço que interrompeu a volta, se houve. */
  erro: string | null;
};

const NADA: VoltaDoGeo = { localizadas: 0, semResultado: 0, consultas: 0, erro: null };

/**
 * Uma volta: procura a coordenada de algumas cargas que têm endereço e ainda
 * não foram procuradas, primeiro as que já estão em viagem.
 *
 * - Sem `GEO_CONTATO` não faz nada: as cargas ficam esperando e são procuradas
 *   quando a variável for definida.
 * - Falha do serviço interrompe a volta e deixa a localização em pausa por dez
 *   minutos: a carga fica como estava e entra de novo depois.
 * - Nunca lança por causa do serviço; erro de banco sobe para quem chamou (o
 *   despachante registra e segue com o resto).
 */
export async function localizarEnderecosPendentes({
  configuracao = configuracaoDoGeo(),
  indice = municipios(),
  agora = Date.now(),
}: { configuracao?: ConfiguracaoDoGeo | null; indice?: IndiceDeCidades; agora?: number } = {}): Promise<VoltaDoGeo> {
  if (!configuracao || pausa.ate > agora) return { ...NADA };

  const pendentes = await sistema.collection.findMany({
    where: { deliveryStreet: { not: null }, geoSource: null, status: { notIn: ["CANCELLED", "REJECTED", "DELIVERED"] } },
    select: { id: true, tenantId: true, origin: true, destination: true, deliveryStreet: true, deliveryNumber: true },
    orderBy: [{ manifestId: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: CARGAS_POR_VOLTA,
  });

  const volta: VoltaDoGeo = { ...NADA };
  for (const carga of pendentes) {
    if (volta.consultas >= CONSULTAS_POR_VOLTA) break;
    const rua = carga.deliveryStreet as string;

    // A cidade do destino diz onde procurar e confere o resultado. Nome repetido em vários estados: vale a UF da origem.
    const cidade = localizarCidade(carga.destination, indice, ufDoTexto(carga.origin));
    let ponto: Ponto | null = null;
    if (cidade) {
      const resposta = await localizarComCache({ rua, numero: carga.deliveryNumber, cidade: cidade.nome, uf: cidade.uf }, configuracao);
      if (!resposta.ok) {
        pausa.ate = agora + PAUSA_APOS_FALHA_MS;
        volta.erro = resposta.erro;
        break;
      }
      if (!resposta.doCache) volta.consultas += 1;
      ponto = resposta.ponto && distanciaKm(resposta.ponto, cidade) <= LONGE_DEMAIS_KM ? resposta.ponto : null;
    }

    // SQL direto para não mexer em `updatedAt` (a carga não foi alterada por ninguém) e
    // só se o endereço ainda é o que foi procurado: se alguém o corrigiu no meio, a
    // coordenada antiga não é gravada por cima e a carga volta para a fila.
    const gravadas = await sistema.$executeRaw(Prisma.sql`
      UPDATE "Collection"
         SET "deliveryLat" = ${ponto?.lat ?? null}, "deliveryLon" = ${ponto?.lon ?? null},
             "geoSource" = ${ponto ? "ADDRESS" : "NONE"}, "geoAt" = now()
       WHERE id = ${carga.id} AND "tenantId" = ${carga.tenantId} AND "geoSource" IS NULL
         AND "deliveryStreet" = ${rua}
         AND "deliveryNumber" IS NOT DISTINCT FROM ${carga.deliveryNumber}
         AND destination = ${carga.destination}`);
    if (gravadas === 0) continue;
    if (ponto) volta.localizadas += 1;
    else volta.semResultado += 1;
  }
  return volta;
}

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { perfisQuePodem, type Capacidade } from "@/lib/permissoes";
import { rotuloDaDespesa } from "@/lib/viagem";

/**
 * Avisos para as pessoas dentro do sistema (o sininho) e por push no navegador.
 *
 * Cada aviso é de uma pessoa (`Notification.userId`): só ela lê e marca como
 * lido. Quem cria é `avisar`, chamado na mesma transação da ação que causou o
 * aviso (ou ficam as duas gravações, ou nenhuma). A rota que grava sem
 * transação usa `avisarDepois`: ali a ação já valeu, e uma falha ao avisar não
 * pode virar erro para quem a fez.
 *
 * O push sai depois, pelo despachante (src/lib/notificacoes-push.ts).
 *
 * O texto do aviso para o cliente do portal só leva o que é dele: código de
 * rastreio, destinatário e destino da carga dele, número e vencimento da
 * fatura dele, número e título do chamado dele. Nunca valor de frete, nome de
 * outro cliente nem nota interna.
 *
 * Este arquivo não importa o cliente do banco: a tela o importa pelos textos.
 */

/* ----------------------------------- Tipos ----------------------------------- */

/** Todo aviso que o sistema gera. O texto da chave é estável. */
export const TIPOS_DE_AVISO = [
  // Motorista
  "viagem.liberada",
  "viagem.carga-retirada",
  // Cliente do portal
  "coleta.confirmada",
  "coleta.recusada",
  "coleta.em-rota",
  "coleta.entregue",
  "fatura.emitida",
  "chamado.resposta",
  // Equipe
  "coleta.pedida",
  "chamado.novo",
  "chamado.resposta-do-cliente",
  "comprovante.enviado",
  "despesa.lancada",
  "fatura.paga-pelo-gateway",
  "cobranca.a-conferir",
  "cte.autorizado",
  "cte.cancelado",
] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

export const TITULO_MAXIMO = 80;
export const TEXTO_MAXIMO = 200;
/** Avisos por página na lista do sininho. */
export const AVISOS_POR_PAGINA = 20;
/** De quanto em quanto tempo o sininho consulta o servidor. */
export const INTERVALO_DO_SININHO_MS = 60_000;

/** Corta o texto no limite, com reticências: título e texto do aviso cabem numa notificação do celular. */
export function cortar(texto: string, limite: number): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1).trimEnd()}…`;
}

/** Só caminho interno do sistema: começa com uma barra só. */
export function ehCaminhoInterno(url: unknown): url is string {
  return typeof url === "string" && /^\/(?!\/)/.test(url) && !url.includes("\\");
}

export type Aviso = {
  /** Usuário (ou usuários) que recebe. */
  para: string | readonly (string | null | undefined)[] | null | undefined;
  /** Quem fez a ação: nunca recebe o próprio aviso. */
  autor?: string | null;
  tipo: TipoDeAviso;
  titulo: string;
  texto: string;
  /** Caminho interno que o aviso abre. */
  url: string;
};

type Linha = { userId: string; type: string; title: string; body: string; url: string };

/** As linhas a gravar: uma por destinatário, sem repetir e sem o autor da ação. */
export function linhasDoAviso(aviso: Aviso): Linha[] {
  if (!ehCaminhoInterno(aviso.url)) throw new Error(`Aviso com endereço que não é interno: ${aviso.url}`);
  const lista = Array.isArray(aviso.para) ? aviso.para : [aviso.para];
  const destinatarios = [...new Set(lista.filter((id): id is string => typeof id === "string" && id !== "" && id !== aviso.autor))];
  return destinatarios.map((userId) => ({
    userId,
    type: aviso.tipo,
    title: cortar(aviso.titulo, TITULO_MAXIMO),
    body: cortar(aviso.texto, TEXTO_MAXIMO),
    url: aviso.url,
  }));
}

/* ---------------------------------- Gravação ---------------------------------- */

/** O cliente Prisma da empresa ou o cliente de uma transação: os dois servem. */
type AvisosDb = Pick<Prisma.TransactionClient, "notification">;
type PessoasDb = Pick<Prisma.TransactionClient, "user">;
type MotoristasDb = Pick<Prisma.TransactionClient, "driver">;

/** Grava o aviso para cada destinatário. Devolve quantos foram gravados. */
export async function avisar(db: AvisosDb, aviso: Aviso): Promise<number> {
  const linhas = linhasDoAviso(aviso);
  if (linhas.length === 0) return 0;
  const { count } = await db.notification.createMany({ data: linhas });
  return count;
}

/**
 * Para a rota que grava sem transação: avisa logo depois da gravação. A ação
 * já valeu; se o aviso falhar, o erro vai para o log do servidor e a resposta
 * da rota segue a mesma.
 */
export async function avisarDepois(oQue: string, avisos: () => Promise<unknown>): Promise<void> {
  try {
    await avisos();
  } catch (erro) {
    console.error(`Aviso não gravado (${oQue}):`, erro);
  }
}

/* -------------------------------- Destinatários ------------------------------- */

/** Os usuários da equipe que têm a capacidade (src/lib/permissoes.ts). */
export async function equipeQuePode(db: PessoasDb, capacidade: Capacidade): Promise<string[]> {
  const pessoas = await db.user.findMany({ where: { role: { in: perfisQuePodem(capacidade) } }, select: { id: true } });
  return pessoas.map((pessoa) => pessoa.id);
}

/** Os usuários do portal de cada cliente informado: cliente → ids dos usuários dele. */
export async function usuariosDosClientes(db: PessoasDb, clientIds: readonly string[]): Promise<Map<string, string[]>> {
  const porCliente = new Map<string, string[]>();
  const ids = [...new Set(clientIds)];
  if (ids.length === 0) return porCliente;
  const pessoas = await db.user.findMany({ where: { role: "CLIENT", clientId: { in: ids } }, select: { id: true, clientId: true } });
  for (const pessoa of pessoas) {
    if (!pessoa.clientId) continue;
    porCliente.set(pessoa.clientId, [...(porCliente.get(pessoa.clientId) ?? []), pessoa.id]);
  }
  return porCliente;
}

/** O usuário do motorista, ou `null` se o cadastro não existe. */
export async function usuarioDoMotorista(db: MotoristasDb, driverId: string): Promise<string | null> {
  const motorista = await db.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  return motorista?.userId ?? null;
}

/* ------------------------------ Textos dos avisos ----------------------------- */

type Conteudo = Pick<Aviso, "tipo" | "titulo" | "texto" | "url">;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// Vencimento é um dia do calendário, gravado à meia-noite UTC.
const diaDoCalendario = (data: Date) => data.toISOString().slice(0, 10).split("-").reverse().join("/");

const caminhoDaViagem = (manifestId: string) => `/driver/viagem/${manifestId}`;

/** Motorista: a viagem dele foi liberada. */
export const avisoDeViagemLiberada = (manifestId: string, entregas: number): Conteudo => ({
  tipo: "viagem.liberada",
  titulo: "Viagem liberada",
  texto: `Sua viagem saiu com ${plural(entregas, "entrega", "entregas")}. Toque para ver a rota.`,
  url: caminhoDaViagem(manifestId),
});

/** Motorista: uma carga saiu da viagem que ele já está fazendo. */
export const avisoDeCargaRetirada = (manifestId: string, carga: { receiver: string; destination: string }): Conteudo => ({
  tipo: "viagem.carga-retirada",
  titulo: "Entrega retirada da viagem",
  texto: `A entrega para ${carga.receiver} (${carga.destination}) saiu da sua viagem.`,
  url: caminhoDaViagem(manifestId),
});

export type CargaDoAviso = { id: string; trackingCode: string | null; receiver: string; destination: string };

// Status que o cliente fica sabendo, com o título do aviso. `CONFIRMED` só
// avisa quando vem de um pedido (`PENDING`): a carga criada pelo painel já
// nasce confirmada e não passa por aqui.
const STATUS_PARA_O_CLIENTE: Record<string, { tipo: TipoDeAviso; titulo: string; frase: string }> = {
  CONFIRMED: { tipo: "coleta.confirmada", titulo: "Coleta confirmada", frase: "Seu pedido de coleta foi confirmado" },
  REJECTED: { tipo: "coleta.recusada", titulo: "Coleta recusada", frase: "Seu pedido de coleta foi recusado" },
  ROUTE: { tipo: "coleta.em-rota", titulo: "Saiu para entrega", frase: "Sua carga saiu para entrega" },
  DELIVERED: { tipo: "coleta.entregue", titulo: "Carga entregue", frase: "Sua carga foi entregue" },
};

/** Cliente do portal: o aviso da troca de status da carga dele, ou `null` se a troca não interessa a ele. */
export function avisoDeStatus(troca: { fromStatus: string | null; toStatus: string }, carga: CargaDoAviso): Conteudo | null {
  if (!Object.hasOwn(STATUS_PARA_O_CLIENTE, troca.toStatus)) return null;
  if (troca.toStatus === "CONFIRMED" && troca.fromStatus !== "PENDING") return null;
  const { tipo, titulo, frase } = STATUS_PARA_O_CLIENTE[troca.toStatus];
  const codigo = carga.trackingCode ? ` (${carga.trackingCode})` : "";
  return {
    tipo,
    titulo,
    texto: `${frase}: ${carga.receiver}, ${carga.destination}${codigo}.`,
    url: `/portal/coletas/${carga.id}`,
  };
}

/** Cliente do portal: fatura nova. Sem o valor: ele está na tela de faturas. */
export const avisoDeFatura = (fatura: { number: number; dueDate: Date; cargas: number }): Conteudo => ({
  tipo: "fatura.emitida",
  titulo: `Fatura nº ${fatura.number} emitida`,
  texto: `${plural(fatura.cargas, "carga", "cargas")}, vencimento em ${diaDoCalendario(fatura.dueDate)}.`,
  url: "/portal/faturas",
});

type ChamadoDoAviso = { id: string; number: number; title: string };

/** Cliente do portal: a transportadora respondeu no atendimento dele. Só o título do chamado, nunca a mensagem. */
export const avisoDeRespostaAoCliente = (chamado: ChamadoDoAviso): Conteudo => ({
  tipo: "chamado.resposta",
  titulo: `Resposta no atendimento nº ${chamado.number}`,
  texto: chamado.title,
  url: `/portal/atendimento/${chamado.id}`,
});

/** Equipe: pedido de coleta novo pelo portal. */
export const avisoDePedidoDeColeta = (pedido: { cliente: string; origin: string; destination: string }): Conteudo => ({
  tipo: "coleta.pedida",
  titulo: "Novo pedido de coleta",
  texto: `${pedido.cliente}: ${pedido.origin} → ${pedido.destination}.`,
  url: "/dashboard/coletas/pendentes",
});

/** Equipe: chamado novo aberto pelo cliente (portal) ou pelo motorista. */
export const avisoDeChamadoNovo = (chamado: ChamadoDoAviso, quem: "cliente" | "motorista"): Conteudo => ({
  tipo: "chamado.novo",
  titulo: `Chamado nº ${chamado.number} aberto pelo ${quem}`,
  texto: chamado.title,
  url: `/dashboard/ocorrencias/${chamado.id}`,
});

/** Equipe: o cliente respondeu num chamado. */
export const avisoDeRespostaDoCliente = (chamado: ChamadoDoAviso): Conteudo => ({
  tipo: "chamado.resposta-do-cliente",
  titulo: `Cliente respondeu no chamado nº ${chamado.number}`,
  texto: chamado.title,
  url: `/dashboard/ocorrencias/${chamado.id}`,
});

/** Equipe: o motorista deu baixa e mandou o comprovante. */
export const avisoDeComprovante = (carga: { id: string; receiver: string; destination: string }, recebedor: string): Conteudo => ({
  tipo: "comprovante.enviado",
  titulo: "Comprovante de entrega para conferir",
  texto: `${carga.receiver}, ${carga.destination}. Recebido por ${recebedor}.`,
  url: `/dashboard/entregas/${carga.id}/comprovante`,
});

/** Equipe do financeiro: o motorista lançou uma despesa na viagem. */
export const avisoDeDespesa = (despesa: { type: string; amount: number }, motorista: string): Conteudo => ({
  tipo: "despesa.lancada",
  titulo: "Despesa de viagem para aprovar",
  texto: `${motorista} lançou ${rotuloDaDespesa(despesa.type).toLowerCase()} de ${despesa.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`,
  url: "/dashboard/manifestos",
});

/** Equipe (financeiro): o Mercado Pago avisou o pagamento e a fatura recebeu a baixa sozinha. */
export const avisoDeFaturaPagaPeloGateway = (fatura: { id: string; number: number }, tipo: "PIX" | "BOLETO"): Conteudo => ({
  tipo: "fatura.paga-pelo-gateway",
  titulo: `Fatura nº ${fatura.number} paga por ${tipo === "PIX" ? "Pix" : "boleto"}`,
  texto: "O Mercado Pago avisou o pagamento e a baixa foi dada.",
  url: `/dashboard/faturamento/${fatura.id}`,
});

/** Equipe (financeiro): o Mercado Pago disse algo que o sistema não aplica sozinho. */
export const avisoDeCobrancaAConferir = (fatura: { id: string; number: number }, motivo: string): Conteudo => ({
  tipo: "cobranca.a-conferir",
  titulo: `Fatura nº ${fatura.number}: cobrança a conferir`,
  texto: motivo,
  url: `/dashboard/faturamento/${fatura.id}`,
});

/** Equipe (quem lê o fiscal): a SEFAZ autorizou, ou registrou o cancelamento de, um CT-e emitido pelo sistema. */
export const avisoDeCte = (oQue: "autorizado" | "cancelado", cte: { numero: number; ambiente: string; carga: string | null }): Conteudo => ({
  tipo: `cte.${oQue}`,
  titulo: `CT-e nº ${cte.numero} ${oQue}${cte.ambiente === "PRODUCAO" ? "" : " (homologação)"}`,
  texto: `${oQue === "autorizado" ? "A SEFAZ autorizou o CT-e" : "A SEFAZ registrou o cancelamento do CT-e"} da carga ${cte.carga ?? "sem código"}.`,
  url: "/dashboard/fiscal/cte",
});

/* ----------------------- Avisos que as rotas compartilham ---------------------- */

type TrocaDeStatus = { collectionId: string; fromStatus: string | null; toStatus: string };

/**
 * Avisa os usuários do portal de cada cliente sobre a troca de status da carga
 * dele (coleta confirmada ou recusada, saiu para entrega, entregue). Roda na
 * transação da troca. Cada cliente recebe só o aviso das cargas dele.
 */
export async function avisarStatusAoCliente(
  tx: Pick<Prisma.TransactionClient, "notification" | "user" | "collection">,
  trocas: readonly TrocaDeStatus[],
  autor: string | null,
): Promise<void> {
  const relevantes = trocas.filter((troca) => Object.hasOwn(STATUS_PARA_O_CLIENTE, troca.toStatus));
  if (relevantes.length === 0) return;

  const cargas = await tx.collection.findMany({
    where: { id: { in: relevantes.map((troca) => troca.collectionId) } },
    select: { id: true, trackingCode: true, receiver: true, destination: true, clientId: true },
  });
  const porCliente = await usuariosDosClientes(tx, cargas.map((carga) => carga.clientId));

  for (const troca of relevantes) {
    const carga = cargas.find((c) => c.id === troca.collectionId);
    const conteudo = carga && avisoDeStatus(troca, carga);
    if (!carga || !conteudo) continue;
    await avisar(tx, { ...conteudo, para: porCliente.get(carga.clientId) ?? [], autor });
  }
}

/** Avisa quem da equipe tem a capacidade. Roda na transação (ou com o cliente da empresa) de quem chama. */
export async function avisarEquipe(db: AvisosDb & PessoasDb, capacidade: Capacidade, conteudo: Conteudo, autor: string | null): Promise<void> {
  await avisar(db, { ...conteudo, para: await equipeQuePode(db, capacidade), autor });
}

/* ---------------------------------- Leitura ---------------------------------- */

export const AVISO_SELECT = { id: true, type: true, title: true, body: true, url: true, createdAt: true, readAt: true } as const;

/** O aviso como a rota devolve e o sininho mostra. */
export type AvisoDaLista = { id: string; type: string; title: string; body: string; url: string; createdAt: string; readAt: string | null };
export type PaginaDeAvisos = { avisos: AvisoDaLista[]; naoLidos: number; proximo: string | null };

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** Há quanto tempo o aviso chegou: "agora", "há 5 min", "há 3 h", "há 2 d" e, depois de uma semana, a data. */
export function haQuantoTempo(quando: string | Date, agora: Date = new Date()): string {
  const data = new Date(quando);
  const passou = agora.getTime() - data.getTime();
  if (Number.isNaN(passou)) return "";
  if (passou < MINUTO) return "agora";
  if (passou < HORA) return `há ${Math.floor(passou / MINUTO)} min`;
  if (passou < DIA) return `há ${Math.floor(passou / HORA)} h`;
  if (passou < 7 * DIA) return `há ${Math.floor(passou / DIA)} d`;
  return data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
}

/** O número no sininho: até 99, depois "99+". Zero não aparece. */
export const contadorDoSininho = (naoLidos: number) => (naoLidos <= 0 ? "" : naoLidos > 99 ? "99+" : String(naoLidos));

/* --------------------------------- Validação --------------------------------- */

const INVALIDO = "Dados inválidos.";
const ID = z.string(INVALIDO).trim().min(1, INVALIDO).max(64, INVALIDO);

/** `?cursor=` da lista. */
export const paginaDeAvisosSchema = z.object({ cursor: ID.optional() }, INVALIDO);

/** Marcar como lido: `{ todas: true }` ou `{ ids: [...] }` (um ou vários). */
export const lidasSchema = z.union(
  [
    z.object({ todas: z.literal(true, INVALIDO) }, INVALIDO).strict(),
    z
      .object(
        { ids: z.array(ID, "Informe os avisos a marcar.").min(1, "Informe os avisos a marcar.").max(100, "Marque até 100 avisos por vez.") },
        INVALIDO,
      )
      .strict(),
  ],
  "Informe os avisos a marcar ou `todas`.",
);

/**
 * Serviços de push dos navegadores (Chrome e derivados, Firefox, Safari, Edge).
 * O servidor faz um POST no endereço da inscrição: aceitar qualquer endereço
 * deixaria um usuário logado mandar o servidor chamar um serviço interno.
 */
const SERVICOS_DE_PUSH = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export const SERVICO_DESCONHECIDO = "Este navegador usa um serviço de notificações que o sistema não reconhece.";

export function ehServicoDePush(endereco: string): boolean {
  try {
    const url = new URL(endereco);
    return url.protocol === "https:" && !url.username && !url.password && SERVICOS_DE_PUSH.some((servico) => servico.test(url.hostname));
  } catch {
    return false;
  }
}

const ENDERECO = z.string(INVALIDO).min(1, INVALIDO).max(2000, INVALIDO).refine(ehServicoDePush, SERVICO_DESCONHECIDO);
// Chaves em base64 "de URL", como o navegador entrega em `PushSubscription.toJSON()`.
const CHAVE = (maximo: number) => z.string(INVALIDO).regex(/^[A-Za-z0-9_-]+=*$/, INVALIDO).max(maximo, INVALIDO);

/** A inscrição do aparelho, no formato que o navegador entrega. */
export const aparelhoSchema = z.object({ endpoint: ENDERECO, keys: z.object({ p256dh: CHAVE(200), auth: CHAVE(100) }, INVALIDO) }, INVALIDO);

/** Desinscrever: basta o endereço. */
export const desinscreverSchema = z.object({ endpoint: z.string(INVALIDO).min(1, INVALIDO).max(2000, INVALIDO) }, INVALIDO);

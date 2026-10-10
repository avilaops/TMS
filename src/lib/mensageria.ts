import { z } from "zod";

/**
 * Mensageria: o histórico dos avisos que o TMS gerou para sistemas de fora
 * (tabela `OutboxEvent`). Quem entrega é `src/lib/eventos.ts`; aqui ficam os
 * rótulos e as regras que a rota e a tela compartilham.
 *
 * O TMS não manda WhatsApp, SMS nem e-mail por conta própria: ele avisa o
 * endereço que a empresa cadastrou (Empresa → Integração), e é o sistema de lá
 * (o n8n, por exemplo) que escreve para a pessoa. Por isso a tela mostra se o
 * aviso chegou ao endereço, não se alguém leu a mensagem.
 *
 * Este arquivo não importa o cliente do banco: a tela o importa.
 */

/** Depois de quantas tentativas o despachante desiste de um aviso. */
export const TENTATIVAS = 8;

/** Todo tipo de aviso que o sistema gera hoje, com o rótulo que a tela mostra. */
export const TIPOS_DE_AVISO = {
  "coleta.status": "Carga mudou de status",
  "fatura.emitida": "Fatura emitida",
  "fatura.paga": "Fatura paga",
  "fatura.reaberta": "Fatura reaberta",
  "fatura.cancelada": "Fatura cancelada",
  "cobranca.vencida": "Título vencido",
  "ocorrencia.aberta": "Chamado aberto",
  "ocorrencia.status": "Chamado mudou de status",
  "cte.autorizado": "CT-e autorizado",
  "cte.cancelado": "CT-e cancelado",
  "mdfe.autorizado": "MDF-e autorizado",
  "mdfe.encerrado": "MDF-e encerrado",
  "mdfe.cancelado": "MDF-e cancelado",
  teste: "Teste da integração",
} as const;

export type TipoDeAviso = keyof typeof TIPOS_DE_AVISO;

export const rotuloDoTipo = (tipo: string) => (TIPOS_DE_AVISO as Record<string, string>)[tipo] ?? tipo;

export const SITUACOES = ["entregue", "fila", "falhou", "desistiu"] as const;
export type SituacaoDoAviso = (typeof SITUACOES)[number];

export const ROTULO_DA_SITUACAO: Record<SituacaoDoAviso, string> = {
  entregue: "Entregue",
  fila: "Na fila",
  falhou: "Falhou",
  desistiu: "Desistiu",
};

type Entrega = { deliveredAt: Date | string | null; attempts: number; lastError: string | null };

/**
 * Onde o aviso está:
 * - `entregue`: o endereço respondeu que recebeu;
 * - `desistiu`: gastou todas as tentativas sem conseguir, e não sai mais sozinho;
 * - `falhou`: a última tentativa deu errado, e o despachante ainda vai tentar;
 * - `fila`: ainda não foi tentado (ou a tentativa está em curso).
 */
export function situacaoDoAviso(evento: Entrega): SituacaoDoAviso {
  if (evento.deliveredAt) return "entregue";
  if (evento.attempts >= TENTATIVAS) return "desistiu";
  if (evento.lastError) return "falhou";
  return "fila";
}

/** Só o aviso que falhou ou de que o despachante desistiu pode ser tentado de novo à mão. */
export const podeReenviar = (evento: Entrega) => {
  const situacao = situacaoDoAviso(evento);
  return situacao === "falhou" || situacao === "desistiu";
};

/** A frase da situação: "Entregue", "Falhou (2 de 8): Resposta 500", "Desistiu depois de 8 tentativas: ...". */
export function descricaoDaSituacao(evento: Entrega): string {
  const situacao = situacaoDoAviso(evento);
  const motivo = evento.lastError ? `: ${evento.lastError}` : "";
  if (situacao === "desistiu") return `Desistiu depois de ${evento.attempts} tentativas${motivo}`;
  if (situacao === "falhou") return `Falhou (tentativa ${evento.attempts} de ${TENTATIVAS})${motivo}`;
  return ROTULO_DA_SITUACAO[situacao];
}

/** O `where` do Prisma de cada situação. Espelha `situacaoDoAviso`. */
export const FILTRO_DA_SITUACAO = {
  entregue: { deliveredAt: { not: null } },
  desistiu: { deliveredAt: null, attempts: { gte: TENTATIVAS } },
  falhou: { deliveredAt: null, attempts: { lt: TENTATIVAS }, lastError: { not: null } },
  fila: { deliveredAt: null, attempts: { lt: TENTATIVAS }, lastError: null },
} as const;

/** O `where` do aviso que pode ser reenviado. Espelha `podeReenviar`. */
export const REENVIAVEL = {
  deliveredAt: null,
  OR: [{ lastError: { not: null } }, { attempts: { gte: TENTATIVAS } }],
};

export const TAMANHO_DA_PAGINA = 30;

const opcional = (maximo: number) =>
  z.preprocess((valor) => (typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined), z.string().max(maximo).optional());

/** Filtros da lista, como chegam na query. Vazio é o mesmo que ausente. */
export const filtrosDeAvisosSchema = z.object({
  tipo: opcional(60),
  situacao: z.preprocess((valor) => (typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined), z.enum(SITUACOES, "Situação inválida.").optional()),
  cursor: opcional(60),
});

export const EVENTO_SELECT = {
  id: true,
  type: true,
  createdAt: true,
  deliveredAt: true,
  attempts: true,
  lastError: true,
  nextAttemptAt: true,
} as const;

export type Aviso = {
  id: string;
  type: string;
  createdAt: string;
  deliveredAt: string | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
};

export const SEM_ENDERECO = "A empresa não tem endereço de integração cadastrado. Cadastre em Empresa → Integração.";
export const NAO_REENVIAVEL = "Só aviso que falhou pode ser tentado de novo.";
export const AVISO_NAO_ENCONTRADO = "Aviso não encontrado.";

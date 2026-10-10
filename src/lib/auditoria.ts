import type { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Auditoria: quem fez o quê, quando, de onde, e o que mudou.
 *
 * Cada ação importante grava uma linha em `AuditLog` com `registrarAuditoria`,
 * dentro da transação da mudança quando a rota tem uma (ou ficam as duas
 * gravações, ou nenhuma). A rota que grava sem transação usa
 * `registrarAuditoriaDepois`, logo após a gravação: ali a mudança já valeu, e
 * uma falha ao registrar não pode virar erro para quem fez a ação.
 *
 * A tabela é só de inserção para a aplicação (prisma/sql/010-rls.sql).
 *
 * O que nunca entra em `antes`/`depois`: senha, hash, segredo, token, o
 * símbolo da empresa, foto e assinatura de comprovante, XML de nota. A regra
 * está em `CAMPOS_PROIBIDOS` e vale em qualquer profundidade do objeto.
 *
 * Este arquivo não importa o cliente do banco: a tela o importa pelos rótulos.
 */

/* ------------------------------ Ações e entidades ----------------------------- */

/** Toda ação que o sistema registra, com o rótulo que a tela mostra. O texto da chave é estável. */
export const ACOES = {
  "cliente.criar": "Cliente criado",
  "cliente.alterar": "Cliente alterado",
  "cliente.desativar": "Cliente desativado",
  "cliente.reativar": "Cliente reativado",
  "motorista.criar": "Motorista criado",
  "motorista.alterar": "Motorista alterado",
  "motorista.desativar": "Motorista desativado",
  "motorista.reativar": "Motorista reativado",
  "motorista.comissao": "Percentual de comissão alterado",
  "ajudante.criar": "Ajudante criado",
  "ajudante.alterar": "Ajudante alterado",
  "ajudante.desativar": "Ajudante desativado",
  "ajudante.reativar": "Ajudante reativado",
  "ausencia.registrar": "Ausência registrada",
  "ausencia.alterar": "Ausência alterada",
  "ausencia.excluir": "Ausência excluída",
  "adiantamento.registrar": "Adiantamento registrado",
  "adiantamento.acertar": "Adiantamento acertado",
  "adiantamento.reabrir": "Acerto de adiantamento desfeito",
  "veiculo.criar": "Veículo criado",
  "veiculo.alterar": "Veículo alterado",
  "usuario.criar": "Usuário criado",
  "usuario.alterar": "Usuário alterado",
  "usuario.perfil": "Perfil de usuário trocado",
  "usuario.acesso.liberar": "Liberação de acesso",
  "usuario.acesso.revogar": "Acesso revogado",
  "coleta.criar": "Carga criada",
  "coleta.alterar": "Carga alterada",
  "coleta.status": "Status da carga alterado",
  "coleta.frete": "Frete informado à mão",
  "manifesto.criar": "Manifesto criado",
  "manifesto.alterar": "Manifesto alterado",
  "manifesto.retirar-carga": "Carga retirada do manifesto",
  "manifesto.liberar": "Manifesto liberado",
  "manifesto.cancelar": "Manifesto cancelado",
  "manifesto.finalizar": "Manifesto finalizado",
  "fatura.emitir": "Fatura emitida",
  "fatura.pagar": "Fatura paga",
  "fatura.reabrir": "Fatura reaberta",
  "fatura.cancelar": "Fatura cancelada",
  "lancamento.criar": "Lançamento criado",
  "lancamento.alterar": "Lançamento alterado",
  "lancamento.pagar": "Lançamento pago",
  "lancamento.reabrir": "Lançamento reaberto",
  "lancamento.excluir": "Lançamento excluído",
  "comprovante.aprovar": "Comprovante aprovado",
  "comprovante.recusar": "Comprovante recusado",
  "empresa.alterar": "Empresa alterada",
  "empresa.cobranca": "Parâmetros de cobrança alterados",
  "integracao.alterar": "Endereço de integração gravado",
  "integracao.remover": "Endereço de integração removido",
  "tabela-frete.criar": "Tabela de frete criada",
  "tabela-frete.alterar": "Tabela de frete alterada",
  "tabela-frete.cidades": "Cidades da tabela de frete trocadas",
  "ocorrencia.abrir": "Chamado aberto",
  "ocorrencia.status": "Status do chamado alterado",
  "ocorrencia.alterar": "Chamado alterado",
  "deposito.concluir": "Conferência concluída",
  "nota.importar": "Nota fiscal importada",
  "nota.carga": "Carga criada a partir da nota",
  "abastecimento.registrar": "Abastecimento registrado",
  "documento-veiculo.registrar": "Documento de veículo registrado",
  "aviso.reenviar": "Aviso reenviado",
} as const;

export type Acao = keyof typeof ACOES;

/** O que a ação alterou, com o rótulo que a tela mostra. */
export const ENTIDADES = {
  cliente: "Cliente",
  motorista: "Motorista",
  ajudante: "Ajudante",
  ausencia: "Ausência",
  adiantamento: "Adiantamento",
  veiculo: "Veículo",
  usuario: "Usuário",
  coleta: "Carga",
  manifesto: "Manifesto",
  fatura: "Fatura",
  lancamento: "Lançamento",
  comprovante: "Comprovante",
  empresa: "Empresa",
  integracao: "Integração",
  "tabela-frete": "Tabela de frete",
  ocorrencia: "Chamado",
  nota: "Nota fiscal",
  aviso: "Aviso",
} as const;

export type Entidade = keyof typeof ENTIDADES;

export const rotuloDaAcao = (acao: string) => (ACOES as Record<string, string>)[acao] ?? acao;
export const rotuloDaEntidade = (entidade: string) => (ENTIDADES as Record<string, string>)[entidade] ?? entidade;

/* ------------------------------- Antes e depois ------------------------------- */

/**
 * Pedaços de nome de campo que nunca são gravados, em qualquer caixa:
 * `password`, `passwordHash`, `secret`, `logo`, `signatureData`...
 */
export const CAMPOS_PROIBIDOS = [
  "password",
  "senha",
  "hash",
  "secret",
  "segredo",
  "token",
  "logo",
  "photo",
  "foto",
  "signature",
  "assinatura",
  "image",
  "imagem",
  "xml",
] as const;

export const campoProibido = (nome: string) => {
  const minusculo = nome.toLowerCase();
  return CAMPOS_PROIBIDOS.some((pedaco) => minusculo.includes(pedaco));
};

const TEXTO_MAXIMO = 500;
const OMITIDO = "[conteúdo omitido]";

type Json = string | number | boolean | null | Json[] | { [campo: string]: Json };

/**
 * O valor como ele vai para o banco: datas em ISO, campo proibido fora, imagem
 * embutida (`data:`) omitida mesmo que venha num campo de nome inocente, e
 * texto longo cortado.
 */
function limpar(valor: unknown): Json {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  if (typeof valor === "string") {
    if (valor.startsWith("data:")) return OMITIDO;
    return valor.length > TEXTO_MAXIMO ? `${valor.slice(0, TEXTO_MAXIMO)}…` : valor;
  }
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "bigint") return valor.toString();
  if (Array.isArray(valor)) return valor.map(limpar);
  if (typeof valor === "object") {
    const limpo: { [campo: string]: Json } = {};
    for (const [campo, conteudo] of Object.entries(valor as Record<string, unknown>)) {
      if (conteudo === undefined || campoProibido(campo)) continue;
      limpo[campo] = limpar(conteudo);
    }
    return limpo;
  }
  return null;
}

type Campos = Record<string, unknown>;
type CamposLimpos = { [campo: string]: Json };

const igual = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

// Campos do registro que não contam como mudança: o id já está na linha
// (`entityId`), a empresa também, e as datas de controle mudam sozinhas.
// Contadores do Prisma (`_count`) não são dado do registro.
const IGNORADOS = new Set(["id", "tenantId", "createdAt", "updatedAt"]);

const semIgnorados = (lado: CamposLimpos): CamposLimpos =>
  Object.fromEntries(Object.entries(lado).filter(([campo]) => !IGNORADOS.has(campo) && !campo.startsWith("_")));

/** Só os campos pedidos de um registro: as rotas escolhem o que entra em `antes`/`depois`. */
export function escolher<T extends Record<string, unknown>, K extends keyof T>(registro: T, campos: readonly K[]): Pick<T, K> {
  const escolhidos = {} as Pick<T, K>;
  for (const campo of campos) escolhidos[campo] = registro[campo];
  return escolhidos;
}

/**
 * O par `antes`/`depois` que vai para a linha.
 *
 * - Com os dois lados (alteração): só os campos que mudaram, nos dois.
 * - Só `depois` (criação): os campos preenchidos; `antes` fica nulo.
 * - Só `antes` (exclusão): os campos preenchidos; `depois` fica nulo.
 *
 * Lado sem campo nenhum vira nulo, e campo proibido não entra em caso algum.
 */
export function diferencas(antes?: Campos | null, depois?: Campos | null): { antes: CamposLimpos | null; depois: CamposLimpos | null } {
  const a = antes ? semIgnorados(limpar(antes) as CamposLimpos) : null;
  const d = depois ? semIgnorados(limpar(depois) as CamposLimpos) : null;
  const preenchidos = (lado: CamposLimpos) => Object.fromEntries(Object.entries(lado).filter(([, valor]) => valor !== null));
  const ouNulo = (lado: CamposLimpos) => (Object.keys(lado).length > 0 ? lado : null);

  if (a && d) {
    const mudouAntes: CamposLimpos = {};
    const mudouDepois: CamposLimpos = {};
    for (const campo of new Set([...Object.keys(a), ...Object.keys(d)])) {
      const de = a[campo] ?? null;
      const para = d[campo] ?? null;
      if (igual(de, para)) continue;
      mudouAntes[campo] = de;
      mudouDepois[campo] = para;
    }
    return { antes: ouNulo(mudouAntes), depois: ouNulo(mudouDepois) };
  }
  return { antes: a ? ouNulo(preenchidos(a)) : null, depois: d ? ouNulo(preenchidos(d)) : null };
}

/** `true` quando a alteração não mudou campo nenhum: não há o que registrar. */
export function nadaMudou(antes: Campos, depois: Campos): boolean {
  return diferencas(antes, depois).depois === null;
}

/** O que entra em `antes`/`depois` de uma carga, em todas as rotas que a criam ou alteram. */
export const CAMPOS_DA_COLETA = [
  "trackingCode",
  "status",
  "clientId",
  "sender",
  "receiver",
  "origin",
  "destination",
  "volumes",
  "weight",
  "invoiceKey",
  "invoiceValue",
  "driverId",
  "freightValue",
  "freightManual",
] as const;

/** O que entra em `antes`/`depois` de um lançamento do financeiro. */
export const CAMPOS_DO_LANCAMENTO = [
  "type",
  "amount",
  "description",
  "dueDate",
  "status",
  "paidAt",
  "paymentMethod",
  "category",
  "costCenter",
  "counterparty",
  "notes",
  "clientId",
  "interest",
  "fine",
  "discount",
  "paidAmount",
] as const;

/* ------------------------------ De onde veio a ação --------------------------- */

export type Origem = { ip: string | null; dispositivo: string | null };

const NAVEGADORES: [RegExp, string][] = [
  // A ordem importa: o Edge e o Opera também dizem "Chrome", e o Chrome também diz "Safari".
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SISTEMAS: [RegExp, string][] = [
  // O iPad e o iPhone também dizem "Mac OS X"; o Android também diz "Linux".
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "Mac"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

const DISPOSITIVO_MAXIMO = 80;

/**
 * O user-agent em poucas palavras: "Safari no iPhone", "Chrome no Windows".
 * O que não dá para reconhecer (script, integração) fica como veio, cortado.
 */
export function resumoDoDispositivo(userAgent: string | null | undefined): string | null {
  const ua = userAgent?.trim();
  if (!ua) return null;
  const navegador = NAVEGADORES.find(([padrao]) => padrao.test(ua))?.[1];
  const sistema = SISTEMAS.find(([padrao]) => padrao.test(ua))?.[1];
  if (navegador && sistema) return `${navegador} no ${sistema}`;
  if (navegador || sistema) return navegador ?? sistema ?? null;
  return ua.slice(0, DISPOSITIVO_MAXIMO);
}

// IPv4 ou IPv6, sem porta. O cabeçalho vem de fora: o que não parece endereço não é gravado.
const PARECE_IP = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * IP e dispositivo de quem fez a requisição. O IP é o primeiro valor de
 * `x-forwarded-for` (o cliente; os demais são os proxies do caminho). Sem
 * requisição ou sem cabeçalho, os dois ficam nulos.
 */
export function origemDaRequisicao(req?: { headers?: { get(nome: string): string | null } } | null): Origem {
  const ler = (nome: string) => {
    try {
      return req?.headers?.get(nome) ?? null;
    } catch {
      return null;
    }
  };
  const primeiro = (ler("x-forwarded-for") ?? ler("x-real-ip") ?? "").split(",")[0].trim();
  return { ip: PARECE_IP.test(primeiro) ? primeiro : null, dispositivo: resumoDoDispositivo(ler("user-agent")) };
}

/* --------------------------------- Registrar --------------------------------- */

/** Quem fez. É o que `requireStaff` devolve. */
export type Ator = { id: string; name: string; role: string };

export type Registro = {
  ator: Ator;
  origem: Origem;
  acao: Acao;
  entidade: Entidade;
  entidadeId?: string | null;
  /** Frase curta em português, para a lista: "Cliente Mello Ltda desativado". */
  resumo: string;
  antes?: Campos | null;
  depois?: Campos | null;
};

/** O cliente Prisma da empresa ou o cliente de uma transação: os dois servem. */
export type AuditoriaDb = Pick<Prisma.TransactionClient, "auditLog">;

const RESUMO_MAXIMO = 300;

/** Os dados da linha, prontos para o banco. Separado do `create` para ser testado sem banco. */
export function linhaDeAuditoria(registro: Registro) {
  const { antes, depois } = diferencas(registro.antes, registro.depois);
  return {
    userId: registro.ator.id,
    userName: registro.ator.name,
    userRole: registro.ator.role,
    action: registro.acao,
    entity: registro.entidade,
    entityId: registro.entidadeId ?? null,
    summary: registro.resumo.slice(0, RESUMO_MAXIMO),
    before: antes,
    after: depois,
    ip: registro.origem.ip,
    device: registro.origem.dispositivo,
  };
}

/**
 * Grava a linha da auditoria. Dentro de uma transação, passe o `tx`: se a
 * linha não puder ser gravada, a mudança também não fica.
 */
export async function registrarAuditoria(db: AuditoriaDb, registro: Registro): Promise<void> {
  const { before, after, ...linha } = linhaDeAuditoria(registro);
  await db.auditLog.create({
    data: { ...linha, ...(before && { before }), ...(after && { after }) },
    select: { id: true },
  });
}

/**
 * Para a rota que grava sem transação: registra logo depois da gravação. A
 * mudança já valeu; se a linha falhar, o erro vai para o log do servidor e a
 * resposta da rota segue a mesma.
 */
export async function registrarAuditoriaDepois(db: AuditoriaDb, registro: Registro): Promise<void> {
  try {
    await registrarAuditoria(db, registro);
  } catch (erro) {
    console.error(`Auditoria não registrada (${registro.acao} ${registro.entidadeId ?? ""}):`, erro);
  }
}

/* ----------------------------------- Leitura ---------------------------------- */

export const TAMANHO_DA_PAGINA = 30;

export const AUDIT_SELECT = {
  id: true,
  createdAt: true,
  userId: true,
  userName: true,
  userRole: true,
  action: true,
  entity: true,
  entityId: true,
  summary: true,
  before: true,
  after: true,
  ip: true,
  device: true,
} as const;

export type LinhaDeAuditoria = {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  device: string | null;
};

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (valor: string) => DIA.test(valor) && !Number.isNaN(new Date(`${valor}T00:00:00.000Z`).getTime());
const opcional = (maximo: number) =>
  z.preprocess((valor) => (typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined), z.string().max(maximo).optional());
const dia = z.preprocess(
  (valor) => (typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined),
  z.string().refine(diaValido, "Data inválida. Use AAAA-MM-DD.").optional(),
);

/** Filtros da lista, como chegam na query. Vazio é o mesmo que ausente. */
export const filtrosDeAuditoriaSchema = z
  .object({
    de: dia,
    ate: dia,
    usuario: opcional(60),
    acao: opcional(60),
    entidade: opcional(60),
    id: opcional(60),
    cursor: opcional(60),
  })
  .refine((filtros) => !filtros.de || !filtros.ate || filtros.de <= filtros.ate, "O início do período não pode ser depois do fim.");

export type FiltrosDeAuditoria = z.infer<typeof filtrosDeAuditoriaSchema>;

// O dia do filtro é o do relógio do Brasil (UTC-3 o ano inteiro, sem horário de verão desde 2019).
const inicioDoDiaNoBrasil = (valor: string) => new Date(`${valor}T00:00:00.000-03:00`);

/** O `where` do Prisma para os filtros. O período é em dias do Brasil, com o último dia inteiro. */
export function filtroDeAuditoria(filtros: FiltrosDeAuditoria) {
  const inicio = filtros.de ? inicioDoDiaNoBrasil(filtros.de) : null;
  const fim = filtros.ate ? new Date(inicioDoDiaNoBrasil(filtros.ate).getTime() + 86_400_000) : null;
  return {
    ...(inicio || fim ? { createdAt: { ...(inicio && { gte: inicio }), ...(fim && { lt: fim }) } } : {}),
    ...(filtros.usuario ? { userId: filtros.usuario } : {}),
    ...(filtros.acao ? { action: filtros.acao } : {}),
    ...(filtros.entidade ? { entity: filtros.entidade } : {}),
    // Busca por id: o da entidade, inteiro ou só o começo.
    ...(filtros.id ? { entityId: { startsWith: filtros.id } } : {}),
  };
}

/* -------------------------- Antes e depois, para a tela ------------------------ */

/** Rótulo em português dos campos que aparecem em `antes`/`depois`. Campo fora da lista aparece com o próprio nome. */
export const ROTULOS_DOS_CAMPOS: Record<string, string> = {
  name: "Nome",
  email: "E-mail",
  role: "Perfil",
  clientId: "Cliente",
  companyName: "Razão social",
  tradeName: "Nome fantasia",
  cnpj: "CNPJ/CPF",
  ie: "Inscrição estadual",
  contactName: "Contato",
  phone: "Telefone",
  address: "Endereço",
  paymentCondition: "Condição de pagamento",
  creditLimit: "Limite de crédito",
  freightTableId: "Tabela de frete",
  active: "Ativo",
  cpf: "CPF",
  cnh: "CNH",
  cnhExpiry: "Validade da CNH",
  category: "Categoria",
  plate: "Placa",
  model: "Modelo",
  type: "Tipo",
  capacity: "Capacidade (kg)",
  maxWeight: "Peso máximo (kg)",
  year: "Ano",
  driverId: "Motorista",
  vehicleId: "Veículo",
  status: "Status",
  sender: "Remetente",
  receiver: "Destinatário",
  receiverName: "Recebido por",
  origin: "Origem",
  destination: "Destino",
  volumes: "Volumes",
  weight: "Peso (kg)",
  invoiceKey: "Chave da NF",
  invoiceValue: "Valor da NF",
  freightValue: "Frete",
  freightManual: "Frete à mão",
  trackingCode: "Código de rastreio",
  number: "Número",
  total: "Total",
  amount: "Valor",
  description: "Descrição",
  dueDate: "Vencimento",
  paidAt: "Pago em",
  paymentMethod: "Forma de pagamento",
  counterparty: "Pagador/recebedor",
  notes: "Observações",
  rejectionReason: "Motivo da recusa",
  url: "Endereço",
  isDefault: "Padrão",
  validFrom: "Início da validade",
  validTo: "Fim da validade",
  priority: "Prioridade",
  assigneeId: "Responsável",
  title: "Título",
  accessKey: "Chave de acesso",
  date: "Data",
  liters: "Litros",
  totalCost: "Custo total",
  odometer: "Hodômetro",
  station: "Posto",
  expiresAt: "Vencimento",
  cargas: "Cargas",
  cargaId: "Carga",
  statusDaCarga: "Status da carga",
  cargasAcrescentadas: "Cargas acrescentadas",
  faltando: "Volumes faltando",
  series: "Série",
  issuerName: "Emitente",
  recipientName: "Destinatário",
  totalValue: "Valor total",
  cidades: "Cidades",
  simbolo: "Símbolo",
  inviteStatus: "Convite",
  costCenter: "Centro de custo",
  interest: "Juros",
  fine: "Multa",
  discount: "Desconto",
  paidAmount: "Valor recebido",
  commissionPct: "Comissão (%)",
  helperId: "Ajudante",
  startDate: "Primeiro dia",
  endDate: "Último dia",
  reason: "Motivo",
  manifestId: "Viagem",
  spentAmount: "Gasto comprovado",
  settledAt: "Acertado em",
  multaPct: "Multa (%)",
  jurosPct: "Juros ao mês (%)",
};

export const rotuloDoCampo = (campo: string) => ROTULOS_DOS_CAMPOS[campo] ?? campo;

const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** O valor de um campo como texto para a tela: "sim"/"não", data em português, "(vazio)". */
export function valorLegivel(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "(vazio)";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "number") return valor.toLocaleString("pt-BR");
  if (typeof valor === "string") {
    if (!INSTANTE.test(valor)) return valor;
    const data = new Date(valor);
    // Meia-noite UTC é um dia do calendário (vencimento, validade): sem hora e sem fuso.
    return valor.endsWith("T00:00:00.000Z")
      ? data.toLocaleDateString("pt-BR", { timeZone: "UTC" })
      : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  }
  return JSON.stringify(valor);
}

/** As linhas do quadro "antes | depois": um campo por linha, na ordem em que aparecem. */
export function linhasDoAntesEDepois(
  antes: Record<string, unknown> | null,
  depois: Record<string, unknown> | null,
): { campo: string; rotulo: string; antes: string; depois: string }[] {
  const campos = [...new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})])];
  return campos.map((campo) => ({
    campo,
    rotulo: rotuloDoCampo(campo),
    antes: antes && campo in antes ? valorLegivel(antes[campo]) : "",
    depois: depois && campo in depois ? valorLegivel(depois[campo]) : "",
  }));
}

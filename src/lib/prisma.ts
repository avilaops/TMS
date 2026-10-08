import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

/**
 * Acesso ao banco, sempre em nome de uma empresa (tenant).
 *
 * Quem separa uma empresa da outra é o Postgres (prisma/sql/010-rls.sql). Este
 * arquivo só garante que toda consulta chega lá dizendo de quem é:
 *
 * - `prisma` (export padrão): descobre a empresa pela sessão de quem fez a
 *   requisição. Sem sessão não há consulta: lança `SemEmpresaError`.
 * - `transacao(fn)`: transação interativa na empresa da sessão.
 * - `paraEmpresa(id)`: a empresa é dada por quem chama (rota pública que
 *   recebe a empresa por parâmetro, login, tarefas de plataforma).
 * - `sistema`: sem empresa e sem política, enxerga tudo. Só para o que
 *   acontece antes de existir empresa (achar o usuário no login, rastreio
 *   público por código, cadastro de empresas). Cada uso novo merece revisão.
 */

const connectionString = process.env.DATABASE_URL
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)

declare global {
  var prismaGlobal: undefined | PrismaClient
}

const base = globalThis.prismaGlobal ?? new PrismaClient({ adapter })
if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = base

/** Papel sem posse das tabelas: é para ele que as políticas valem. */
const PAPEL_DA_APLICACAO = 'tms_app'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class SemEmpresaError extends Error {
  constructor() {
    super('Consulta ao banco sem empresa definida.')
    this.name = 'SemEmpresaError'
  }
}

function conferir(tenantId: string | null | undefined): string {
  if (!tenantId || !UUID.test(tenantId)) throw new SemEmpresaError()
  return tenantId
}

/**
 * Empresa da requisição em curso, tirada da sessão.
 *
 * Em teste não há requisição: vale a empresa de TMS_TENANT_TESTE quando a
 * sessão simulada não traz uma. Fora de teste essa variável é ignorada.
 */
export async function empresaAtual(): Promise<string> {
  let daSessao: string | null | undefined
  try {
    const [{ getServerSession }, { authOptions }] = await Promise.all([
      import('next-auth'),
      import('@/lib/auth'),
    ])
    const session = await getServerSession(authOptions)
    daSessao = session?.user?.tenantId
  } catch {
    // Fora de uma requisição (script, teste sem sessão simulada) não há sessão para ler.
    daSessao = undefined
  }

  if (daSessao) return conferir(daSessao)
  if (process.env.NODE_ENV === 'test') return conferir(process.env.TMS_TENANT_TESTE)
  throw new SemEmpresaError()
}

/** Primeira instrução de toda transação de empresa. As duas configurações morrem no COMMIT. */
function entrarNaEmpresa(tenantId: string) {
  return Prisma.sql`SELECT set_config('role', ${PAPEL_DA_APLICACAO}, true), set_config('app.tenant_id', ${tenantId}, true)`
}

function clienteDe(resolver: () => Promise<string>) {
  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const tenantId = await resolver()
        const [, resultado] = await base.$transaction([
          base.$queryRaw(entrarNaEmpresa(tenantId)),
          query(args),
        ])
        return resultado
      },
    },
  })
}

// Por fora o cliente tem a mesma forma do PrismaClient: a extensão só envolve
// cada operação numa transação, não acrescenta campo nem método.
type ClienteDeEmpresa = Omit<PrismaClient, '$transaction' | '$on' | '$extends'>

type OpcoesDeTransacao = Parameters<PrismaClient['$transaction']>[1]

function transacaoEm<T>(
  resolver: () => Promise<string>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opcoes?: OpcoesDeTransacao,
): Promise<T> {
  return resolver().then((tenantId) =>
    base.$transaction(async (tx) => {
      await tx.$queryRaw(entrarNaEmpresa(tenantId))
      return fn(tx)
    }, opcoes),
  )
}

/**
 * Cliente da empresa da sessão. `$transaction` fica de fora do tipo de
 * propósito: aqui cada operação já é uma transação própria, e uma transação
 * interativa aberta por este cliente não seria atômica. Use `transacao()`.
 */
const prisma = clienteDe(empresaAtual) as unknown as ClienteDeEmpresa

export default prisma

/** Transação interativa na empresa da sessão. */
export function transacao<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opcoes?: OpcoesDeTransacao,
): Promise<T> {
  return transacaoEm(empresaAtual, fn, opcoes)
}

/** Cliente e transação de uma empresa informada por quem chama. */
export function paraEmpresa(tenantId: string) {
  const id = conferir(tenantId)
  const resolver = () => Promise.resolve(id)
  return {
    db: clienteDe(resolver) as unknown as ClienteDeEmpresa,
    transacao: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, opcoes?: OpcoesDeTransacao) =>
      transacaoEm(resolver, fn, opcoes),
  }
}

/** Sem empresa e sem política. Ver o comentário no topo antes de usar. */
export const sistema = base

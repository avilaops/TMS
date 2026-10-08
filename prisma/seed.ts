import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// A senha nunca fica no codigo. Este script roda com as variaveis na frente:
//   TENANT_SLUG=... TENANT_NAME="..." ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx prisma/seed.ts
// Cria a empresa (tenant) se ela ainda nao existe e o administrador dentro
// dela. Rodar sem as variaveis nao cria ninguem, para nao nascer administrador
// com senha conhecida em producao.
//
// Conecta como dono das tabelas, que nao passa pelas politicas de isolamento
// (prisma/sql/010-rls.sql): por isso a empresa vai explicita em cada gravacao.
async function main() {
  const slug = process.env.TENANT_SLUG?.trim().toLowerCase()
  const tenantName = process.env.TENANT_NAME?.trim()
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const plainPassword = process.env.ADMIN_PASSWORD
  const name = process.env.ADMIN_NAME ?? 'Administrador'

  if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
    throw new Error('Defina TENANT_SLUG (minusculas, numeros e hifen) antes de rodar o seed.')
  }

  if (!email || !plainPassword) {
    throw new Error(
      'Defina ADMIN_EMAIL e ADMIN_PASSWORD antes de rodar o seed.',
    )
  }

  if (plainPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.')
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: tenantName ? { name: tenantName } : {},
    create: { slug, name: tenantName || slug },
  })

  const password = await bcrypt.hash(plainPassword, 12)

  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: { password, role: 'ADMIN' },
    create: { email, name, password, role: 'ADMIN', tenantId: tenant.id },
  })

  console.log(`Empresa pronta: ${tenant.slug} (${tenant.name})`)
  console.log(`Administrador pronto: ${user.email}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

// A senha nunca fica no codigo. Este script roda com as variaveis na frente:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx prisma/seed.ts
// Rodar sem elas nao cria ninguem, para nao nascer administrador com senha
// conhecida em producao.
async function main() {
  const email = process.env.ADMIN_EMAIL
  const plainPassword = process.env.ADMIN_PASSWORD
  const name = process.env.ADMIN_NAME ?? 'Administrador'

  if (!email || !plainPassword) {
    throw new Error(
      'Defina ADMIN_EMAIL e ADMIN_PASSWORD antes de rodar o seed.',
    )
  }

  if (plainPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.')
  }

  const password = await bcrypt.hash(plainPassword, 12)

  const user = await prisma.user.upsert({
    where: { email },
    update: { password, role: 'ADMIN' },
    create: { email, name, password, role: 'ADMIN' },
  })

  console.log(`Administrador pronto: ${user.email}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

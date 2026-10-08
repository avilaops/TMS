import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

// Aplica prisma/sql/010-rls.sql no banco de DATABASE_URL. Roda depois de todo
// `prisma db push` (`npm run db:push` faz os dois).
export async function aplicarRls(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Defina DATABASE_URL.')

  const sql = readFileSync(fileURLToPath(new URL('./sql/010-rls.sql', import.meta.url)), 'utf8')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  aplicarRls()
    .then(() => console.log('Isolamento por empresa aplicado (010-rls.sql).'))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}

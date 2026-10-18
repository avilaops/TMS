import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

export async function aplicarLojasLogistica(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("Defina DATABASE_URL.");
  const sql = readFileSync(fileURLToPath(new URL("./sql/040-lojas-logistica.sql", import.meta.url)), "utf8");
  const client = new Client({ connectionString });
  await client.connect();
  try { await client.query(sql); } finally { await client.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  aplicarLojasLogistica()
    .then(() => console.log("Contrato Lojas aplicado (040-lojas-logistica.sql)."))
    .catch((error) => { console.error(error); process.exit(1); });
}

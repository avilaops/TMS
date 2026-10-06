import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * /api/health e o que o deploy consulta antes de dar a versao nova por boa.
 * Sem DATABASE_URL a suite e pulada, como as outras que precisam de Postgres.
 */
const temBanco = Boolean(process.env.DATABASE_URL);
const suite = temBanco ? describe : describe.skip;

suite("GET /api/health", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let GET: typeof import("../src/app/api/health/route").GET;

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    GET = (await import("../src/app/api/health/route")).GET;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("responde 200 quando o banco responde", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });
});

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sistema } from "./prisma";

export function gerarChaveLojas() {
  return `lojas_${randomBytes(32).toString("base64url")}`;
}

export function hashChaveLojas(chave: string) {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

export function chaveLojasConfere(chave: string, hashEsperado: string) {
  const recebido = Buffer.from(hashChaveLojas(chave), "hex");
  const esperado = Buffer.from(hashEsperado, "hex");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export function extrairBearer(request: Request) {
  const cabecalho = request.headers.get("authorization") ?? "";
  const correspondencia = /^Bearer\s+(\S+)$/i.exec(cabecalho);
  return correspondencia?.[1] ?? null;
}

export class CredencialLojasInvalida extends Error {
  constructor() {
    super("Credencial inválida.");
    this.name = "CredencialLojasInvalida";
  }
}

export async function autenticarLojas(request: Request, slug: string) {
  const chave = extrairBearer(request);
  const tenant = await sistema.tenant.findUnique({ where: { slug }, select: { id: true, active: true } });
  const credencial = tenant?.active
    ? await sistema.lojasIntegrationCredential.findUnique({ where: { tenantId: tenant.id }, select: { id: true, keyHash: true, active: true } })
    : null;
  if (!chave || !tenant || !credencial?.active || !chaveLojasConfere(chave, credencial.keyHash)) {
    throw new CredencialLojasInvalida();
  }
  return { tenantId: tenant.id, credentialId: credencial.id };
}

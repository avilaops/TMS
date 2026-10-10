import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma, { empresaAtual } from "@/lib/prisma";
import { comoDataUrl, lerPerfil, type FotoEnviada, type PerfilDeComprovante } from "@/lib/comprovantes";

// Apoio das rotas de comprovante (motorista e painel). Só o servidor importa
// este arquivo: as regras que a tela também usa estão em src/lib/comprovantes.ts.

/**
 * SHA-256, em hexadecimal, dos bytes da imagem: o que vem depois da vírgula da
 * data URL, decodificado. Não é o hash do texto base64, para o valor bater com
 * o do arquivo da foto conferido por fora.
 */
export function sha256DaImagem(dataUrl: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

/**
 * Transação que grava fotos: até seis imagens de 1,5 MB passam do limite
 * padrão de 5 segundos num banco ocupado.
 */
export const TRANSACAO_COM_FOTOS = { timeout: 20_000, maxWait: 10_000 } as const;

/** A quem a foto pertence: um comprovante ou uma tentativa de entrega sem sucesso. */
type DonoDaFoto = { proofId: string } | { attemptId: string };

/**
 * Grava as fotos do envio, cada uma com o hash calculado aqui. Uma a uma, na
 * ordem em que vieram: a hora de criação é o que ordena as fotos na tela.
 */
export async function gravarFotos(tx: Pick<Prisma.TransactionClient, "proofPhoto">, dono: DonoDaFoto, fotos: readonly FotoEnviada[]): Promise<void> {
  // Um milissegundo entre uma e outra: gravadas na mesma transação, sairiam
  // todas com a mesma hora e a ordem na tela ficaria ao acaso.
  const agora = Date.now();
  for (const [indice, foto] of fotos.entries()) {
    await tx.proofPhoto.create({
      data: { ...dono, kind: foto.kind, dataUrl: foto.dataUrl, sha256: sha256DaImagem(foto.dataUrl), createdAt: new Date(agora + indice) },
      select: { id: true },
    });
  }
}

/**
 * Tira a foto antiga da coluna `photoBase64` e a guarda como foto substituída,
 * para o reenvio de um comprovante antigo não apagar o que foi recusado.
 */
export async function arquivarFotoAntiga(
  tx: Pick<Prisma.TransactionClient, "proofPhoto" | "proofOfDelivery">,
  comprovante: { id: string; photoBase64: string | null; createdAt: Date },
  quando: Date,
): Promise<void> {
  if (!comprovante.photoBase64) return;
  const dataUrl = comoDataUrl(comprovante.photoBase64);
  await tx.proofPhoto.create({
    data: { proofId: comprovante.id, kind: "ENTREGA", dataUrl, sha256: sha256DaImagem(dataUrl), createdAt: comprovante.createdAt, replacedAt: quando },
    select: { id: true },
  });
  await tx.proofOfDelivery.update({ where: { id: comprovante.id }, data: { photoBase64: null }, select: { id: true } });
}

/** O perfil de comprovante da empresa da sessão (`Tenant.podProfile`). */
export async function perfilDaEmpresa(): Promise<PerfilDeComprovante> {
  // A empresa só lê o próprio cadastro (prisma/sql/010-rls.sql).
  const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { podProfile: true } });
  return lerPerfil(empresa?.podProfile);
}

/** As fotos como o painel lê, da mais antiga para a mais nova. */
export const FOTOS_DO_PAINEL = {
  select: { id: true, kind: true, dataUrl: true, sha256: true, createdAt: true, replacedAt: true },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
} satisfies Prisma.ProofPhotoFindManyArgs;

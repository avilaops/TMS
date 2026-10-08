// @vitest-environment jsdom
import { Suspense, act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHOTO_MESSAGE, PHOTO_TOO_BIG, MAX_PHOTO_CHARS } from "../src/lib/entregas";
import { ate, desmontarTudo, montar } from "./tela";

/**
 * Tela de baixa do motorista: a leitura do arquivo da foto no aparelho
 * (`file.slice`, `Blob`, `FileReader`), do arquivo escolhido até a imagem que
 * vai no envio. A regra do tipo em si está em `tests/driver.test.ts`.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "unauthenticated" }) }));

import DeliveryProofPage from "../src/app/driver/entregas/[id]/baixa/page";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x03];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50];

const arquivo = (bytes: number[], tipo: string, nome = "foto") => new File([new Uint8Array(bytes)], nome, { type: tipo });

async function abrir() {
  const params = Promise.resolve({ id: "coleta-1" });
  const tela = await montar(
    <Suspense fallback="carregando">
      <DeliveryProofPage params={params} />
    </Suspense>,
  );
  await ate(() => expect(tela.querySelector('input[type="file"]')).not.toBeNull());
  return tela;
}

/** O motorista escolhe (ou tira) a foto. */
async function escolher(tela: HTMLElement, foto: File) {
  const input = tela.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [foto] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return input;
}

const previa = (tela: HTMLElement) => tela.querySelector('img[alt="Foto da entrega"]') as HTMLImageElement | null;
const aviso = (tela: HTMLElement) => tela.querySelector('[role="alert"]')?.textContent ?? null;
const bytesDe = (dataUrl: string) => [...Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")];

afterEach(desmontarTudo);

describe("tela de baixa: leitura da foto no aparelho", () => {
  it("foto com tipo aceito vira a imagem do envio, byte a byte", async () => {
    const tela = await abrir();
    expect(tela.textContent).toContain("Toque para abrir a câmera");

    await escolher(tela, arquivo(JPEG, "image/jpeg", "foto.jpg"));

    await ate(() => expect(previa(tela)).not.toBeNull());
    const src = previa(tela)!.getAttribute("src")!;
    expect(src.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(bytesDe(src)).toEqual(JPEG);
    expect(aviso(tela)).toBeNull();
  });

  it.each([
    ["JPEG", JPEG, "image/jpeg"],
    ["PNG", PNG, "image/png"],
    ["WebP", WEBP, "image/webp"],
  ])("foto sem tipo, %s pelos primeiros bytes: é lida com o tipo certo", async (_nome, bytes, tipo) => {
    const tela = await abrir();

    await escolher(tela, arquivo(bytes, ""));

    await ate(() => expect(previa(tela)).not.toBeNull());
    const src = previa(tela)!.getAttribute("src")!;
    // É este prefixo que o servidor confere: sem o tipo, a baixa seria recusada.
    expect(src.startsWith(`data:${tipo};base64,`)).toBe(true);
    expect(bytesDe(src)).toEqual(bytes);
    expect(aviso(tela)).toBeNull();
  });

  it("foto sem tipo e de formato desconhecido: avisa e não guarda nada", async () => {
    const tela = await abrir();

    const input = await escolher(tela, arquivo([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], ""));

    await ate(() => expect(aviso(tela)).toBe(PHOTO_MESSAGE));
    expect(previa(tela)).toBeNull();
    expect(input.value).toBe("");
  });

  it("HEIC declarado é recusado mesmo com bytes de JPEG: tipo declarado não é reinterpretado", async () => {
    const tela = await abrir();

    await escolher(tela, arquivo(JPEG, "image/heic", "IMG_0001.HEIC"));

    await ate(() => expect(aviso(tela)).toBe(PHOTO_MESSAGE));
    expect(previa(tela)).toBeNull();
  });

  it("foto recusada depois de uma boa tira a boa da tela; outra boa limpa o aviso", async () => {
    const tela = await abrir();
    await escolher(tela, arquivo(PNG, "image/png"));
    await ate(() => expect(previa(tela)).not.toBeNull());

    await escolher(tela, arquivo(JPEG, "image/heic"));
    await ate(() => expect(aviso(tela)).toBe(PHOTO_MESSAGE));
    expect(previa(tela)).toBeNull();

    await escolher(tela, arquivo(WEBP, ""));
    await ate(() => expect(previa(tela)?.getAttribute("src")).toMatch(/^data:image\/webp;base64,/));
    expect(aviso(tela)).toBeNull();
  });

  it("foto grande demais é recusada antes de ser lida", async () => {
    const tela = await abrir();
    const leitura = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const grande = arquivo(JPEG, "image/jpeg");
    Object.defineProperty(grande, "size", { value: MAX_PHOTO_CHARS });

    await escolher(tela, grande);

    await ate(() => expect(aviso(tela)).toBe(PHOTO_TOO_BIG));
    expect(leitura).not.toHaveBeenCalled();
    expect(previa(tela)).toBeNull();
    leitura.mockRestore();
  });

  it("sem arquivo escolhido (câmera cancelada) nada muda", async () => {
    const tela = await abrir();
    const input = tela.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(previa(tela)).toBeNull();
    expect(aviso(tela)).toBeNull();
  });
});

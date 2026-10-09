// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { desmontarTudo, montar } from "./tela";
import { AvisoDeAcesso, type Acesso } from "../src/components/AvisoDeAcesso";

/**
 * O aviso que o operador vê depois de cadastrar alguém ou de clicar em
 * "Liberar acesso". A regra que este arquivo segura: a tela só fala em
 * sucesso de envio quando o login único disse `enviado`. Conta que já existia,
 * sem endereço de senha, com o e-mail falhando, aparecia em verde como
 * "já tinha conta e está liberado", e quem tinha clicado para reenviar não
 * descobria que a mensagem não saiu.
 */

const ENTRADA = "https://tms.avilaops.com/login";

async function aviso(acesso: Acesso) {
  const tela = await montar(<AvisoDeAcesso nome="Fulana" acesso={acesso} onFechar={() => undefined} />);
  return {
    texto: tela.textContent ?? "",
    alerta: tela.querySelector('[role="alert"]'),
    status: tela.querySelector('[role="status"]'),
    campo: tela.querySelector("input") as HTMLInputElement | null,
    whatsapp: tela.querySelector('a[href^="https://wa.me/"]')?.getAttribute("href") ?? null,
    verde: tela.querySelector(".bg-green-50"),
  };
}

describe("aviso de acesso", () => {
  afterEach(desmontarTudo);

  it("e-mail enviado: é o único caso em verde, e diz que o convite foi enviado", async () => {
    const t = await aviso({ ok: true, contaNova: true, envio: "enviado", convite: null, entrada: ENTRADA });
    expect(t.verde).not.toBeNull();
    expect(t.status).not.toBeNull();
    expect(t.alerta).toBeNull();
    expect(t.texto).toContain("Convite enviado por e-mail");
    expect(t.campo).toBeNull();
  });

  for (const [envio, trecho] of [
    ["falhou", "o envio do e-mail falhou"],
    ["limite", "limite de convites por hora"],
    ["sem_email", "sem envio de e-mail configurado"],
    ["nao_pedido", "o e-mail não foi enviado"],
  ] as const) {
    it(`conta que já existia e envio "${envio}": aviso com o motivo e o endereço do TMS, nunca sucesso`, async () => {
      const t = await aviso({ ok: true, contaNova: false, envio, convite: null, entrada: ENTRADA });

      expect(t.verde, "não pode aparecer em verde").toBeNull();
      expect(t.status).toBeNull();
      expect(t.alerta).not.toBeNull();
      expect(t.texto).not.toContain("Convite enviado");
      expect(t.texto).toContain("o e-mail com o endereço do TMS não saiu");
      expect(t.texto).toContain(trecho);
      // Orienta as duas saídas: mandar à mão ou tentar de novo.
      expect(t.texto).toContain("Liberar acesso");
      expect(t.campo?.value).toBe(ENTRADA);
      expect(decodeURIComponent(t.whatsapp ?? "")).toContain(ENTRADA);
    });
  }

  it("conta nova e e-mail que não saiu: mostra o endereço de criar a senha, com o motivo", async () => {
    const convite = "https://auth.avilaops.com/recuperar/abc";
    const t = await aviso({ ok: true, contaNova: true, envio: "falhou", convite, entrada: ENTRADA });

    expect(t.verde).toBeNull();
    expect(t.alerta).not.toBeNull();
    expect(t.texto).toContain("O e-mail do convite não saiu: o envio do e-mail falhou");
    expect(t.campo?.value).toBe(convite);
    expect(decodeURIComponent(t.whatsapp ?? "")).toContain(convite);
    expect(t.texto).not.toContain("Convite enviado");
  });

  it("sem a entrada configurada no servidor, usa o endereço em que o operador está", async () => {
    const t = await aviso({ ok: true, contaNova: false, envio: "falhou", convite: null, entrada: null });
    expect(t.campo?.value).toBe(`${window.location.origin}/login`);
  });

  it("liberação recusada pelo login único: aviso com o erro, sem endereço", async () => {
    const t = await aviso({ ok: false, erro: "Esta conta está desligada no login único." });
    expect(t.alerta).not.toBeNull();
    expect(t.verde).toBeNull();
    expect(t.texto).toContain("Esta conta está desligada no login único.");
    expect(t.campo).toBeNull();
  });
});

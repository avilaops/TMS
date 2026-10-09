"use client";

import { useState } from "react";
import type { Acesso, Envio } from "@/lib/acessos";

export type { Acesso };

/**
 * Por que o e-mail não saiu, dito ao operador. `enviado` não entra: é o único
 * caso em que a tela fala em sucesso de envio.
 */
const MOTIVO: Record<Exclude<Envio, "enviado">, string> = {
  sem_email: "o login único está sem envio de e-mail configurado",
  limite: "o limite de convites por hora para este e-mail foi atingido; dá para tentar de novo em uma hora",
  falhou: "o envio do e-mail falhou",
  nao_pedido: "o e-mail não foi enviado",
};

/**
 * O que aconteceu com o acesso da pessoa no login único depois de um cadastro
 * ou de um "Liberar acesso":
 *
 * - falha na liberação → aviso, com o caminho para tentar de novo;
 * - e-mail enviado → sucesso (o único verde que fala em envio);
 * - e-mail não saiu, conta nova → o endereço de criar a senha, para entregar à mão;
 * - e-mail não saiu, conta que já existia → aviso com o motivo e o endereço do
 *   TMS para mandar à mão. Não é sucesso: quem clicou para reenviar precisa
 *   saber que a mensagem não chegou.
 */
export function AvisoDeAcesso({ nome, acesso, onFechar }: { nome: string; acesso: Acesso; onFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);

  const base = "mt-4 p-4 rounded-xl border text-sm space-y-3";

  if (!acesso.ok) {
    return (
      <div role="alert" className={`${base} bg-amber-50 border-amber-200 text-amber-900`}>
        <p>
          <strong>{nome}</strong> foi cadastrado, mas ainda não consegue entrar: {acesso.erro} Use “Liberar acesso” na
          lista para tentar de novo.
        </p>
        <button type="button" onClick={onFechar} className="underline">
          Fechar
        </button>
      </div>
    );
  }

  if (acesso.envio === "enviado") {
    return (
      <div role="status" className={`${base} bg-green-50 border-green-200 text-green-900`}>
        <p>
          Convite enviado por e-mail para <strong>{nome}</strong>. A mensagem leva o endereço para criar a senha (vale
          por 7 dias); ao salvar, a pessoa já entra no TMS. Quem já tinha senha na conta Ávila Ops recebe só o endereço
          do sistema. Se a mensagem não chegar, use “Liberar acesso” na lista de usuários para enviar de novo.
        </p>
        <button type="button" onClick={onFechar} className="underline">
          Fechar
        </button>
      </div>
    );
  }

  const motivo = MOTIVO[acesso.envio];
  const contaNova = acesso.convite !== null;
  // Conta nova: o endereço de criar a senha. Conta que já existia: a entrada do TMS.
  const endereco = acesso.convite ?? acesso.entrada ?? (typeof window !== "undefined" ? `${window.location.origin}/login` : "");

  const mensagem = contaNova
    ? `Olá, ${nome}! Seu acesso ao TMS foi criado. Defina a sua senha neste link (vale por 7 dias): ${endereco}`
    : `Olá, ${nome}! Seu acesso ao TMS foi liberado. Entre com a sua conta Ávila Ops neste endereço: ${endereco}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div role="alert" className={`${base} ${contaNova ? "bg-blue-50 border-blue-200 text-blue-950" : "bg-amber-50 border-amber-200 text-amber-900"}`}>
      {contaNova ? (
        <p>
          O e-mail do convite não saiu: {motivo}. Envie você este link para <strong>{nome}</strong> definir a senha. Ele
          vale por 7 dias, funciona uma vez e <strong>não aparece de novo</strong>.
        </p>
      ) : (
        <p>
          <strong>{nome}</strong> já tinha conta Ávila Ops e está liberado, mas <strong>o e-mail com o endereço do TMS
          não saiu</strong>: {motivo}. Envie você o endereço abaixo, ou use “Liberar acesso” na lista de usuários para
          tentar o e-mail de novo. A pessoa entra com o e-mail e a senha (ou Google) que já usa.
        </p>
      )}
      <input
        readOnly
        aria-label={contaNova ? "Link do convite" : "Endereço do TMS"}
        value={endereco}
        onFocus={(e) => e.currentTarget.select()}
        className={`w-full px-3 py-2 rounded-lg border bg-white text-xs font-mono ${contaNova ? "border-blue-200" : "border-amber-200"}`}
      />
      <div className="flex flex-wrap gap-4">
        <button type="button" onClick={() => void copiar()} className="underline">
          {copiado ? "Copiado" : contaNova ? "Copiar link" : "Copiar endereço"}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Enviar por WhatsApp
        </a>
        <button type="button" onClick={onFechar} className="underline">
          Já enviei, fechar
        </button>
      </div>
    </div>
  );
}

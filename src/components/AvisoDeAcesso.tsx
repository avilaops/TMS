"use client";

import { useState } from "react";

export type Acesso = { ok: true; contaNova: boolean; convite: string | null } | { ok: false; erro: string };

/**
 * O que aconteceu com o acesso da pessoa no login único depois de um cadastro:
 * convite para enviar (conta nova), nada a fazer (conta que já existia) ou
 * falha, com o caminho para tentar de novo.
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

  if (!acesso.convite) {
    return (
      <div role="status" className={`${base} bg-green-50 border-green-200 text-green-900`}>
        <p>
          <strong>{nome}</strong> já tinha conta Ávila Ops e está liberado: é só entrar com o e-mail e a senha (ou
          Google) que já usa.
        </p>
        <button type="button" onClick={onFechar} className="underline">
          Fechar
        </button>
      </div>
    );
  }

  const mensagem = `Olá, ${nome}! Seu acesso ao TMS foi criado. Defina a sua senha neste link (vale por 7 dias): ${acesso.convite}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(acesso.convite as string);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div role="status" className={`${base} bg-blue-50 border-blue-200 text-blue-950`}>
      <p>
        Conta criada para <strong>{nome}</strong>. Envie este link para a pessoa definir a senha. Ele vale por 7 dias,
        funciona uma vez e <strong>não aparece de novo</strong>.
      </p>
      <input
        readOnly
        aria-label="Link do convite"
        value={acesso.convite}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full px-3 py-2 rounded-lg border border-blue-200 bg-white text-xs font-mono"
      />
      <div className="flex flex-wrap gap-4">
        <button type="button" onClick={() => void copiar()} className="underline">
          {copiado ? "Copiado" : "Copiar link"}
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

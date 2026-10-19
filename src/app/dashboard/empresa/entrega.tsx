"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  DESCRICAO_DO_PERFIL_DE_COMPROVANTE,
  PERFIS_DE_COMPROVANTE,
  ROTULO_DO_PERFIL_DE_COMPROVANTE,
  type PerfilDeComprovante,
} from "@/lib/comprovantes";

const FALHA_AO_SALVAR = "Não foi possível salvar.";
const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";

/**
 * O interruptor "o motorista vê a remuneração no aplicativo": desligado por
 * padrão, porque o dono pode não querer mostrar. Vale na hora, sem o botão
 * Salvar do cartão: é uma chamada própria (`PATCH /api/empresa/remuneracao`).
 * Ligado, o aplicativo mostra ao motorista o que cada viagem finalizada dele
 * rendeu (src/lib/remuneracao.ts).
 */
function RemuneracaoNoApp({ aoAvisar }: { aoAvisar: (mensagem: { ok: boolean; texto: string } | null) => void }) {
  const [visivel, setVisivel] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let ativo = true;
    fetch("/api/empresa/remuneracao")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: { visivelAoMotorista?: boolean } | null) => {
        if (ativo && typeof corpo?.visivelAoMotorista === "boolean") setVisivel(corpo.visivelAoMotorista);
      })
      .catch(() => {
        // Sem a leitura o interruptor fica travado: ninguém desliga sem ver como está.
      });
    return () => {
      ativo = false;
    };
  }, []);

  const mudar = async (novo: boolean) => {
    setOcupado(true);
    aoAvisar(null);
    try {
      const res = await fetch("/api/empresa/remuneracao", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visivelAoMotorista: novo }),
      });
      const corpo = (await res.json().catch(() => null)) as { visivelAoMotorista?: boolean; error?: string } | null;
      if (!res.ok || typeof corpo?.visivelAoMotorista !== "boolean") return aoAvisar({ ok: false, texto: corpo?.error ?? FALHA_AO_SALVAR });
      setVisivel(corpo.visivelAoMotorista);
      aoAvisar({ ok: true, texto: corpo.visivelAoMotorista ? "O motorista passa a ver os ganhos das viagens no aplicativo." : "O motorista deixa de ver os ganhos no aplicativo." });
    } catch {
      aoAvisar({ ok: false, texto: FALHA_AO_SALVAR });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <label className="min-w-0 flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-200">
      <input
        type="checkbox"
        role="switch"
        data-remuneracao-no-app
        checked={visivel ?? false}
        disabled={visivel === null || ocupado}
        onChange={(e) => mudar(e.target.checked)}
        className="w-4 h-4 shrink-0"
      />
      <span className="min-w-0 leading-tight">Motorista vê os ganhos das viagens no aplicativo</span>
    </label>
  );
}

/**
 * Perfil do comprovante de entrega: o que o aplicativo do motorista exige na
 * baixa. Livre (foto e assinatura opcionais), e-commerce (foto da carga no
 * local) ou carga B2B (foto do canhoto assinado). Com e-commerce ou B2B, a
 * tentativa de entrega sem sucesso também passa a exigir a foto da fachada.
 */
export function Entrega({ escondida }: { escondida: boolean }) {
  const [perfil, setPerfil] = useState<PerfilDeComprovante | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch("/api/empresa/comprovantes")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: { perfil?: PerfilDeComprovante } | null) => {
        if (ativo && corpo?.perfil) setPerfil(corpo.perfil);
      })
      .catch(() => {
        // Sem a leitura nenhuma opção fica marcada e salvar pede a escolha.
      });
    return () => {
      ativo = false;
    };
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!perfil) return setMensagem({ ok: false, texto: "Escolha o perfil." });
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch("/api/empresa/comprovantes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfil }),
      });
      const corpo = (await res.json().catch(() => null)) as { perfil?: PerfilDeComprovante; error?: string } | null;
      if (!res.ok || !corpo?.perfil) return setMensagem({ ok: false, texto: corpo?.error ?? FALHA_AO_SALVAR });
      setPerfil(corpo.perfil);
      setMensagem({ ok: true, texto: "Comprovante de entrega atualizado." });
    } catch {
      setMensagem({ ok: false, texto: FALHA_AO_SALVAR });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form onSubmit={salvar} aria-label="Comprovante de entrega" className={`${escondida ? "hidden " : ""}${CARD} p-3 md:p-6 space-y-3`}>
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-white">Comprovante de entrega</h2>
        <p className="text-xs md:text-sm text-gray-500 mt-0.5">O que o motorista precisa fotografar para dar baixa.</p>
      </div>

      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Perfil do comprovante">
        {PERFIS_DE_COMPROVANTE.map((opcao) => (
          <button
            key={opcao}
            type="button"
            role="radio"
            aria-checked={perfil === opcao}
            data-perfil={opcao}
            onClick={() => setPerfil(opcao)}
            className={`min-w-0 px-1 py-2 rounded-xl border text-sm font-medium ${
              perfil === opcao ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
            }`}
          >
            {ROTULO_DO_PERFIL_DE_COMPROVANTE[opcao]}
          </button>
        ))}
      </div>
      <p data-descricao-do-perfil className="text-xs text-gray-500 min-h-4">
        {perfil ? DESCRICAO_DO_PERFIL_DE_COMPROVANTE[perfil] : ""}
      </p>

      {mensagem && (
        <p role={mensagem.ok ? "status" : "alert"} className={`text-sm ${mensagem.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {mensagem.texto}
        </p>
      )}

      {/* O botão e o interruptor na mesma linha: o interruptor não aumenta a altura do cartão no celular. */}
      <div className="flex items-center justify-between gap-3">
        <button type="submit" disabled={ocupado} className="shrink-0 px-4 py-2 md:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 flex items-center gap-2">
          {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar
        </button>
        <RemuneracaoNoApp aoAvisar={setMensagem} />
      </div>
    </form>
  );
}

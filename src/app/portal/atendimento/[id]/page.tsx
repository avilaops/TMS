"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { TIPO_DA_OCORRENCIA } from "@/lib/ocorrencias";
import { useIdentidade } from "@/components/empresa/identidade";
import { readPortal } from "../../types";
import { INPUT, Situacao, quando, type Atendimento } from "../comum";

/**
 * A conversa de um atendimento. O cliente lê o que ele e a transportadora
 * escreveram (as anotações internas da transportadora não chegam aqui) e
 * responde enquanto o atendimento não estiver encerrado.
 */

type Mensagem = { id: string; body: string; fromClient: boolean; createdAt: string };

type Conversa = Atendimento & { messages: Mensagem[]; podeResponder: boolean };

export default function PortalAtendimentoConversaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const transportadora = useIdentidade()?.name ?? "Transportadora";
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroAoEnviar, setErroAoEnviar] = useState("");

  const carregar = useCallback(
    () =>
      fetch(`/api/portal/atendimento/${id}`)
        .then((r) => readPortal<Conversa>(r))
        .then(setConversa)
        .catch((e: Error) => setErro(e.message)),
    [id],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErroAoEnviar("");
    try {
      const res = await fetch(`/api/portal/atendimento/${id}/mensagens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: texto }),
      });
      await readPortal<Mensagem>(res);
      setTexto("");
    } catch (e) {
      setErroAoEnviar((e as Error).message);
    } finally {
      // Relê sempre: se o atendimento foi encerrado enquanto o cliente escrevia, a tela mostra.
      await carregar();
      setEnviando(false);
    }
  };

  const voltar = (
    <Link href="/portal/atendimento" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
      <ArrowLeft className="w-4 h-4" />
      Atendimento
    </Link>
  );

  if (erro) {
    return (
      <div className="space-y-3">
        {voltar}
        <div className="max-w-xl bg-white border border-amber-200 rounded-2xl p-6 flex gap-4">
          <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
          <div>
            <h1 className="font-outfit font-bold text-lg mb-1">Não foi possível carregar</h1>
            <p className="text-gray-600 text-sm">{erro}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!conversa) return <p className="p-6 text-gray-500">Carregando…</p>;

  return (
    <div className="space-y-3 md:space-y-5 max-w-3xl">
      {voltar}

      <div className="bg-white rounded-2xl border border-gray-200 p-3 md:p-6 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-base md:text-xl font-outfit font-bold text-gray-900">
            nº {conversa.number} · {conversa.title}
          </h1>
          <Situacao status={conversa.status} />
        </div>
        <p className="text-xs md:text-sm text-gray-600">
          {TIPO_DA_OCORRENCIA[conversa.type]}
          {conversa.collection && (
            <>
              {" · carga "}
              <Link href={`/portal/coletas/${conversa.collection.id}`} className="font-mono text-orange-600 hover:underline">
                {conversa.collection.trackingCode ?? conversa.collection.destination}
              </Link>
            </>
          )}
          {" · aberto em "}
          {quando(conversa.openedAt)}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-3 md:p-6 space-y-3">
        <ol className="space-y-2" aria-label="Conversa">
          <Fala doCliente={conversa.origin === "CLIENT"} transportadora={transportadora} instante={conversa.openedAt} texto={conversa.description} />
          {conversa.messages.map((m) => (
            <Fala key={m.id} doCliente={m.fromClient} transportadora={transportadora} instante={m.createdAt} texto={m.body} />
          ))}
        </ol>

        {conversa.podeResponder ? (
          <form onSubmit={enviar} className="space-y-2 pt-2 border-t border-gray-100">
            <textarea required rows={2} maxLength={4000} aria-label="Sua resposta" placeholder="Escreva sua resposta" value={texto} onChange={(e) => setTexto(e.target.value)} className={INPUT} />
            {erroAoEnviar && (
              <p role="alert" className="text-sm text-red-600">
                {erroAoEnviar}
              </p>
            )}
            <div className="flex justify-end">
              <button type="submit" disabled={enviando || !texto.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-60">
                {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
                Responder
              </button>
            </div>
          </form>
        ) : (
          <p className="pt-2 border-t border-gray-100 text-sm text-gray-500">
            Este atendimento foi encerrado.{" "}
            <Link href="/portal/atendimento" className="text-orange-600 hover:underline">
              Abra um novo
            </Link>{" "}
            se precisar.
          </p>
        )}
      </div>
    </div>
  );
}

function Fala({ doCliente, transportadora, instante, texto }: { doCliente: boolean; transportadora: string; instante: string; texto: string }) {
  return (
    <li data-fala={doCliente ? "cliente" : "transportadora"} className={`rounded-2xl px-3 py-2 ${doCliente ? "ml-6 bg-orange-50" : "mr-6 bg-gray-100"}`}>
      <p className="text-[11px] text-gray-500">
        <span className="font-medium text-gray-700">{doCliente ? "Sua empresa" : transportadora}</span> · {quando(instante)}
      </p>
      <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">{texto}</p>
    </li>
  );
}

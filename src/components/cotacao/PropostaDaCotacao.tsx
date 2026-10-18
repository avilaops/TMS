"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mensagemDaProposta, type DadosDaProposta } from "@/lib/proposta-cotacao";

type CotacaoDaProposta = Omit<DadosDaProposta, "deadline" | "validUntil">;

export function PropostaDaCotacao({ cotacao, onClose }: { cotacao: CotacaoDaProposta; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [deadline, setDeadline] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [retorno, setRetorno] = useState<{ ok: boolean; text: string } | null>(null);

  const preview = useMemo(() => {
    try {
      return mensagemDaProposta({ ...cotacao, deadline, validUntil });
    } catch {
      return "";
    }
  }, [cotacao, deadline, validUntil]);

  const copiar = async (event: React.FormEvent) => {
    event.preventDefault();
    setRetorno(null);
    let mensagem: string;
    try {
      mensagem = mensagemDaProposta({ ...cotacao, deadline, validUntil });
    } catch (erro) {
      setRetorno({ ok: false, text: (erro as Error).message });
      return;
    }
    try {
      await navigator.clipboard.writeText(mensagem);
      setRetorno({ ok: true, text: "Proposta copiada. Cole no WhatsApp do cliente." });
    } catch {
      setRetorno({ ok: false, text: "Não foi possível copiar. Selecione o texto abaixo e copie manualmente." });
    }
  };

  const identificacao = cotacao.number === null ? cotacao.companyName : `cotação ${cotacao.number}`;
  const semValor = cotacao.estimatedValue === null;

  useEffect(() => {
    const dialogo = dialogRef.current;
    if (!dialogo) return;
    if (typeof dialogo.showModal === "function") dialogo.showModal();
    else dialogo.setAttribute("open", "");
    return () => {
      if (dialogo.open && typeof dialogo.close === "function") dialogo.close();
    };
  }, []);

  const fechar = () => {
    const dialogo = dialogRef.current;
    if (dialogo?.open && typeof dialogo.close === "function") dialogo.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Proposta comercial"
      onCancel={(event) => { event.preventDefault(); fechar(); }}
      className="m-auto w-[calc(100%-1.5rem)] max-w-3xl overflow-visible bg-transparent p-0 backdrop:bg-slate-950/40"
    >
      <form
        aria-label={`Preparar proposta da ${identificacao}`}
        onSubmit={copiar}
        className="mx-auto max-w-3xl rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-xl"
      >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-blue-950">Preparar proposta</h2>
          <p className="text-xs text-blue-800">{cotacao.companyName} · {cotacao.origin} → {cotacao.destination}</p>
        </div>
        <button type="button" onClick={fechar} className="text-sm text-blue-700 hover:underline">Fechar</button>
      </div>

      {semValor && (
        <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Informe o preço estimado na cotação antes de preparar a proposta.
        </p>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className={"flex flex-col gap-1 text-xs font-medium text-blue-950"}>
          Prazo de entrega
          <input
            name="deadline"
            autoFocus
            required
            value={deadline}
            onChange={(event) => { setDeadline(event.target.value); setRetorno(null); }}
            placeholder="Ex.: até 2 dias úteis"
            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-blue-950">
          Proposta válida até
          <input
            name="validUntil"
            type="date"
            required
            value={validUntil}
            onChange={(event) => { setValidUntil(event.target.value); setRetorno(null); }}
            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>

      <textarea
        aria-label="Prévia da proposta"
        readOnly
        value={preview}
        placeholder="Informe prazo e validade para montar a mensagem."
        onFocus={(event) => event.currentTarget.select()}
        rows={10}
        className="mt-3 w-full resize-y rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
      />

      {retorno && (
        <p role={retorno.ok ? "status" : "alert"} className={`mt-2 text-sm ${retorno.ok ? "text-green-700" : "text-red-700"}`}>
          {retorno.text}
        </p>
      )}

        <button
          type="submit"
          disabled={semValor}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Copiar proposta
        </button>
      </form>
    </dialog>
  );
}

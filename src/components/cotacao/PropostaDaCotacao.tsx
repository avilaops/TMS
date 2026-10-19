"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, Copy, MapPin, MessageCircle, Package, Scale, WalletCards } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { mensagemDaProposta, type DadosDaProposta } from "@/lib/proposta-cotacao";

type CotacaoDaProposta = Omit<DadosDaProposta, "deadline" | "validUntil"> & { phone: string };

const adicionarDias = (dias: number) => {
  const data = new Date();
  data.setHours(12, 0, 0, 0);
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
};

const telefoneDoWhatsApp = (telefone: string) => {
  const digitos = telefone.replace(/\D/g, "");
  if (!digitos) return "";
  const jaTemPais = digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13);
  return jaTemPais ? digitos : `55${digitos}`;
};

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

  const compartilharNoWhatsApp = () => {
    setRetorno(null);
    let mensagem: string;
    try {
      mensagem = mensagemDaProposta({ ...cotacao, deadline, validUntil });
    } catch (erro) {
      setRetorno({ ok: false, text: (erro as Error).message });
      return;
    }
    const telefone = telefoneDoWhatsApp(cotacao.phone);
    window.open(`https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`, "_blank", "noopener,noreferrer");
    setRetorno({ ok: true, text: "Proposta pronta no WhatsApp. Revise a conversa antes de enviar." });
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
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 backdrop:bg-slate-950/45 md:m-auto md:h-auto md:max-h-[calc(100dvh-3rem)] md:w-[calc(100%-3rem)] md:max-w-5xl"
    >
      <form
        aria-label={`Preparar proposta da ${identificacao}`}
        onSubmit={copiar}
        className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 shadow-2xl md:h-auto md:max-h-[calc(100dvh-3rem)] md:rounded-2xl md:border md:border-slate-200"
      >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-6 md:py-4">
        <div>
          <h2 className="font-semibold text-slate-950">Preparar proposta</h2>
          <p className="mt-0.5 text-xs text-slate-500">{identificacao} · {cotacao.companyName}</p>
        </div>
        <button type="button" onClick={fechar} className="rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100">Fechar</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
      {semValor && (
        <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Informe o preço estimado na cotação antes de preparar a proposta.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="space-y-4">
      <div data-resumo-proposta className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-xs font-semibold text-slate-500">Resumo da carga</p>
          <p className="mt-1 flex items-start gap-2 text-sm font-semibold text-slate-900"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{cotacao.origin} → {cotacao.destination}</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100">
          <div className="p-3"><Package className="mb-1 h-4 w-4 text-blue-600" /><p className="text-sm font-semibold text-slate-900">{cotacao.volumes} volumes</p><p className="text-xs text-slate-500">Quantidade</p></div>
          <div className="p-3"><Scale className="mb-1 h-4 w-4 text-blue-600" /><p className="text-sm font-semibold text-slate-900">{cotacao.weight.toLocaleString("pt-BR")} kg</p><p className="text-xs text-slate-500">Peso</p></div>
          <div className="p-3"><WalletCards className="mb-1 h-4 w-4 text-blue-600" /><p className="text-sm font-semibold text-slate-900">{cotacao.estimatedValue === null ? "Não informado" : formatCurrency(cotacao.estimatedValue)}</p><p className="text-xs text-slate-500">Frete</p></div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Prazo de entrega
          <input
            name="deadline"
            autoFocus
            required
            value={deadline}
            onChange={(event) => { setDeadline(event.target.value); setRetorno(null); }}
            placeholder="Ex.: até 2 dias úteis"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Proposta válida até
          <input
            name="validUntil"
            type="date"
            required
            value={validUntil}
            onChange={(event) => { setValidUntil(event.target.value); setRetorno(null); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600"><Clock3 className="h-3.5 w-3.5" />Validade rápida</p>
        <div className="flex gap-2">
          {[3, 7, 15].map((dias) => (
            <button key={dias} type="button" onClick={() => { setValidUntil(adicionarDias(dias)); setRetorno(null); }} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">
              {dias} dias
            </button>
          ))}
        </div>
      </div>
      </div>

      <div className="min-w-0">
      <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="previa-da-proposta">Mensagem que será compartilhada</label>
      <textarea
        id="previa-da-proposta"
        aria-label="Prévia da proposta"
        readOnly
        value={preview}
        placeholder="Informe prazo e validade para montar a mensagem."
        onFocus={(event) => event.currentTarget.select()}
        rows={13}
        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
      />

      <p className="mt-2 text-xs leading-5 text-slate-500">O valor é estimado e será confirmado antes da coleta. A mensagem só será enviada depois da sua revisão no WhatsApp.</p>
      </div>
      </div>

      {retorno && (
        <p role={retorno.ok ? "status" : "alert"} className={`mt-2 text-sm ${retorno.ok ? "text-green-700" : "text-red-700"}`}>
          {retorno.text}
        </p>
      )}
      </div>

      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end md:px-6">
        <button
          type="submit"
          disabled={semValor}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {retorno?.ok && retorno.text.startsWith("Proposta copiada") ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {retorno?.ok && retorno.text.startsWith("Proposta copiada") ? "Proposta copiada" : "Copiar proposta"}
        </button>
        <button type="button" disabled={semValor} onClick={compartilharNoWhatsApp} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
          <MessageCircle className="h-4 w-4" />Enviar pelo WhatsApp
        </button>
      </div>
      </form>
    </dialog>
  );
}

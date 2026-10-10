"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { OCCURRENCE_TYPES, TIPO_DA_OCORRENCIA, type OccurrenceType } from "@/lib/ocorrencias";
import {
  INSUCESSO_NOTE_MAX,
  MOTIVOS_DE_INSUCESSO,
  PERFIL_PADRAO,
  ROTULO_DO_INSUCESSO,
  enumerar,
  insucessoPedeFachada,
  textoDasTentativas,
  type FotoEnviada,
  type MotivoDeInsucesso,
} from "@/lib/comprovantes";
import { assinarPerfil, buscarComprovantesDoMotorista, perfilLembrado, posicaoDoAparelho } from "@/lib/comprovantes-motorista";
import { CartaoDeFoto } from "@/components/driver/CartaoDeFoto";

/**
 * Ocorrência numa entrega, registrada pelo motorista. Duas situações na mesma
 * tela (e na mesma rota do servidor):
 *
 * - "Não entreguei": a tentativa de entrega sem sucesso, com motivo
 *   padronizado, foto da fachada (obrigatória quando o perfil da empresa é
 *   e-commerce ou carga B2B) e a posição, quando o aparelho informa. A carga
 *   continua em rota; a tentativa fica contada.
 * - "Outra ocorrência": o que houve (avaria, atraso, reentrega…) e uma descrição.
 *
 * As duas viram chamado para a equipe, ligado à carga. Precisam de sinal:
 * diferente da baixa de entrega, não ficam na fila offline.
 */

const FALHA = "Não foi possível registrar. Confira o sinal e tente de novo.";
const ESCOLHA = "min-w-0 px-2 py-2.5 rounded-2xl border text-sm font-medium";
const ESCOLHIDA = "border-blue-600 bg-blue-50 text-blue-700";
const NAO_ESCOLHIDA = "border-gray-200 bg-white text-gray-700";
const CAMPO = "block w-full min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500";

export type ModoDaOcorrencia = "insucesso" | "ocorrencia";

type Registrada = { number: number | null; attempts: number | null };

/** Chave da tentativa: a mesma em toda repetição do envio desta tela, para o servidor não gravar duas. */
const novaChave = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function OcorrenciaDaEntrega({ collectionId, inicio }: { collectionId: string; inicio: ModoDaOcorrencia }) {
  const router = useRouter();
  const perfil = useSyncExternalStore(assinarPerfil, perfilLembrado, () => PERFIL_PADRAO);

  const [modo, setModo] = useState<ModoDaOcorrencia>(inicio);
  const [tipo, setTipo] = useState<OccurrenceType | "">("");
  const [motivo, setMotivo] = useState<MotivoDeInsucesso | "">("");
  const [descricao, setDescricao] = useState("");
  const [fotos, setFotos] = useState<FotoEnviada[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [registrada, setRegistrada] = useState<Registrada | null>(null);
  const chave = useRef("");

  useEffect(() => {
    void buscarComprovantesDoMotorista();
  }, []);

  const insucesso = modo === "insucesso";
  const pedeFachada = insucessoPedeFachada(perfil);
  const texto = descricao.trim();

  const pendencias = insucesso
    ? [
        ...(motivo === "" ? ["o motivo"] : []),
        ...(motivo === "OUTRO" && texto.length < 5 ? ["a descrição"] : []),
        ...(pedeFachada && fotos.length === 0 ? ["a foto da fachada"] : []),
      ]
    : [...(tipo === "" ? ["o tipo"] : []), ...(texto === "" ? ["a descrição"] : [])];
  const oQueFalta = pendencias.length > 0 ? `Falta ${enumerar(pendencias)}` : "";

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (oQueFalta) return setErro(`${oQueFalta}.`);
    setOcupado(true);
    setErro("");
    try {
      let corpo: Record<string, unknown> = { type: tipo, description: descricao };
      if (insucesso) {
        if (!chave.current) chave.current = novaChave();
        corpo = { reason: motivo, note: texto, photos: fotos, key: chave.current, ...(await posicaoDoAparelho()) };
      }
      const res = await fetch(`/api/driver/entregas/${collectionId}/ocorrencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const resposta = (await res.json().catch(() => ({}))) as { error?: string; number?: number | null; attempts?: number };
      if (res.ok) return setRegistrada({ number: resposta.number ?? null, attempts: insucesso ? (resposta.attempts ?? null) : null });
      setErro(resposta.error ?? FALHA);
    } catch {
      setErro(FALHA);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-3 pb-6">
      <div className="flex items-center text-white relative z-10">
        <button type="button" onClick={() => router.back()} aria-label="Voltar para a viagem" className="p-2 -ml-2 mr-2">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold font-outfit">{insucesso ? "Não entreguei" : "Registrar ocorrência"}</h1>
      </div>

      {registrada !== null ? (
        <div role="status" className="bg-white rounded-3xl p-6 shadow-lg shadow-blue-900/5 relative z-10 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
          <p className="font-bold text-gray-900">
            {registrada.attempts !== null ? "Tentativa registrada" : "Ocorrência registrada"}
            {registrada.number ? ` (chamado nº ${registrada.number})` : ""}
          </p>
          <p className="text-sm text-gray-500">
            {registrada.attempts !== null ? `Esta carga tem ${textoDasTentativas(registrada.attempts)} e continua na sua viagem. A equipe já foi avisada.` : "A equipe já foi avisada."}
          </p>
          <button type="button" onClick={() => router.back()} className="block w-full bg-gray-900 text-white font-medium py-3 rounded-2xl">
            Voltar para a viagem
          </button>
        </div>
      ) : (
        <form onSubmit={enviar} noValidate className="bg-white rounded-3xl p-3 shadow-lg shadow-blue-900/5 relative z-10 space-y-3">
          <div role="tablist" aria-label="O que registrar" className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl">
            {(
              [
                ["insucesso", "Não entreguei"],
                ["ocorrencia", "Outra ocorrência"],
              ] as const
            ).map(([chaveDoModo, rotulo]) => (
              <button
                key={chaveDoModo}
                type="button"
                role="tab"
                aria-selected={modo === chaveDoModo}
                data-modo={chaveDoModo}
                onClick={() => {
                  setModo(chaveDoModo);
                  setErro("");
                }}
                className={`py-1.5 rounded-lg text-sm font-semibold ${modo === chaveDoModo ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"}`}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {insucesso ? (
            <>
              <p className="text-xs text-gray-500">Por que não foi possível entregar?</p>
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Motivo de não ter entregue">
                {MOTIVOS_DE_INSUCESSO.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={motivo === m}
                    data-motivo={m}
                    onClick={() => setMotivo(m)}
                    className={`${ESCOLHA} ${m === "OUTRO" ? "col-span-2 " : ""}${motivo === m ? ESCOLHIDA : NAO_ESCOLHIDA}`}
                  >
                    {ROTULO_DO_INSUCESSO[m]}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CartaoDeFoto tipo="FACHADA" fotos={fotos} onChange={setFotos} obrigatoria={pedeFachada} />
                <label className="block space-y-1 min-w-0">
                  <span className="text-xs font-medium text-gray-700">Observação{motivo === "OUTRO" ? "" : " (opcional)"}</span>
                  <textarea
                    rows={3}
                    maxLength={INSUCESSO_NOTE_MAX}
                    placeholder="Ex.: vizinho disse que volta às 18h"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    data-campo="note"
                    className={CAMPO}
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">O que aconteceu nesta entrega?</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo da ocorrência">
                {OCCURRENCE_TYPES.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={tipo === t} data-tipo={t} onClick={() => setTipo(t)} className={`${ESCOLHA} ${tipo === t ? ESCOLHIDA : NAO_ESCOLHIDA}`}>
                    {TIPO_DA_OCORRENCIA[t]}
                  </button>
                ))}
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-gray-700">Descrição</span>
                <textarea
                  rows={4}
                  maxLength={4000}
                  placeholder="Ex.: caixa chegou amassada, cliente recusou receber"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  data-campo="description"
                  className={CAMPO}
                />
              </label>
            </>
          )}

          {erro && (
            <p role="alert" className="text-sm text-red-600">
              {erro}
            </p>
          )}
          <button
            type="submit"
            disabled={ocupado}
            data-registrar
            aria-disabled={oQueFalta !== ""}
            className={`w-full font-medium py-3 rounded-2xl flex items-center justify-center text-white disabled:opacity-60 ${oQueFalta ? "bg-gray-400" : "bg-gray-900"}`}
          >
            {ocupado && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
            <span className="text-center leading-tight">{oQueFalta || (insucesso ? "Registrar tentativa sem sucesso" : "Registrar ocorrência")}</span>
          </button>
        </form>
      )}
    </div>
  );
}

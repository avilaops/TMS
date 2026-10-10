"use client";

import { use, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import {
  PERFIL_PADRAO,
  enumerar,
  fotoExigida,
  oQueFaltaNasFotos,
  ressalvaPedeFoto,
  rotuloDaRessalva,
  type ComprovanteParaRefazer,
  type FotoEnviada,
} from "@/lib/comprovantes";
import { assinarPerfil, buscarComprovantesDoMotorista, perfilLembrado } from "@/lib/comprovantes-motorista";
import { CartaoDeFoto } from "@/components/driver/CartaoDeFoto";

/**
 * Comprovante devolvido pela conferência: o motorista vê o motivo e manda
 * fotos novas (e, se precisar, corrige o nome e o documento de quem recebeu).
 * A carga continua entregue; o comprovante volta para a fila da conferência.
 * Precisa de sinal: diferente da baixa, não fica na fila offline. O servidor
 * aceita a repetição do mesmo envio sem gravar duas vezes.
 */

const FALHA = "Não foi possível enviar. Confira o sinal e tente de novo.";
const CAMPO = "block w-full min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500";

type Carga = { estado: "carregando" } | { estado: "erro" } | { estado: "nada" } | { estado: "pronto"; comprovante: ComprovanteParaRefazer };

export default function RefazerComprovante({ params }: { params: Promise<{ id: string }> }) {
  const collectionId = use(params).id;
  const router = useRouter();
  const perfil = useSyncExternalStore(assinarPerfil, perfilLembrado, () => PERFIL_PADRAO);

  const [carga, setCarga] = useState<Carga>({ estado: "carregando" });
  const [receiverName, setReceiverName] = useState("");
  const [receiverDoc, setReceiverDoc] = useState("");
  const [fotos, setFotos] = useState<FotoEnviada[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    let ativo = true;
    void buscarComprovantesDoMotorista().then((resposta) => {
      if (!ativo) return;
      if (!resposta) return setCarga({ estado: "erro" });
      const comprovante = resposta.refazer.find((item) => item.collectionId === collectionId);
      if (!comprovante) return setCarga({ estado: "nada" });
      setReceiverName(comprovante.receiverName);
      setReceiverDoc(comprovante.receiverDoc);
      setCarga({ estado: "pronto", comprovante });
    });
    return () => {
      ativo = false;
    };
  }, [collectionId]);

  const comprovante = carga.estado === "pronto" ? carga.comprovante : null;
  const tipos = fotos.map((foto) => foto.kind);
  const exigida = fotoExigida(perfil);
  const pedeAvaria = ressalvaPedeFoto(comprovante?.exceptionType);
  const pendencias = [
    ...(fotos.length === 0 ? ["pelo menos uma foto nova"] : []),
    ...oQueFaltaNasFotos(perfil, tipos, comprovante?.exceptionType),
    ...(receiverName.trim().length < 2 ? ["o nome"] : []),
    ...(receiverDoc.trim().length < 5 ? ["o documento"] : []),
  ];
  const oQueFalta = pendencias.length > 0 ? `Falta ${enumerar(pendencias)}` : "";

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comprovante) return;
    if (oQueFalta) return setErro(`${oQueFalta}.`);
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(`/api/driver/entregas/${collectionId}/refazer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionId: comprovante.rejectionId, photos: fotos, receiverName, receiverDoc }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) return setEnviado(true);
      setErro(corpo.error ?? FALHA);
    } catch {
      setErro(FALHA);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-3 pb-6">
      <div className="flex items-center text-white relative z-10">
        <button type="button" onClick={() => router.push("/driver")} aria-label="Voltar para o início" className="p-2 -ml-2 mr-2">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold font-outfit">Refazer comprovante</h1>
      </div>

      {enviado ? (
        <div role="status" className="bg-white rounded-3xl p-6 shadow-lg shadow-blue-900/5 relative z-10 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
          <p className="font-bold text-gray-900">Fotos novas enviadas</p>
          <p className="text-sm text-gray-500">O comprovante voltou para a conferência.</p>
          <button type="button" onClick={() => router.push("/driver")} className="block w-full bg-gray-900 text-white font-medium py-3 rounded-2xl">
            Voltar para o início
          </button>
        </div>
      ) : carga.estado === "carregando" ? (
        <div className="bg-white rounded-3xl p-6 shadow-lg shadow-blue-900/5 relative z-10 flex justify-center" role="status" aria-label="Carregando">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      ) : !comprovante ? (
        <div className="bg-white rounded-3xl p-6 shadow-lg shadow-blue-900/5 relative z-10 text-center space-y-4">
          <p role={carga.estado === "erro" ? "alert" : "status"} className="text-sm text-gray-600">
            {carga.estado === "erro" ? "Não foi possível carregar. Confira o sinal e abra de novo." : "Este comprovante não está na sua lista para refazer."}
          </p>
          <button type="button" onClick={() => router.push("/driver")} className="block w-full bg-gray-900 text-white font-medium py-3 rounded-2xl">
            Voltar para o início
          </button>
        </div>
      ) : (
        <form onSubmit={enviar} noValidate className="bg-white rounded-3xl p-3 shadow-lg shadow-blue-900/5 relative z-10 space-y-3">
          <div>
            <p className="font-bold text-gray-900 truncate">{comprovante.receiver}</p>
            <p className="text-xs text-gray-500 truncate">{comprovante.destination}</p>
          </div>
          <div data-motivo className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="text-[11px] font-semibold uppercase tracking-wide">Motivo da devolução</p>
            <p className="break-words">{comprovante.reason}</p>
          </div>
          {comprovante.exceptionType && <p className="text-xs text-amber-800">Entrega com ressalva: {rotuloDaRessalva(comprovante.exceptionType) ?? comprovante.exceptionType}</p>}

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-700">Fotos novas (substituem as anteriores)</p>
            <div className="grid grid-cols-2 gap-2">
              <CartaoDeFoto tipo="ENTREGA" fotos={fotos} onChange={setFotos} obrigatoria={exigida === "ENTREGA"} />
              <CartaoDeFoto tipo="CANHOTO" fotos={fotos} onChange={setFotos} obrigatoria={exigida === "CANHOTO"} />
              {comprovante.exceptionType && (
                <div className="col-span-2">
                  <CartaoDeFoto tipo="AVARIA" fotos={fotos} onChange={setFotos} obrigatoria={pedeAvaria} />
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <label className="block space-y-1 min-w-0">
              <span className="text-xs font-medium text-gray-700">Nome de quem recebeu</span>
              <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} maxLength={120} autoComplete="off" data-campo="receiverName" className={CAMPO} />
            </label>
            <label className="block space-y-1 min-w-0">
              <span className="text-xs font-medium text-gray-700">Documento</span>
              <input value={receiverDoc} onChange={(e) => setReceiverDoc(e.target.value)} maxLength={20} autoComplete="off" data-campo="receiverDoc" className={CAMPO} />
            </label>
          </div>

          {erro && (
            <p role="alert" className="text-sm text-red-600">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={ocupado}
            data-enviar
            aria-disabled={oQueFalta !== ""}
            className={`w-full font-medium py-3 rounded-2xl flex items-center justify-center text-white disabled:opacity-60 ${oQueFalta ? "bg-gray-400" : "bg-gray-900"}`}
          >
            {ocupado && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
            <span className="text-center leading-tight">{ocupado ? "Enviando..." : oQueFalta || "Enviar fotos novas"}</span>
          </button>
        </form>
      )}
    </div>
  );
}

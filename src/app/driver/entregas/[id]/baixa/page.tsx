'use client';

import { useEffect, useRef, useState, useSyncExternalStore, use } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AlertTriangle, ArrowLeft, Loader2, PenTool } from 'lucide-react';
import {
  DRIVER_BLOCKED_FALLBACK,
  SESSION_EXPIRED_MESSAGE,
  blockedMessage,
  classifyBaixaResponse,
  enqueue,
  isDriverBlocked,
  needsLogin,
  rememberedOwner,
} from '@/lib/offline-queue';
import {
  PERFIL_PADRAO,
  RELACOES,
  RESSALVAS,
  RESSALVA_NOTE_MAX,
  RESSALVA_NOTE_MIN,
  ROTULO_DA_RELACAO,
  ROTULO_DA_RESSALVA,
  ROTULO_DO_PERFIL_DE_COMPROVANTE,
  enumerar,
  fotoExigida,
  oQueFaltaNasFotos,
  ressalvaPedeFoto,
  type FotoEnviada,
  type PerfilDeComprovante,
  type Relacao,
  type Ressalva,
} from '@/lib/comprovantes';
import { assinarPerfil, buscarComprovantesDoMotorista, perfilLembrado, posicaoDoAparelho } from '@/lib/comprovantes-motorista';
import { createStrokeTracker } from '@/lib/assinatura';
import { enviarPosicaoAgora } from '@/lib/gps-motorista';
import { CartaoDeFoto } from '@/components/driver/CartaoDeFoto';

/**
 * Baixa de entrega pelo motorista, na porta do cliente: uma mão só e pressa.
 * Blocos curtos, nesta ordem: quem recebeu → nome e documento → fotos →
 * ressalva (recolhida) → assinatura (recolhida, sempre opcional) → finalizar.
 *
 * O que o perfil da empresa exige (foto da entrega no e-commerce, foto do
 * canhoto na carga B2B) aparece marcado, e o botão final diz o que falta em
 * vez de só ficar desligado. Quem impõe a regra é o servidor; a tela usa a
 * mesma conta (`oQueFaltaNasFotos`) para o motorista não descobrir só no envio.
 */

const CAMPO = 'block w-full min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500';
const ESCOLHA = 'min-w-0 px-1 py-2.5 rounded-2xl border text-sm font-medium';
const ESCOLHIDA = 'border-blue-600 bg-blue-50 text-blue-700';
const NAO_ESCOLHIDA = 'border-gray-200 bg-white text-gray-700';

export default function DeliveryProofPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  // A entrega é a própria carga: o `[id]` da rota é o da coleta.
  const collectionId = use(params).id;
  const { data: session } = useSession();

  const [relacao, setRelacao] = useState<Relacao | ''>('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [fotos, setFotos] = useState<FotoEnviada[]>([]);
  const [signatureBase64, setSignatureBase64] = useState<string>('');
  const [assinando, setAssinando] = useState(false);
  const [comRessalva, setComRessalva] = useState(false);
  const [tipoDaRessalva, setTipoDaRessalva] = useState<Ressalva | ''>('');
  const [descricaoDaRessalva, setDescricaoDaRessalva] = useState('');
  // O perfil lembrado no aparelho vale na hora (é o que há sem sinal); a
  // consulta abaixo o atualiza quando o servidor responde.
  const perfil: PerfilDeComprovante = useSyncExternalStore(assinarPerfil, perfilLembrado, () => PERFIL_PADRAO);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void buscarComprovantesDoMotorista();
  }, []);

  // Quadro de assinatura
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef(createStrokeTracker());

  const ponto = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    // O quadro é mais largo no desenho do que na tela: sem a escala, o traço sai deslocado.
    return { x: ((clientX - rect.left) * canvas.width) / (rect.width || canvas.width), y: ((clientY - rect.top) * canvas.height) / (rect.height || canvas.height) };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    strokes.current.start();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = ponto(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!strokes.current.move()) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = ponto(e, canvas);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDrawing = () => {
    // Ponteiro que só passou pelo quadro, ou toque sem traço, não é assinatura:
    // o quadro em branco viraria um PNG vazio no comprovante.
    if (!strokes.current.end()) return;
    if (canvasRef.current) {
      setSignatureBase64(canvasRef.current.toDataURL());
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    strokes.current.clear();
    setSignatureBase64('');
  };

  const fecharAssinatura = () => {
    strokes.current.clear();
    setSignatureBase64('');
    setAssinando(false);
  };

  const fecharRessalva = () => {
    setComRessalva(false);
    setTipoDaRessalva('');
    setDescricaoDaRessalva('');
    // Foto de avaria só existe com ressalva.
    setFotos((atuais) => atuais.filter((foto) => foto.kind !== 'AVARIA'));
  };

  const tipos = fotos.map((foto) => foto.kind);
  const exigida = fotoExigida(perfil);
  const descricao = descricaoDaRessalva.trim();

  // O que ainda falta para finalizar, na ordem da tela.
  const pendencias = [
    ...(relacao === '' ? ['quem recebeu'] : []),
    ...(receiverName.trim().length < 2 ? ['o nome'] : []),
    ...(receiverDoc.trim().length < 5 ? ['o documento'] : []),
    ...(comRessalva && tipoDaRessalva === '' ? ['o tipo da ressalva'] : []),
    ...(comRessalva && (descricao.length < RESSALVA_NOTE_MIN || descricao.length > RESSALVA_NOTE_MAX) ? ['a descrição da ressalva'] : []),
    ...oQueFaltaNasFotos(perfil, tipos, comRessalva ? tipoDaRessalva : null),
  ];
  const oQueFalta = pendencias.length > 0 ? `Falta ${enumerar(pendencias)}` : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (oQueFalta) {
      setError(`${oQueFalta}.`);
      return;
    }
    setLoading(true);
    setError('');

    try {
      // A posição entra quando o aparelho informa; sem ela a baixa segue igual.
      const { latitude, longitude } = await posicaoDoAparelho();

      const payload = {
        receiverName,
        receiverDoc,
        receiverRelation: relacao,
        photos: fotos,
        signatureBase64,
        exception: comRessalva ? { type: tipoDaRessalva, note: descricao } : null,
        latitude,
        longitude,
      };

      // Entregar costuma ser justamente onde o sinal cai. Em vez de perder o
      // comprovante, a baixa vai para a fila local e sobe quando a rede voltar.
      // Se o aparelho não conseguir guardar (sem espaço), `enqueue` falha com a
      // mensagem para o motorista e a tela fica como está, com tudo preenchido.
      const guardar = async () => {
        // Sem sinal a sessão pode não ter carregado: vale o último usuário confirmado.
        await enqueue(collectionId, payload, session?.user?.id ?? rememberedOwner());
        window.dispatchEvent(new Event('mello:baixa-enfileirada'));
      };
      const guardarNaFila = async () => {
        await guardar();
        router.push('/driver');
        router.refresh();
      };

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await guardarNaFila();
        return;
      }

      let res: Response;
      try {
        res = await fetch(`/api/driver/entregas/${collectionId}/baixa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // Caiu a rede no meio do envio.
        await guardarNaFila();
        return;
      }

      if (!res.ok) {
        // Mesma regra do reenvio da fila: 5xx, 408 e 429 podem ser momentâneos;
        // os demais 4xx são recusa definitiva e precisam aparecer.
        if (classifyBaixaResponse(res.status) === 'retry') {
          if (needsLogin(res.status)) {
            // Sessão caída: o comprovante fica no aparelho e o motorista é
            // avisado aqui, em vez de perder o que acabou de colher.
            await guardar();
            throw new Error(SESSION_EXPIRED_MESSAGE);
          }
          if (isDriverBlocked(res.status)) {
            // Cadastro parado: entrar de novo não resolve. O comprovante fica
            // no aparelho e o motorista vê o motivo que o servidor deu.
            const data = await res.json().catch(() => null);
            await guardar();
            throw new Error(blockedMessage(typeof data?.error === 'string' ? data.error : DRIVER_BLOCKED_FALLBACK));
          }
          await guardarNaFila();
          return;
        }
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Erro ao registrar baixa');
      }

      // Com a localização compartilhada, a posição sai também na hora da entrega
      // (além do envio a cada 30 segundos). Sem compartilhamento, não faz nada.
      void enviarPosicaoAgora();

      router.push('/driver');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar baixa');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 pb-6">
      <div className="flex items-center text-white relative z-10">
        <button type="button" onClick={() => router.back()} aria-label="Voltar para a viagem" className="p-2 -ml-2 mr-2">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold font-outfit">Baixa de entrega</h1>
      </div>

      <form onSubmit={handleSubmit} noValidate className="bg-white rounded-3xl p-3 shadow-lg shadow-blue-900/5 relative z-10 space-y-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-700">Quem recebeu</p>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Quem recebeu">
            {RELACOES.map((opcao) => (
              <button
                key={opcao}
                type="button"
                role="radio"
                aria-checked={relacao === opcao}
                data-relacao={opcao}
                onClick={() => setRelacao(opcao)}
                className={`${ESCOLHA} ${relacao === opcao ? ESCOLHIDA : NAO_ESCOLHIDA}`}
              >
                {ROTULO_DA_RELACAO[opcao]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <label className="block space-y-1 min-w-0">
            <span className="text-xs font-medium text-gray-700">Nome</span>
            <input id="receiverName" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} maxLength={120} autoComplete="off" className={CAMPO} />
          </label>
          <label className="block space-y-1 min-w-0">
            <span className="text-xs font-medium text-gray-700">Documento (CPF/RG)</span>
            <input id="receiverDoc" value={receiverDoc} onChange={(e) => setReceiverDoc(e.target.value)} maxLength={20} autoComplete="off" inputMode="numeric" className={CAMPO} />
          </label>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-700 flex items-center justify-between gap-2">
            <span>Fotos</span>
            {perfil !== 'LIVRE' && (
              <span data-perfil={perfil} className="text-[11px] font-normal text-gray-500">
                Perfil {ROTULO_DO_PERFIL_DE_COMPROVANTE[perfil]}
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <CartaoDeFoto tipo="ENTREGA" fotos={fotos} onChange={setFotos} obrigatoria={exigida === 'ENTREGA'} />
            <CartaoDeFoto tipo="CANHOTO" fotos={fotos} onChange={setFotos} obrigatoria={exigida === 'CANHOTO'} />
            {comRessalva && (
              <div className="col-span-2">
                <CartaoDeFoto tipo="AVARIA" fotos={fotos} onChange={setFotos} obrigatoria={ressalvaPedeFoto(tipoDaRessalva)} rotulo="+ Avaria" />
              </div>
            )}
          </div>
        </div>

        {comRessalva ? (
          <div data-ressalva className="rounded-2xl border border-amber-200 bg-amber-50 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-amber-900">Entrega com ressalva</p>
              <button type="button" onClick={fecharRessalva} className="text-xs font-medium text-amber-900 underline">
                Tirar ressalva
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Tipo da ressalva">
              {RESSALVAS.map((opcao) => (
                <button
                  key={opcao}
                  type="button"
                  role="radio"
                  aria-checked={tipoDaRessalva === opcao}
                  data-ressalva-tipo={opcao}
                  onClick={() => setTipoDaRessalva(opcao)}
                  className={`${ESCOLHA} ${tipoDaRessalva === opcao ? 'border-amber-600 bg-white text-amber-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
                >
                  {ROTULO_DA_RESSALVA[opcao]}
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              maxLength={RESSALVA_NOTE_MAX}
              placeholder="O que houve? Ex.: caixa amassada no canto, faltou 1 volume"
              aria-label="Descrição da ressalva"
              value={descricaoDaRessalva}
              onChange={(e) => setDescricaoDaRessalva(e.target.value)}
              className={`${CAMPO} bg-white`}
            />
          </div>
        ) : (
          <button
            type="button"
            data-abrir-ressalva
            onClick={() => setComRessalva(true)}
            className="w-full py-2.5 rounded-2xl border border-gray-200 text-sm font-medium text-gray-700 flex items-center justify-center"
          >
            <AlertTriangle className="w-4 h-4 mr-2 text-amber-600" /> Entrega com ressalva
          </button>
        )}

        {assinando ? (
          <div data-assinatura className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-gray-700">Assinatura na tela (opcional)</p>
              <div className="flex gap-3 text-xs font-medium">
                <button type="button" onClick={clearSignature} className="text-blue-700">
                  Limpar
                </button>
                <button type="button" onClick={fecharAssinatura} className="text-gray-600">
                  Sem assinatura
                </button>
              </div>
            </div>
            <div className="border rounded-xl overflow-hidden bg-white">
              <canvas
                ref={canvasRef}
                width={350}
                height={130}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={endDrawing}
                onMouseLeave={endDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={endDrawing}
                className="w-full touch-none"
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-abrir-assinatura
            onClick={() => setAssinando(true)}
            className="w-full py-2.5 rounded-2xl border border-gray-200 text-sm font-medium text-gray-700 flex items-center justify-center"
          >
            <PenTool className="w-4 h-4 mr-2 text-blue-600" /> Colher assinatura na tela
          </button>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {/* Não fica desligado quando falta algo: diz o que falta, e o toque repete o aviso. */}
        <button
          type="submit"
          disabled={loading}
          data-finalizar
          aria-disabled={oQueFalta !== ''}
          className={`w-full font-medium py-3 rounded-2xl flex items-center justify-center text-white disabled:opacity-60 ${oQueFalta ? 'bg-gray-400' : 'bg-gray-900'}`}
        >
          {loading && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          <span className="text-center leading-tight">{loading ? 'Enviando...' : oQueFalta || 'Finalizar entrega'}</span>
        </button>
      </form>
    </div>
  );
}

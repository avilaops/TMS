'use client';

import { useState, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { PHOTO_MIME_TYPES, photoProblem, resolvePhotoType } from '@/lib/entregas';
import { createStrokeTracker } from '@/lib/assinatura';
import { enviarPosicaoAgora } from '@/lib/gps-motorista';

export default function DeliveryProofPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  // A entrega é a própria carga: o `[id]` da rota é o da coleta.
  const collectionId = use(params).id;
  const { data: session } = useSession();
  
  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string>('');
  const [signatureBase64, setSignatureBase64] = useState<string>('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;

    // Foto que chega sem tipo é identificada pelos primeiros bytes.
    const header = file.type === '' ? new Uint8Array(await file.slice(0, 12).arrayBuffer()) : new Uint8Array();
    const type = resolvePhotoType(file.type, header);

    // HEIC e foto grande demais o servidor recusa: avisa já, antes do envio.
    const problem = photoProblem({ type, size: file.size });
    if (problem) {
      setPhotoBase64('');
      setPhotoError(problem);
      input.value = '';
      return;
    }

    setPhotoError('');
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoBase64(reader.result as string);
    };
    // O tipo conferido vai no arquivo lido: é ele que vira o prefixo `data:<tipo>`.
    reader.readAsDataURL(file.type === type ? file : new Blob([file], { type }));
  };

  // Funções simples para Canvas de Assinatura
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef(createStrokeTracker());

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    strokes.current.start();
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        ctx.moveTo(clientX - rect.left, clientY - rect.top);
      }
    }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!strokes.current.move()) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        ctx.lineTo(clientX - rect.left, clientY - rect.top);
        ctx.stroke();
      }
    }
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
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    strokes.current.clear();
    setSignatureBase64('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Tentar obter geolocalização, mas não bloquear se falhar
      let latitude = null;
      let longitude = null;
      
      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        } catch (geoErr) {
          console.log('Geolocalização indisponível ou negada', geoErr);
        }
      }

      const payload = {
        receiverName,
        receiverDoc,
        photoBase64,
        signatureBase64,
        latitude,
        longitude,
      };

      // Entregar costuma ser justamente onde o sinal cai. Em vez de perder o
      // comprovante, a baixa vai para a fila local e sobe quando a rede voltar.
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
    <div className="container mx-auto p-4 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Baixa de Entrega</CardTitle>
          <CardDescription>Registre o comprovante (POD) para finalizar a entrega.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div className="space-y-2">
              <Label htmlFor="receiverName">Nome do Recebedor</Label>
              <Input 
                id="receiverName" 
                value={receiverName} 
                onChange={(e) => setReceiverName(e.target.value)} 
                required 
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="receiverDoc">Documento (CPF/RG)</Label>
              <Input 
                id="receiverDoc" 
                value={receiverDoc} 
                onChange={(e) => setReceiverDoc(e.target.value)} 
                required 
              />
            </div>

            <div className="space-y-2">
              <Label>Foto do Local/Mercadoria</Label>
              <Input 
                type="file" 
                accept={PHOTO_MIME_TYPES.join(',')}
                capture="environment" 
                onChange={handlePhotoCapture}
                ref={fileInputRef}
                className="hidden"
              />
              <div 
                className="border-2 border-dashed border-gray-300 rounded-md p-4 text-center cursor-pointer hover:bg-gray-50 flex flex-col items-center justify-center min-h-[150px]"
                onClick={() => fileInputRef.current?.click()}
              >
                {photoBase64 ? (
                  // eslint-disable-next-line @next/next/no-img-element -- imagem embutida (data URL), não há o que otimizar
                  <img src={photoBase64} alt="Foto da entrega" className="max-h-40 object-contain" />
                ) : (
                  <span className="text-gray-500">Toque para abrir a câmera</span>
                )}
              </div>
              {photoError && <p role="alert" className="text-red-500 text-sm">{photoError}</p>}
            </div>

            <div className="space-y-2">
              <Label>Assinatura Digital</Label>
              <div className="border rounded-md overflow-hidden bg-white">
                <canvas 
                  ref={canvasRef}
                  width={350} 
                  height={150}
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
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={clearSignature}>Limpar</Button>
              </div>
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}
            
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Enviando...' : 'Finalizar Entrega'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import { useState, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { enqueue } from '@/lib/offline-queue';

export default function DeliveryProofPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const deliveryId = use(params).id;
  
  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string>('');
  const [signatureBase64, setSignatureBase64] = useState<string>('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Funções simples para Canvas de Assinatura
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
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
    if (!isDrawing) return;
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
    setIsDrawing(false);
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
        setSignatureBase64('');
      }
    }
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
      const guardarNaFila = async () => {
        await enqueue(deliveryId, payload);
        window.dispatchEvent(new Event('mello:baixa-enfileirada'));
        router.push('/driver');
        router.refresh();
      };

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await guardarNaFila();
        return;
      }

      let res: Response;
      try {
        res = await fetch(`/api/driver/entregas/${deliveryId}/baixa`, {
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
        // 5xx pode ser momentâneo; 4xx é recusa definitiva e precisa aparecer.
        if (res.status >= 500) {
          await guardarNaFila();
          return;
        }
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Erro ao registrar baixa');
      }

      router.push('/driver');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
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
                accept="image/*" 
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
                  <img src={photoBase64} alt="Foto da entrega" className="max-h-40 object-contain" />
                ) : (
                  <span className="text-gray-500">Toque para abrir a câmera</span>
                )}
              </div>
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

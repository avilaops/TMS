'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  REJECTION_REASON_MAX,
  REJECTION_REASON_MESSAGE,
  REJECTION_REASON_MIN,
  type ReviewDecision,
} from '@/lib/entregas';

/** Botões de aprovar e recusar o comprovante que aguarda conferência. */
export function Conferencia({ collectionId }: { collectionId: string }) {
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const decidir = async (decision: ReviewDecision) => {
    const reason = motivo.trim();
    if (decision === 'REJECTED' && (reason.length < REJECTION_REASON_MIN || reason.length > REJECTION_REASON_MAX)) {
      setErro(REJECTION_REASON_MESSAGE);
      return;
    }

    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/comprovantes/${collectionId}/conferir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'REJECTED' ? { decision, reason } : { decision }),
      });
      if (res.ok) {
        // A página é montada no servidor: recarregar traz a decisão gravada.
        window.location.reload();
        return;
      }
      const data = await res.json().catch(() => null);
      setErro(data?.error || 'Não foi possível registrar a conferência.');
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    }
    setEnviando(false);
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-sm text-gray-500">Conferência</p>

      {recusando ? (
        <div className="space-y-2">
          <label htmlFor="motivo-da-recusa" className="text-sm font-medium">
            Motivo da recusa
          </label>
          <textarea
            id="motivo-da-recusa"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={REJECTION_REASON_MAX}
            rows={3}
            className="w-full rounded-md border border-gray-300 p-2 text-sm"
            placeholder="Ex.: foto ilegível, assinatura não confere com o recebedor."
          />
          <div className="flex gap-2">
            <Button
              onClick={() => decidir('REJECTED')}
              disabled={enviando}
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              Confirmar recusa
            </Button>
            <Button
              onClick={() => {
                setRecusando(false);
                setErro(null);
              }}
              disabled={enviando}
              variant="ghost"
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button onClick={() => decidir('APPROVED')} disabled={enviando} className="bg-green-600 hover:bg-green-700">
            Aprovar
          </Button>
          <Button
            onClick={() => setRecusando(true)}
            disabled={enviando}
            variant="outline"
            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
          >
            Recusar
          </Button>
        </div>
      )}

      {erro && (
        <p role="alert" className="text-sm text-red-700">
          {erro}
        </p>
      )}
    </div>
  );
}

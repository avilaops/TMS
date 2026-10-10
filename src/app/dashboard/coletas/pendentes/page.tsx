'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { janelaDaColeta } from '@/lib/coletas';

type Collection = {
  id: string;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  invoiceValue: number | null;
  // O que o cliente pediu: janela de horário, urgência, cubagem e observação.
  pickupDate: string | null;
  pickupFrom: string | null;
  pickupTo: string | null;
  priority: string;
  cubicMeters: number | null;
  pickupNotes: string | null;
  status: string;
  createdAt: string;
  client: { companyName: string };
};

export default function PendentesPage() {
  const router = useRouter();
  const [coletas, setColetas] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  const loadColetas = async () => {
    try {
      const res = await fetch('/api/dashboard/coletas/pendentes');
      if (res.ok) {
        const data = await res.json();
        setColetas(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadColetas();
  }, []);

  const handleStatusUpdate = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/dashboard/coletas/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        loadColetas();
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error || 'Erro ao atualizar coleta');
        // A lista pode estar velha (outro operador já decidiu este pedido).
        loadColetas();
      }
    } catch (err) {
      console.error(err);
      alert('Erro na requisição');
    }
  };

  if (loading) return <div className="p-6">Carregando solicitações...</div>;

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Solicitações de Coleta (Pendentes)</h1>
        <p className="text-gray-500">Avalie os pedidos vindos do Portal B2B.</p>
      </div>

      <div className="space-y-4">
        {coletas.length === 0 ? (
          <div className="py-12 text-center text-gray-500 border rounded-lg bg-gray-50">
            Nenhuma solicitação pendente no momento.
          </div>
        ) : (
          coletas.map(coleta => (
            <Card key={coleta.id} className="flex flex-col md:flex-row justify-between items-center p-4 shadow-sm hover:shadow transition-shadow">
              <div className="w-full md:w-3/4 space-y-2">
                <div className="flex items-center space-x-3">
                  <Badge variant="secondary" className="font-mono text-xs">{coleta.id.substring(0, 8)}</Badge>
                  <span className="font-semibold text-lg">{coleta.client.companyName}</span>
                  {coleta.priority === 'URGENT' && <Badge variant="destructive">Urgente</Badge>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600 mt-2">
                  <div>
                    <p><span className="font-medium text-gray-800">Origem:</span> {coleta.origin} ({coleta.sender})</p>
                    <p><span className="font-medium text-gray-800">Destino:</span> {coleta.destination} ({coleta.receiver})</p>
                  </div>
                  <div>
                    <p><span className="font-medium text-gray-800">Volumes:</span> {coleta.volumes} un</p>
                    <p><span className="font-medium text-gray-800">Peso:</span> {coleta.weight} kg</p>
                    {coleta.invoiceValue && <p><span className="font-medium text-gray-800">Valor NF:</span> R$ {coleta.invoiceValue}</p>}
                    {coleta.cubicMeters !== null && <p><span className="font-medium text-gray-800">Cubagem:</span> {coleta.cubicMeters.toLocaleString('pt-BR')} m³</p>}
                    {janelaDaColeta(coleta) && <p><span className="font-medium text-gray-800">Coletar:</span> {janelaDaColeta(coleta)}</p>}
                    {coleta.pickupNotes && <p className="break-words"><span className="font-medium text-gray-800">Observação:</span> {coleta.pickupNotes}</p>}
                  </div>
                </div>
              </div>
              
              <div className="w-full md:w-1/4 mt-4 md:mt-0 flex flex-row md:flex-col gap-2 justify-end items-end">
                <Button 
                  onClick={() => handleStatusUpdate(coleta.id, 'CONFIRMED')}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  Aprovar Coleta
                </Button>
                <Button 
                  onClick={() => handleStatusUpdate(coleta.id, 'REJECTED')}
                  variant="outline" 
                  className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  Recusar
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

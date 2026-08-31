"use client";

import { MessageSquare, Check, CheckCheck, Clock, Search } from "lucide-react";

const messages = [
  {
    id: 1,
    recipient: "João Motorista",
    type: "DRIVER",
    content: "Olá João, nova coleta atribuída a você: Carga #891. Destino: São Paulo, SP.",
    status: "READ",
    time: "10:30"
  },
  {
    id: 2,
    recipient: "Tech Corp",
    type: "CLIENT",
    content: "Olá Tech Corp, sua mercadoria (CT-e #1492) acaba de sair para entrega. Previsão: 14:00.",
    status: "DELIVERED",
    time: "11:15"
  },
  {
    id: 3,
    recipient: "Maria Motorista",
    type: "DRIVER",
    content: "Alerta: Viagem #102 com atraso identificado na rota. Confirme se está tudo bem.",
    status: "SENT",
    time: "12:00"
  },
  {
    id: 4,
    recipient: "Indústrias Acme",
    type: "CLIENT",
    content: "Olá! Informamos que a entrega CT-e #1495 foi concluída com sucesso. Obrigado por viajar com a Mello!",
    status: "READ",
    time: "14:45"
  }
];

export default function MensagensPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Central de Mensageria</h1>
          <p className="text-gray-500 text-sm mt-1">Histórico de notificações enviadas (WhatsApp e SMS).</p>
        </div>
        
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input 
            type="text" 
            placeholder="Buscar por destinatário..." 
            className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-900 dark:text-white"
          />
        </div>
      </div>

      <div className="grid gap-4">
        {messages.map(msg => (
          <div key={msg.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl flex flex-col md:flex-row gap-4 items-start md:items-center shadow-sm">
            <div className={`p-3 rounded-xl flex-shrink-0 ${
              msg.type === 'CLIENT' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600'
            }`}>
              <MessageSquare className="w-6 h-6" />
            </div>
            
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-medium text-gray-900 dark:text-white">{msg.recipient}</h4>
                <span className="text-xs text-gray-400 flex items-center">
                  <Clock className="w-3 h-3 mr-1" /> {msg.time}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-100 dark:border-gray-800 mt-2">
                {msg.content}
              </p>
            </div>
            
            <div className="flex-shrink-0 flex items-center justify-end w-24">
              {msg.status === 'READ' && (
                <span className="flex items-center text-blue-500 text-xs font-medium">
                  <CheckCheck className="w-4 h-4 mr-1" /> Lida
                </span>
              )}
              {msg.status === 'DELIVERED' && (
                <span className="flex items-center text-gray-500 dark:text-gray-400 text-xs font-medium">
                  <CheckCheck className="w-4 h-4 mr-1" /> Entregue
                </span>
              )}
              {msg.status === 'SENT' && (
                <span className="flex items-center text-gray-400 text-xs font-medium">
                  <Check className="w-4 h-4 mr-1" /> Enviada
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

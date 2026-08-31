"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, CheckCircle2, Package, Clock, ShieldCheck, Loader2, PenTool, Camera, X } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

export default function ViagemDetalhes() {
  const params = useParams();
  const router = useRouter();
  const [manifesto, setManifesto] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // POD Modal State
  const [activeColeta, setActiveColeta] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [receiverName, setReceiverName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    fetchManifesto();
  }, [params.id]);

  const fetchManifesto = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/driver/manifestos');
      if (res.ok) {
        const all = await res.json();
        const found = all.find((m: any) => m.id === params.id);
        setManifesto(found);
      }
    } catch (error) {
      console.error("Failed to fetch manifesto", error);
    } finally {
      setIsLoading(false);
    }
  };

  const startDrawing = (e: any) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: any) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleSavePOD = () => {
    if (!activeColeta) return;
    if (!receiverName) {
      alert("Por favor, informe o nome de quem recebeu.");
      return;
    }
    
    setIsSigning(true);
    // Simula envio pro backend
    setTimeout(() => {
      setManifesto((prev: any) => ({
        ...prev,
        collections: prev.collections.map((c: any) => 
          c.id === activeColeta ? { ...c, status: 'DELIVERED', receiverName } : c
        )
      }));
      setIsSigning(false);
      setActiveColeta(null);
      setReceiverName("");
    }, 1500);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 mt-10">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-500 font-medium">Carregando viagem...</p>
      </div>
    );
  }

  if (!manifesto) {
    return (
      <div className="text-center mt-20">
        <p className="text-gray-500">Viagem não encontrada.</p>
        <button onClick={() => router.push('/driver')} className="text-blue-600 font-medium mt-4">
          Voltar
        </button>
      </div>
    );
  }

  const pendentes = manifesto.collections.filter((c: any) => c.status !== 'DELIVERED').length;
  const concluidas = manifesto.collections.length - pendentes;
  const progress = (concluidas / manifesto.collections.length) * 100;

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center text-white mb-2 relative z-10">
        <Link href="/driver" className="p-2 -ml-2 mr-2">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-xl font-bold font-outfit">Viagem #{manifesto.id.substring(0,6).toUpperCase()}</h1>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-lg shadow-blue-900/5 relative z-10 -mt-2">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm font-medium text-gray-500">Progresso</span>
          <span className="text-sm font-bold text-blue-600">{concluidas} / {manifesto.collections.length}</span>
        </div>
        
        <div className="w-full bg-gray-100 rounded-full h-3 mb-2 overflow-hidden">
          <div 
            className="bg-blue-600 h-3 rounded-full transition-all duration-1000 ease-out" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        
        <div className="flex justify-between text-xs font-medium text-gray-400">
          <span>{pendentes} Restantes</span>
          <span>{Math.round(progress)}% Concluído</span>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-bold text-gray-900 px-1">Entregas / Coletas</h3>
        
        {manifesto.collections?.map((coleta: any, index: number) => {
          const isDelivered = coleta.status === 'DELIVERED';
          
          return (
            <div 
              key={coleta.id} 
              className={`bg-white rounded-3xl p-5 shadow-sm border ${isDelivered ? 'border-green-200 bg-green-50/30' : 'border-gray-100'}`}
            >
              <div className="flex justify-between items-start mb-3">
                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${isDelivered ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                  Parada {index + 1}
                </span>
                {isDelivered && (
                  <span className="flex items-center text-green-600 text-xs font-bold">
                    <ShieldCheck className="w-4 h-4 mr-1" /> Realizada
                  </span>
                )}
              </div>

              <h4 className="font-bold text-gray-900 mb-2">
                {coleta.client?.tradeName || coleta.client?.companyName}
              </h4>
              
              <div className="flex items-start space-x-2 text-sm text-gray-600 mb-1">
                <MapPin className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />
                <span>{coleta.destination}</span>
              </div>
              
              <div className="flex items-center space-x-2 text-sm text-gray-600 mb-4">
                <Package className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span>{coleta.volumes} volumes ({coleta.weight} kg)</span>
              </div>

              {!isDelivered ? (
                <button 
                  onClick={() => setActiveColeta(coleta.id)}
                  className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-3 rounded-2xl flex items-center justify-center transition-colors shadow-lg shadow-gray-900/20"
                >
                  <PenTool className="w-5 h-5 mr-2" /> Coletar Assinatura
                </button>
              ) : (
                <div className="w-full bg-green-100 text-green-800 font-medium py-3 rounded-2xl flex flex-col items-center justify-center opacity-90 cursor-default">
                  <div className="flex items-center"><CheckCircle2 className="w-5 h-5 mr-2" /> Comprovante Assinado</div>
                  <span className="text-xs mt-1 text-green-700 font-normal">Recebedor: {coleta.receiverName}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <AnimatePresence>
        {activeColeta && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end"
          >
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-white rounded-t-3xl p-6 w-full max-w-md mx-auto"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg font-outfit text-gray-900">Comprovante de Entrega</h3>
                <button onClick={() => setActiveColeta(null)} className="p-2 bg-gray-100 rounded-full text-gray-500">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Nome do Recebedor</label>
                  <input 
                    type="text" 
                    value={receiverName}
                    onChange={(e) => setReceiverName(e.target.value)}
                    placeholder="Quem está recebendo a mercadoria?"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-end mb-1">
                    <label className="text-sm font-medium text-gray-700">Assinatura</label>
                    <button onClick={clearSignature} className="text-xs text-blue-600 font-medium">Limpar</button>
                  </div>
                  <div className="border border-gray-200 rounded-xl bg-gray-50 overflow-hidden touch-none relative">
                    <canvas 
                      ref={canvasRef}
                      width={400}
                      height={150}
                      className="w-full bg-transparent cursor-crosshair"
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseOut={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <span className="text-gray-300 text-2xl font-outfit uppercase tracking-widest opacity-30 rotate-[-10deg]">Assine Aqui</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <button className="flex-1 border border-gray-200 bg-white py-3 rounded-xl font-medium text-gray-700 flex justify-center items-center">
                    <Camera className="w-5 h-5 mr-2" /> Tirar Foto
                  </button>
                </div>

                <button 
                  onClick={handleSavePOD}
                  disabled={isSigning}
                  className="w-full bg-blue-600 text-white font-medium py-4 rounded-2xl mt-4 shadow-lg shadow-blue-600/30 flex items-center justify-center transition-all disabled:bg-blue-400"
                >
                  {isSigning ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Salvando...</>
                  ) : (
                    "Finalizar Entrega"
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

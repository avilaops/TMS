"use client";

import { use } from "react";
import { OcorrenciaDaEntrega } from "@/components/driver/OcorrenciaDaEntrega";

/**
 * Ocorrência numa entrega, registrada pelo motorista: abre em "Outra
 * ocorrência" (avaria, atraso, reentrega…). A mesma tela registra a tentativa
 * de entrega sem sucesso (/driver/entregas/[id]/insucesso abre direto nela).
 */
export default function OcorrenciaDoMotorista({ params }: { params: Promise<{ id: string }> }) {
  return <OcorrenciaDaEntrega collectionId={use(params).id} inicio="ocorrencia" />;
}

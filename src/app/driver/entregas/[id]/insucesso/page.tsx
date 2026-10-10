"use client";

import { use } from "react";
import { OcorrenciaDaEntrega } from "@/components/driver/OcorrenciaDaEntrega";

/**
 * "Não entreguei": a tela de ocorrência do motorista aberta direto na
 * tentativa de entrega sem sucesso (motivo padronizado e foto da fachada).
 */
export default function InsucessoDoMotorista({ params }: { params: Promise<{ id: string }> }) {
  return <OcorrenciaDaEntrega collectionId={use(params).id} inicio="insucesso" />;
}

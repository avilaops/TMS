import { confirmarPedido } from "@/lib/lojas-logistica-db";
import { mutacaoLojas } from "../_route";

export async function POST(request: Request, contexto: { params: Promise<{ empresa: string }> }) {
  return mutacaoLojas(request, (await contexto.params).empresa, confirmarPedido);
}

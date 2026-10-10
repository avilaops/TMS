import { redirect } from "next/navigation";

/**
 * A manutenção virou uma aba da tela de frota do veículo
 * (`/dashboard/veiculos/[id]`). Este endereço continua valendo para quem o
 * guardou: leva para lá.
 */
export default async function ManutencaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/veiculos/${id}`);
}

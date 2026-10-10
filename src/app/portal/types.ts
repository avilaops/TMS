export type PortalCollection = {
  id: string;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  invoiceValue: number | null;
  status: string;
  createdAt: string;
  trackingCode: string | null;
  driver?: { user: { name: string } } | null;
  // Só na lista de coletas (a visão geral não pede estes campos).
  freightValue?: number | null;
  pickupDate?: string | null;
  pickupFrom?: string | null;
  pickupTo?: string | null;
  priority?: string;
  cubicMeters?: number | null;
  pickupNotes?: string | null;
};

export type PortalInvoice = {
  id: string;
  amount: number;
  description: string;
  dueDate: string | null;
  status: string;
  createdAt: string;
  /** Pix Copia e Cola do título em aberto; nulo se a transportadora não cadastrou chave. */
  pix: string | null;
};

/** Lê a resposta da API do portal e transforma erro em mensagem legível. */
export async function readPortal<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Não foi possível carregar os dados.");
  }
  return response.json() as Promise<T>;
}

// Carga da tela de manifestos, fora do componente para poder ser testada sem
// navegador (tests/manifestos.test.ts).

export interface Cliente {
  tradeName: string | null;
  companyName: string;
}

export interface Minuta {
  id: string;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  client: Cliente;
  status: string;
  manifestId: string | null;
  // Endereço da entrega, além da cidade. Tudo opcional (src/lib/endereco.ts).
  deliveryStreet?: string | null;
  deliveryNumber?: string | null;
  deliveryDistrict?: string | null;
  deliveryZip?: string | null;
}

export interface Motorista {
  id: string;
  user: { name: string };
  cpf: string;
  active: boolean;
}

export interface Veiculo {
  id: string;
  plate: string;
  model: string;
  type: string;
  status: string;
}

export interface Manifesto {
  id: string;
  status: string;
  createdAt: string;
  driver: Motorista;
  vehicle: Veiculo;
  collections: Minuta[];
  // Dados da viagem, todos opcionais (src/lib/viagem.ts).
  helper?: { id: string; name: string } | null;
  departureOdometer?: number | null;
  returnOdometer?: number | null;
  plannedDepartureAt?: string | null;
  plannedReturnAt?: string | null;
  notes?: string | null;
  departedAt?: string | null;
  finishedAt?: string | null;
  // Quando o motorista compartilhou a posição pela última vez (src/lib/posicao.ts).
  lastPositionAt?: string | null;
}

export type ManifestosData = {
  manifestos: Manifesto[];
  coletas: Minuta[];
  motoristas: Motorista[];
  veiculos: Veiculo[];
};

// `expired`: a sessão caiu (401) e tentar de novo não resolve, só entrar de
// novo. `cause` é o que vai para o console: a chamada que falhou ou a exceção.
export type ManifestosState =
  | { status: "loading" }
  | { status: "expired"; cause: string }
  | { status: "error"; cause: unknown }
  | ({ status: "ready" } & ManifestosData);

export const MANIFESTOS_ENDPOINTS = ["/api/manifestos", "/api/coletas", "/api/motoristas", "/api/veiculos"] as const;

/**
 * As quatro chamadas da tela. Qualquer uma que falhe derruba a carga inteira:
 * com a lista de manifestos vazia por causa de um erro, a tela diria "nenhum
 * manifesto" quando na verdade não conseguiu ler.
 */
export async function loadManifestos(request: (url: string) => Promise<Response>): Promise<ManifestosState> {
  try {
    const responses = await Promise.all(MANIFESTOS_ENDPOINTS.map((url) => request(url)));

    // O 401 ganha de qualquer outro erro: é o único que se resolve entrando de novo.
    const expired = responses.findIndex((res) => res.status === 401);
    if (expired !== -1) return { status: "expired", cause: `${MANIFESTOS_ENDPOINTS[expired]}: HTTP 401` };

    const failed = responses.findIndex((res) => !res.ok);
    if (failed !== -1) {
      return { status: "error", cause: `${MANIFESTOS_ENDPOINTS[failed]}: HTTP ${responses[failed].status}` };
    }

    const [manifestos, coletas, motoristas, veiculos] = await Promise.all(responses.map((res) => res.json()));
    return { status: "ready", manifestos, coletas, motoristas, veiculos };
  } catch (cause) {
    return { status: "error", cause };
  }
}

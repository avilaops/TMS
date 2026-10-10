import { calcularFrete, tabelaVigente } from "@/lib/frete";

/**
 * Frete de uma coleta, pronto para gravar nas colunas `freight*`.
 *
 * Usa a tabela que vale para o cliente hoje (a dele, senão a padrão). Sem
 * tabela em vigor, ou com o destino fora dela, tudo sai nulo: a coleta fica
 * "a cotar" e o operador informa o valor à mão.
 *
 * `db` é o cliente do banco da empresa (ou a transação em curso).
 */
export type FreteDaColeta = {
  freightValue: number | null;
  freightDeadlineHours: number | null;
  freightTableId: string | null;
  freightDetails: { tabela: string; composicao: { rotulo: string; valor: number }[]; avisos: string[] } | null;
};

export const SEM_FRETE: FreteDaColeta = {
  freightValue: null,
  freightDeadlineHours: null,
  freightTableId: null,
  freightDetails: null,
};

export async function freteDaColeta(
  db: unknown,
  carga: {
    clientId: string;
    destination: string;
    weight: number;
    volumes: number;
    invoiceValue?: number | null;
    /** Cubagem, em m³. Só pesa na conta se a tabela tiver fator de cubagem. */
    cubicMeters?: number | null;
  },
): Promise<FreteDaColeta> {
  const tabela = await tabelaVigente(db, carga.clientId);
  if (!tabela) return SEM_FRETE;

  const frete = calcularFrete(tabela, carga.destination, {
    peso: carga.weight,
    volumes: carga.volumes,
    valorNota: carga.invoiceValue,
    metrosCubicos: carga.cubicMeters,
  });
  if (!frete.atendida) return SEM_FRETE;

  return {
    freightValue: frete.valor,
    freightDeadlineHours: frete.prazoHoras,
    freightTableId: tabela.id,
    freightDetails: { tabela: tabela.name, composicao: frete.composicao, avisos: frete.avisos },
  };
}

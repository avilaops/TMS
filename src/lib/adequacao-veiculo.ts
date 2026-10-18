export type CargaParaVeiculo = { peso: number; metrosCubicos?: number | null };

export type VeiculoParaCotacao = {
  id: string;
  plate: string;
  model: string;
  type: string;
  capacity: number | null;
  cubicCapacity: number | null;
  status: string;
};

export type AdequacaoDeVeiculo = {
  sugerido: VeiculoParaCotacao | null;
  compativeis: VeiculoParaCotacao[];
  aviso: string | null;
};

const positiva = (valor: number | null | undefined) =>
  typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : null;

const numero = (valor: number, casas = 1) =>
  valor.toLocaleString("pt-BR", { maximumFractionDigits: casas });

/**
 * Seleciona os veículos fisicamente aptos para a carga. O primeiro é o menor
 * veículo suficiente, evitando sugerir capacidade muito acima da necessidade.
 * Estado de manutenção e capacidade necessária não cadastrada excluem a opção.
 */
export function avaliarVeiculosParaCarga(
  carga: CargaParaVeiculo,
  veiculos: readonly VeiculoParaCotacao[],
): AdequacaoDeVeiculo {
  const peso = Math.max(0, carga.peso);
  const cubagem = positiva(carga.metrosCubicos);

  const compativeis = veiculos
    .filter((veiculo) => {
      if (veiculo.status === "MAINTENANCE") return false;
      const capacidadeKg = positiva(veiculo.capacity);
      if (capacidadeKg === null || capacidadeKg < peso) return false;
      if (cubagem === null) return true;
      const capacidadeM3 = positiva(veiculo.cubicCapacity);
      return capacidadeM3 !== null && capacidadeM3 >= cubagem;
    })
    .sort((a, b) => {
      const pesoA = positiva(a.capacity) ?? Number.POSITIVE_INFINITY;
      const pesoB = positiva(b.capacity) ?? Number.POSITIVE_INFINITY;
      if (pesoA !== pesoB) return pesoA - pesoB;
      return (positiva(a.cubicCapacity) ?? Number.POSITIVE_INFINITY) -
        (positiva(b.cubicCapacity) ?? Number.POSITIVE_INFINITY);
    });

  const aviso = compativeis.length > 0
    ? null
    : `Nenhum veículo disponível e com capacidade cadastrada comporta ${numero(peso)} kg${
        cubagem === null ? "" : ` e ${numero(cubagem, 3)} m³`
      }.`;

  return { sugerido: compativeis[0] ?? null, compativeis, aviso };
}

export const VEICULO_PARA_COTACAO_SELECT = {
  id: true,
  plate: true,
  model: true,
  type: true,
  capacity: true,
  cubicCapacity: true,
  status: true,
} as const;

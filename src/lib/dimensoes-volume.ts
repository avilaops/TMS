export type UnidadeDeDimensao = "cm" | "m";

export type DimensoesDeVolume = {
  quantidade: number;
  comprimento: number;
  largura: number;
  altura: number;
  unidade: UnidadeDeDimensao;
  pesoUnitario?: number | null;
};

export type CalculoDaLinha = {
  metrosCubicosUnitarios: number;
  metrosCubicosTotais: number;
  pesoTotal: number | null;
};

export type CalculoDosVolumes = {
  volumes: number;
  metrosCubicos: number;
  pesoDetalhado: number | null;
  linhas: CalculoDaLinha[];
};

const arredondar = (valor: number, casas: number) =>
  Math.round((valor + Number.EPSILON) * 10 ** casas) / 10 ** casas;

const positiva = (valor: number, nome: string) => {
  if (!Number.isFinite(valor) || valor <= 0) throw new Error(`${nome} precisa ser maior que zero.`);
};

/** Consolida tipos de embalagem em quantidade, m³ e peso detalhado. */
export function calcularDimensoesDosVolumes(volumes: readonly DimensoesDeVolume[]): CalculoDosVolumes {
  if (volumes.length === 0) throw new Error("Informe ao menos um tipo de volume.");

  let quantidadeTotal = 0;
  let metrosCubicos = 0;
  let pesoDetalhado = 0;
  let temPeso = false;

  const linhas = volumes.map((volume) => {
    positiva(volume.quantidade, "A quantidade");
    if (!Number.isInteger(volume.quantidade)) throw new Error("A quantidade precisa ser um número inteiro.");
    positiva(volume.comprimento, "O comprimento");
    positiva(volume.largura, "A largura");
    positiva(volume.altura, "A altura");
    if (volume.pesoUnitario !== null && volume.pesoUnitario !== undefined) {
      positiva(volume.pesoUnitario, "O peso unitário");
      temPeso = true;
    }

    const divisor = volume.unidade === "cm" ? 100 : 1;
    const unitariosExatos =
      (volume.comprimento / divisor) * (volume.largura / divisor) * (volume.altura / divisor);
    const totaisExatos = unitariosExatos * volume.quantidade;
    const pesoTotal = volume.pesoUnitario == null ? null : arredondar(volume.pesoUnitario * volume.quantidade, 3);

    quantidadeTotal += volume.quantidade;
    metrosCubicos += totaisExatos;
    pesoDetalhado += pesoTotal ?? 0;

    return {
      metrosCubicosUnitarios: arredondar(unitariosExatos, 6),
      metrosCubicosTotais: arredondar(totaisExatos, 6),
      pesoTotal,
    };
  });

  return {
    volumes: quantidadeTotal,
    metrosCubicos: arredondar(metrosCubicos, 6),
    pesoDetalhado: temPeso ? arredondar(pesoDetalhado, 3) : null,
    linhas,
  };
}

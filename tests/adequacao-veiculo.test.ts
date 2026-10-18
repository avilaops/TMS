import { describe, expect, it } from "vitest";
import { avaliarVeiculosParaCarga } from "@/lib/adequacao-veiculo";

const veiculo = (id: string, capacity: number | null, cubicCapacity: number | null, status = "AVAILABLE") => ({
  id,
  plate: `${id}1A23`,
  model: `Modelo ${id}`,
  type: id === "VAN" ? "VAN" : "TRUCK",
  capacity,
  cubicCapacity,
  status,
});

describe("adequação de veículo para a cotação", () => {
  it("sugere primeiro o menor veículo que comporta peso e cubagem", () => {
    const resultado = avaliarVeiculosParaCarga(
      { peso: 1_200, metrosCubicos: 8 },
      [veiculo("GRANDE", 8_000, 40), veiculo("VAN", 1_500, 10), veiculo("MEDIO", 3_000, 20)],
    );

    expect(resultado.sugerido?.id).toBe("VAN");
    expect(resultado.compativeis.map((item) => item.id)).toEqual(["VAN", "MEDIO", "GRANDE"]);
    expect(resultado.aviso).toBeNull();
  });

  it("não sugere veículo em manutenção nem veículo sem capacidade necessária", () => {
    const resultado = avaliarVeiculosParaCarga(
      { peso: 900, metrosCubicos: 5 },
      [veiculo("MANUT", 2_000, 10, "MAINTENANCE"), veiculo("SEM", 2_000, null)],
    );

    expect(resultado.compativeis).toEqual([]);
    expect(resultado.sugerido).toBeNull();
    expect(resultado.aviso).toContain("Nenhum veículo disponível");
  });

  it("informa quais limites impedem o atendimento", () => {
    const resultado = avaliarVeiculosParaCarga(
      { peso: 4_000, metrosCubicos: 12 },
      [veiculo("PESO", 3_000, 20), veiculo("CUBO", 5_000, 10)],
    );

    expect(resultado.compativeis).toEqual([]);
    expect(resultado.aviso).toContain("4.000 kg");
    expect(resultado.aviso).toContain("12 m³");
  });

  it("avalia somente peso quando a cubagem não foi informada", () => {
    const resultado = avaliarVeiculosParaCarga(
      { peso: 1_000, metrosCubicos: null },
      [veiculo("VAN", 1_500, null)],
    );

    expect(resultado.sugerido?.id).toBe("VAN");
  });
});

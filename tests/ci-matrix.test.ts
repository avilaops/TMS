import { describe, expect, it } from "vitest";
import { planTestGroups, ciTestFiles } from "../.github/scripts/test-matrix.mjs";

describe("distribuição completa dos testes na CI", () => {
  it("separa os arquivos maiores e os combina com os menores", () => {
    expect(planTestGroups([
      { file: "tests/grande.test.ts", size: 100 }, { file: "tests/medio.test.ts", size: 60 },
      { file: "tests/pequeno.test.ts", size: 3 }, { file: "tests/minimo.test.tsx", size: 1 },
    ])).toEqual({ include: [
      { id: "1", files: ["tests/grande.test.ts", "tests/minimo.test.tsx"] },
      { id: "2", files: ["tests/medio.test.ts", "tests/pequeno.test.ts"] },
    ] });
  });

  it.each([1, 3, 7, 33, 101])("distribui %i arquivos sem grupos vazios, repetição ou perda", (quantidade) => {
    const arquivos = Array.from({ length: quantidade }, (_, i) => ({ file: `tests/arquivo-${i}.test.ts`, size: i }));
    const grupos = planTestGroups(arquivos).include;
    expect(grupos).toHaveLength(Math.ceil(quantidade / 2));
    expect(grupos.every((grupo) => grupo.files.length > 0 && grupo.files.length <= 2)).toBe(true);
    expect(grupos.flatMap((grupo) => grupo.files).sort()).toEqual(arquivos.map((arquivo) => arquivo.file).sort());
  });

  it("falha quando a descoberta está vazia ou contém arquivo repetido", () => {
    expect(() => planTestGroups([])).toThrow();
    expect(() => planTestGroups([{ file: "tests/a.test.ts", size: 1 }, { file: "tests/a.test.ts", size: 2 }])).toThrow();
  });

  it("a execução normal preserva a suíte padrão; a CI seleciona os arquivos exatos", () => {
    expect(ciTestFiles(undefined)).toBeUndefined();
    expect(ciTestFiles('["tests/um.test.ts","tests/dois.test.tsx"]')).toEqual(["tests/um.test.ts", "tests/dois.test.tsx"]);
  });

  it.each(['[]', '{}', '[null]', '["tests/*.test.ts"]', '["../fora.test.ts"]', '["tests/a.test.ts","tests/a.test.ts"]'])("recusa seleção inválida: %s", (valor) => {
    expect(() => ciTestFiles(valor)).toThrow();
  });
});

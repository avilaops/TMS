import { describe, expect, it } from "vitest";
import { planTestGroups, ciTestFiles, ciTestNamePattern } from "../.github/scripts/test-matrix.mjs";

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

  it("divide a suíte longa de MDF-e em duas partes e mantém os demais arquivos integrais", () => {
    const grupos = planTestGroups([
      { file: "tests/mdfe-rotas.test.ts", size: 120000 },
      { file: "tests/outro.test.ts", size: 20 },
    ]).include;
    expect(grupos.filter((grupo) => grupo.files.includes("tests/outro.test.ts"))).toHaveLength(1);
    const mdfe = grupos.filter((grupo) => grupo.files.includes("tests/mdfe-rotas.test.ts"));
    expect(mdfe.map((grupo) => grupo.part).sort()).toEqual(["mdfe-demais", "mdfe-emissao"]);
    expect(mdfe.every((grupo) => grupo.files.length === 1)).toBe(true);
  });

  it("as partes são complementares, cobrem grupos futuros e repetem a conferência dos segredos", () => {
    const emissao = ciTestNamePattern("mdfe-emissao")!;
    const demais = ciTestNamePattern("mdfe-demais")!;
    for (const grupo of ["emitir", "encerrar, cancelar e incluir condutor", "contingência off-line (MOC)", "grupo novo ainda desconhecido"]) {
      const nome = `tests/mdfe-rotas.test.ts rotas da emissão de MDF-e ${grupo} um cenário`;
      expect(Number(emissao.test(nome)) + Number(demais.test(nome))).toBe(1);
    }
    const segredo = "tests/mdfe-rotas.test.ts rotas da emissão de MDF-e isolamento entre empresas e segredo do certificado o certificado nunca aparece";
    expect(emissao.test(segredo)).toBe(true);
    expect(demais.test(segredo)).toBe(true);
  });

  it("não filtra a execução padrão e recusa uma parte desconhecida", () => {
    expect(ciTestNamePattern(undefined)).toBeUndefined();
    expect(ciTestNamePattern("")).toBeUndefined();
    expect(() => ciTestNamePattern("parte-inexistente")).toThrow();
  });

  it("a execução normal preserva a suíte padrão; a CI seleciona os arquivos exatos", () => {
    expect(ciTestFiles(undefined)).toBeUndefined();
    expect(ciTestFiles('["tests/um.test.ts","tests/dois.test.tsx"]')).toEqual(["tests/um.test.ts", "tests/dois.test.tsx"]);
  });

  it.each(['[]', '{}', '[null]', '["tests/*.test.ts"]', '["../fora.test.ts"]', '["tests/a.test.ts","tests/a.test.ts"]'])("recusa seleção inválida: %s", (valor) => {
    expect(() => ciTestFiles(valor)).toThrow();
  });
});

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { EMPRESA_PADRAO } from "./tests/empresas-de-teste";
import { ciTestFiles, ciTestNamePattern } from "./.github/scripts/test-matrix.mjs";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Os `.test.tsx` são testes de tela: pedem o jsdom no topo do arquivo
    // (`@vitest-environment jsdom`) e montam o componente com `tests/tela.tsx`.
    include: ciTestFiles(process.env.TMS_CI_TEST_FILES) ?? ["tests/**/*.test.{ts,tsx}"],
    testNamePattern: ciTestNamePattern(process.env.TMS_CI_TEST_PART),
    // Aplica o isolamento por empresa e cria as empresas de teste.
    globalSetup: ["tests/preparar-banco.ts"],
    // Consulta de teste que nao diz empresa cai nesta (src/lib/prisma.ts).
    env: { TMS_TENANT_TESTE: EMPRESA_PADRAO.id },
    // As rotas conversam com um Postgres de verdade. Rodar arquivos em paralelo
    // faria dois testes disputarem as mesmas linhas.
    fileParallelism: false,
    testTimeout: 20000,
  },
});

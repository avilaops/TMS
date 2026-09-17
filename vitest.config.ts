import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // As rotas conversam com um Postgres de verdade. Rodar arquivos em paralelo
    // faria dois testes disputarem as mesmas linhas.
    fileParallelism: false,
    testTimeout: 20000,
  },
});

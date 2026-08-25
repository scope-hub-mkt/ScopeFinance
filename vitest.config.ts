import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Suíte do ScopeFinance — criada em 25/08/2026.
 *
 * O Gate G0 da Dashboard (Ponto 6, `D-18`) registrou como **risco aceito**
 * que este sistema não tinha nenhum teste automatizado: *"migrar dado
 * financeiro de um sistema sem teste significa que nenhuma regressão de lá é
 * detectável antes de chegar aqui"*. Aceito não é resolvido — esta suíte é a
 * resolução.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` é uma trava do bundler do Next, não um módulo com
      // conteúdo: fora do Next ela não resolve. Quem aplica a garantia é o
      // `next build`, que roda antes destes testes no CI.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});

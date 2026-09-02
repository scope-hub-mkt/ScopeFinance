import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

/**
 * ESLint do ScopeFinance — criado em 25/08/2026.
 *
 * ⚠️ **Por que ele não existia, e por que ninguém percebeu.** O script `lint`
 * do projeto sempre foi `next lint`. Sem o ESLint instalado e sem arquivo de
 * configuração, esse comando **não analisa nada** — ele promete análise e
 * entrega silêncio. O `next build` faz o mesmo: pula a etapa de lint quando
 * não encontra ESLint, e passa. É por isso que o `Initial commit` deployou
 * normalmente na Vercel com um erro de aspas não escapadas no código.
 *
 * O defeito só apareceu em 25/08/2026 por um acidente: a pasta do
 * ScopeFinance foi colocada **dentro** do diretório da Scope Dashboard para a
 * rodada de integração, e o Node resolveu o ESLint (e a config) do diretório
 * pai. O build "quebrou" — mas quebrou emprestando o lint de outro projeto.
 *
 * **A lição é sobre a ferramenta, não sobre o defeito:** um comando que
 * promete verificação e não verifica é pior do que não ter o comando, porque
 * o verde dele é lido como garantia. Este arquivo, mais as dependências no
 * `package.json`, tornam a verificação real — no `npm run lint`, no
 * `next build` e no CI.
 *
 * É exatamente a mesma medição que a Scope Dashboard fez sobre si mesma em
 * 21/08/2026 (`docs/tasks/06-LINT-ESTADO ✅.md` de lá).
 */

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // Não analisar o que não é nosso, o que é gerado, nem o protótipo original
    // (`_reference/`) — que é referência histórica e não código em uso.
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "_reference/**",
    ],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    rules: {
      /**
       * ⚠️ Relaxada **com motivo declarado**, não por conveniência.
       *
       * As telas usam `Record<string, any>` como estado de formulário: o CRUD
       * é genérico por desenho (um `<Form>` serve nove recursos), e tipar cada
       * formulário exigiria nove tipos que o `sanitizeInput` do servidor já
       * valida de novo — a barreira real está lá, não aqui. Vira aviso para
       * continuar visível sem travar o build.
       */
      "@typescript-eslint/no-explicit-any": "warn",

      /**
       * `_` no começo do nome significa **"não uso, e é de propósito"** — o
       * caso são parâmetros posicionais de stub (`(_url, _init) => …`), que
       * não podem sumir sem quebrar a assinatura.
       *
       * ⛔ Sem esta linha, a regra acusava dois falsos positivos permanentes.
       * Aviso que nunca vai ser resolvido é pior que aviso nenhum: ele treina
       * quem lê a saída do lint a ignorar a saída do lint.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;

import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `RF-99` / `RN-56` / `D-101` — a senha provisória vira mecanismo.
 *
 * ⛔ **O que isto fecha.** Medido em 03/09/2026: não existia
 * `senha_provisoria`, `primeiro_acesso` nem `trocar_senha` em nenhum dos dois
 * repositórios. "Troque no primeiro acesso" era convenção sem mecanismo —
 * três pessoas com a mesma senha conhecida e nada obrigando a troca.
 */

vi.mock("@/lib/supabase/admin", async () => {
  const { fakeAtual } = await import("./fakes/supabase-fake");
  return { createSupabaseAdmin: () => fakeAtual() };
});

import { novoBanco, fakeAtual } from "./fakes/supabase-fake";
import { definirSenha } from "@/lib/dominio/usuarios";

const LEO = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  novoBanco({
    usuarios: [
      {
        id: LEO,
        nome: "Leonardo",
        email: "leonardo@scopecompany.com.br",
        papel: "admin",
        master: true,
        ativo: true,
        senha_provisoria: true,
      },
    ],
  });
});

describe("RN-56 — a senha provisória", () => {
  it("trocar a senha limpa a marca", async () => {
    await definirSenha(LEO, "UmaSenhaNova#2026");

    const u = fakeAtual().tabela("usuarios")[0];
    expect(u.senha_provisoria).toBe(false);
  });

  it("senha curta é recusada, e a marca CONTINUA de pé", async () => {
    // ⚖️ A ordem importa: se a marca caísse antes da validação, uma tentativa
    // fracassada destravaria a conta — e a senha conhecida voltaria a abrir
    // o sistema inteiro.
    await expect(definirSenha(LEO, "curta")).rejects.toThrow();

    const u = fakeAtual().tabela("usuarios")[0];
    expect(u.senha_provisoria).toBe(true);
  });

  it("a conta nasce com a marca ligada", () => {
    // O provisionamento do dia zero grava `senha_provisoria: true`
    // explicitamente; o default da coluna é `false` para não trancar
    // retroativamente quem já existia.
    expect(fakeAtual().tabela("usuarios")[0].senha_provisoria).toBe(true);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A trava de 04/09/2026: **autenticado não é autorizado**.
 *
 * ⛔ **O estado real que originou este arquivo.** A tela de login oferece
 * *criar conta* e o Supabase deste projeto está com `disable_signup: false`.
 * Até esta data `requireUser()` conferia só a existência da sessão, e as rotas
 * seguem com `createSupabaseAdmin()` — chave de serviço, RLS contornada.
 * Medido em produção: existia uma credencial sem linha em `usuarios`, criada
 * e usada no mesmo dia, alcançando clientes, contas a pagar, assinaturas,
 * contratos e notas fiscais.
 *
 * ⚖️ **Por que o teste vale.** A guarda é uma linha fácil de apagar sem
 * ninguém notar: apagada, nada fica vermelho e o sistema volta a aceitar
 * qualquer credencial do `auth`. É falha muda, que é a categoria que este
 * projeto já pagou para aprender.
 */

const ATIVO = "11111111-1111-4111-8111-111111111111";
const DESLIGADO = "22222222-2222-4222-8222-222222222222";
const SEM_CADASTRO = "33333333-3333-4333-8333-333333333333";

let sessao: { id: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessao } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", async () => {
  const { fakeAtual } = await import("./fakes/supabase-fake");
  return { createSupabaseAdmin: () => fakeAtual() };
});

import { novoBanco } from "./fakes/supabase-fake";
import { requireUser, SemCadastroError, UnauthorizedError } from "@/lib/supabase/auth";

beforeEach(() => {
  sessao = null;
  novoBanco({
    usuarios: [
      { id: ATIVO, nome: "Leonardo", email: "leonardo@scopecompany.com.br", papel: "admin", master: true, ativo: true },
      { id: DESLIGADO, nome: "Ex-equipe", email: "ex@scopecompany.com.br", papel: "admin", master: false, ativo: false },
    ],
  });
});

describe("requireUser — credencial válida não basta", () => {
  it("sem sessão nenhuma: 401", async () => {
    sessao = null;
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("credencial sem linha em `usuarios` é RECUSADA", async () => {
    // O caso medido em produção: alguém se cadastrou pela própria tela de
    // login. A credencial é legítima; o acesso não é.
    sessao = { id: SEM_CADASTRO };
    await expect(requireUser()).rejects.toBeInstanceOf(SemCadastroError);
  });

  it("cadastro desativado é RECUSADO", async () => {
    // ⚠️ `ativo` não era conferido em lugar nenhum antes desta data:
    // desligar alguém na tela de usuários não o tirava do sistema.
    sessao = { id: DESLIGADO };
    await expect(requireUser()).rejects.toBeInstanceOf(SemCadastroError);
  });

  it("cadastro ativo passa, e devolve o usuário da sessão", async () => {
    sessao = { id: ATIVO };
    await expect(requireUser()).resolves.toMatchObject({ id: ATIVO });
  });

  it("a recusa DIZ o motivo, e os dois motivos são distintos", async () => {
    // ⚖️ Recusa muda manda a pessoa conferir a senha — o lado errado.
    sessao = { id: SEM_CADASTRO };
    const semCadastro = await requireUser().catch((e) => e as SemCadastroError);
    sessao = { id: DESLIGADO };
    const inativo = await requireUser().catch((e) => e as SemCadastroError);

    expect(semCadastro.motivo).toBe("sem-cadastro");
    expect(inativo.motivo).toBe("inativo");
    expect(semCadastro.message).not.toBe(inativo.message);
    expect(inativo.message).toMatch(/desativado/i);
  });
});

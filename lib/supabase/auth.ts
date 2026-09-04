import "server-only";
import { createSupabaseServerClient } from "./server";

/** Retorna o usuário autenticado ou null (sem lançar). */
export async function getCurrentUser() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Não autenticado");
    this.name = "UnauthorizedError";
  }
}

/**
 * Credencial válida, pessoa que não entra: sem cadastro em `usuarios`, ou
 * cadastro desligado. É 403, não 401 — 401 diz "sua senha está errada" e manda
 * conferir o lado errado.
 */
export class SemCadastroError extends Error {
  constructor(readonly motivo: "sem-cadastro" | "inativo") {
    super(
      motivo === "inativo"
        ? "O seu cadastro está desativado. Fale com a conta administradora."
        : "A sua credencial existe, mas não há cadastro correspondente. Fale com a conta administradora."
    );
    this.name = "SemCadastroError";
  }
}

/**
 * Garante uma sessão **com cadastro ativo**.
 *
 * ⛔ **Autenticado não é autorizado, e até 04/09/2026 aqui era.** A função
 * conferia só a existência da sessão, e as rotas seguem com
 * `createSupabaseAdmin()` — chave de serviço, RLS contornada. Qualquer
 * credencial do `auth` lia e escrevia clientes, contas a pagar, assinaturas,
 * contratos e notas fiscais; a única porta fechada era `contas_receber`,
 * porque `RN-53` exige `master`. Medido: existia uma credencial nessas
 * condições, criada e usada no mesmo dia.
 *
 * ⚖️ **A trava mora aqui, e não em cada rota.** As treze rotas autenticadas
 * já chamavam `requireUser()`; guarda que depende de cada rota nova lembrar de
 * checar nasce com buraco — a mesma doutrina que pôs a senha provisória no
 * `middleware.ts` e não em cada tela.
 *
 * ⚠️ **O `middleware.ts` não cobre isto**: o `matcher` dele exclui `/api` de
 * propósito, porque a API faz a própria autenticação. Fechar só lá deixaria a
 * API aberta para quem tivesse o cookie.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();

  const { createSupabaseAdmin } = await import("./admin");
  const { data: perfil } = await createSupabaseAdmin()
    .from("usuarios")
    .select("ativo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil) throw new SemCadastroError("sem-cadastro");
  if ((perfil as { ativo: boolean | null }).ativo === false) throw new SemCadastroError("inativo");

  return user;
}
